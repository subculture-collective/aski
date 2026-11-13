import { useEffect, useRef, useState } from 'react';
import { findFavorite, findMembership, orphanedArtifacts, parseName, parseRecord, sha256 } from '../shared/library.ts';
import type { Artifact, ArtifactMeta, CollectionPayload, DesignPayload, FavoritePayload, InputPayload, LibraryRecord, MembershipPayload, PalettePayload, RecordType } from '../shared/library.ts';
import { dropUpload, nextRevision, pendingView, resolveRejection } from '../shared/outbox.ts';
import type { OutboxEntry } from '../shared/outbox.ts';
import { AccountLibraryError, deleteArtifact, fetchArtifact, listArtifacts, readChanges, requestBody, sendBody, uploadArtifact } from './accountLibrary.ts';
import type { RemoteArtifact } from './accountLibrary.ts';
import type { Mutation, WireRecord } from './accountLibrary.ts';
import { deleteArtifactBytes, loadAccountCache, loadArtifactMeta, putArtifacts, readArtifact, saveAccountCache } from './libraryStore.ts';
// The signed-in library. It has the same shape as the browser library so the studio's panels work with
// either. This browser keeps a copy of the account's records and a queue of unsent changes, both bound to
// the account (docs/account-library.md). A change shows at once, is stored in the queue before it is
// sent, and is sent in order; one that cannot be sent waits and is retried, including after a reload.
export type SyncStatus = 'loading' | 'synced' | 'sending' | 'waiting' | 'offline' | 'signed-out';
const RETRY = [2_000, 5_000, 15_000, 30_000, 60_000];
export function useAccountLibrary(subject: string | null, email: string, online: boolean, onSessionEnded: () => void) {
  const namespace = 'account:' + subject;
  const [records, setRecords] = useState<LibraryRecord[]>([]);
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [waiting, setWaiting] = useState(0);
  // File details from the account, and files kept in this browser for this account (waiting or downloaded).
  const [remoteFiles, setRemoteFiles] = useState<RemoteArtifact[]>([]);
  const [localFiles, setLocalFiles] = useState<ArtifactMeta[]>([]);
  const confirmed = useRef(new Map<string, LibraryRecord>());
  const outbox = useRef<OutboxEntry[]>([]);
  const cursor = useRef('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const retry = useRef<{ timer: number; attempt: number }>({ timer: 0, attempt: 0 });
  // Bumped when the account changes so work for a previous account stops.
  const generation = useRef(0);
  const render = () => { setRecords(pendingView(confirmed.current.values(), outbox.current, namespace)); setWaiting(outbox.current.length); };
  const toRecord = (change: WireRecord): LibraryRecord | null => {
    // A tombstone carries no payload; only its envelope is kept so the item stays deleted.
    try { return change.deletedAt ? { ...change, namespace, payload: null } as LibraryRecord : parseRecord({ ...change, namespace }); } catch { return null; }
  };
  function apply(changes: WireRecord[]) {
    const stored: LibraryRecord[] = [];
    let unreadable = 0;
    for (const change of changes) {
      const record = toRecord(change);
      if (!record) { unreadable += 1; continue; }
      const known = confirmed.current.get(record.id);
      if (!known || known.revision <= record.revision) { confirmed.current.set(record.id, record); stored.push(record); }
    }
    if (unreadable) setWarning(`${unreadable} account ${unreadable === 1 ? 'item needs' : 'items need'} a newer version of aski and ${unreadable === 1 ? 'is' : 'are'} not shown.`);
    return stored;
  }
  // Stores the queue and cursor with any records they depend on, in one transaction.
  const persist = (changes: LibraryRecord[] = [], replace = false) => saveAccountCache({ subject: subject!, email, cursor: cursor.current, outbox: outbox.current }, changes, replace)
    .then(() => true, () => { setWarning('This browser could not keep a copy of your account changes. Keep this page open until they are sent.'); return false; });
  // Reads every change since the last one applied. A resync answer starts again from an empty copy; the
  // queue is kept and is checked against the fresh copy when it is sent.
  async function pull(current: number) {
    let replace = false;
    for (;;) {
      const page = await readChanges(cursor.current);
      if (current !== generation.current) return;
      if (page.resync) { cursor.current = ''; confirmed.current.clear(); replace = true; continue; }
      const stored = apply(page.changes); cursor.current = page.cursor;
      await persist(stored, replace); replace = false; render();
      if (!page.more) return;
    }
  }
  function schedule(current: number, delay?: number) {
    clearTimeout(retry.current.timer);
    const wait = delay ?? RETRY[Math.min(retry.current.attempt, RETRY.length - 1)];
    retry.current.attempt += 1;
    retry.current.timer = window.setTimeout(() => { if (current === generation.current) void refresh(); }, wait);
  }
  // Sends the queue in order. Each entry keeps the bytes it was first sent with until it is acknowledged.
  async function flush(current: number) {
    while (outbox.current.length && current === generation.current) {
      const head = outbox.current[0];
      if (head.upload || head.removeArtifact) { if (!await sendFile(current, head)) return; continue; }
      if (!head.body) { head.body = requestBody(head.mutations); if (!await persist()) return; }
      setStatus('sending');
      try {
        const { changes } = await sendBody(head.body);
        if (current !== generation.current) return;
        const stored = apply(changes);
        outbox.current = outbox.current.filter(entry => entry !== head);
        retry.current.attempt = 0;
        await persist(stored); render();
      } catch (error) {
        if (current !== generation.current) return;
        const failure = error instanceof AccountLibraryError ? error : new AccountLibraryError(0, 'Your account library is unavailable.');
        if (paused(failure, current)) return;
        // The server refused the batch and kept nothing from it; resolve the refused change and try again.
        const stored = failure.details.record ? apply([failure.details.record]) : [];
        const result = resolveRejection(outbox.current, { status: failure.status, message: failure.message, ...failure.details });
        outbox.current = result.outbox;
        if (result.notice) setWarning(result.notice);
        await persist(stored); render();
      }
    }
    if (current === generation.current) setStatus(outbox.current.length ? 'waiting' : 'synced');
  }
  // Stops sending for failures that waiting can fix: the session ended, the service is unreachable or busy.
  function paused(failure: AccountLibraryError, current: number) {
    if (failure.status === 401) { setStatus('signed-out'); onSessionEnded(); return true; }
    if (failure.status === 0 || failure.status >= 500) { setStatus('offline'); schedule(current); return true; }
    if (failure.status === 429) { setStatus('waiting'); schedule(current, Math.max(failure.retryAfter, 1) * 1000); return true; }
    return false;
  }
  const done = async (entry: OutboxEntry) => { outbox.current = outbox.current.filter(item => item !== entry); retry.current.attempt = 0; await persist(); render(); };
  // Uploads a waiting file, or removes a file no design uses. A file the account refuses, or whose bytes are
  // gone from this browser, is taken out of the queued designs; the designs are still saved.
  async function sendFile(current: number, entry: OutboxEntry) {
    setStatus('sending');
    if (entry.upload) {
      let artifact;
      try { artifact = await readArtifact(entry.upload, namespace); }
      catch { outbox.current = dropUpload(outbox.current, entry.upload); setWarning('An image file was no longer in this browser, so its design was saved without it.'); await persist(); render(); return true; }
      try { const uploaded = await uploadArtifact(artifact); setRemoteFiles(files => [...files.filter(file => file.id !== uploaded.id), uploaded]); await done(entry); return current === generation.current; }
      catch (error) {
        const failure = error instanceof AccountLibraryError ? error : new AccountLibraryError(0, 'Your account library is unavailable.');
        if (current !== generation.current || paused(failure, current)) return false;
        outbox.current = dropUpload(outbox.current, entry.upload);
        setWarning(`An image file could not be saved to your account: ${failure.message} Its design is saved without it; the file is still in this browser.`);
        await persist(); render(); return true;
      }
    }
    try { await deleteArtifact(entry.removeArtifact!); }
    catch (error) {
      const failure = error instanceof AccountLibraryError ? error : new AccountLibraryError(0, 'Your account library is unavailable.');
      // 404 means it is already gone and 409 that a design still uses it; either way nothing more to do.
      if (current !== generation.current || paused(failure, current)) return false;
    }
    setRemoteFiles(files => files.filter(file => file.id !== entry.removeArtifact));
    await deleteArtifactBytes(namespace, [entry.removeArtifact!]).catch(() => {}); setLocalFiles(files => files.filter(file => file.id !== entry.removeArtifact));
    await done(entry); return current === generation.current;
  }
  function enqueue<T>(work: (current: number) => Promise<T>) {
    const current = generation.current;
    const next = queue.current.then(() => current === generation.current ? work(current) : undefined);
    queue.current = next.catch(() => {});
    return next;
  }
  function refresh() {
    return enqueue(async current => {
      try { await pull(current); const files = await listArtifacts(); if (current === generation.current) setRemoteFiles(files); }
      catch (error) {
        if (current !== generation.current) return;
        if (error instanceof AccountLibraryError && error.status === 401) { setStatus('signed-out'); onSessionEnded(); return; }
        setStatus('offline'); schedule(current); return;
      }
      await flush(current);
    });
  }
  useEffect(() => {
    generation.current += 1; const current = generation.current;
    clearTimeout(retry.current.timer); retry.current.attempt = 0;
    cursor.current = ''; confirmed.current.clear(); outbox.current = [];
    setRecords([]); setWarning(''); setWaiting(0); setRemoteFiles([]); setLocalFiles([]);
    if (!subject) { setLoading(false); setStatus('signed-out'); return; }
    setLoading(true); setStatus('loading');
    // The copy in this browser shows first; the account is read after it.
    void loadAccountCache(subject).then(({ records: cached, state }) => {
      if (current !== generation.current) return;
      for (const record of cached) confirmed.current.set(record.id, record);
      cursor.current = state.cursor; outbox.current = state.outbox; render();
      return loadArtifactMeta(namespace).then(files => { if (current === generation.current) setLocalFiles(files); });
    }, () => {}).finally(() => {
      if (current !== generation.current) return;
      if (online) void refresh().finally(() => { if (current === generation.current) setLoading(false); });
      else { setLoading(false); setStatus('offline'); }
    });
    const onVisible = () => { if (document.visibilityState === 'visible' && online) void refresh(); };
    const onOnline = () => { if (online) void refresh(); };
    document.addEventListener('visibilitychange', onVisible); addEventListener('online', onOnline);
    return () => { document.removeEventListener('visibilitychange', onVisible); removeEventListener('online', onOnline); clearTimeout(retry.current.timer); };
    // refresh reads only refs; the account and whether it is reachable decide when to start over.
  }, [subject, online]);
  // Queues a change built from what the visitor sees now, including earlier queued changes.
  function change(build: (records: LibraryRecord[], base: (id: string) => number) => Mutation[], files: Partial<OutboxEntry>[] = [], after: Partial<OutboxEntry>[] = []) {
    if (!subject) return;
    const mutations = build(pendingView(confirmed.current.values(), outbox.current, namespace), id => nextRevision(confirmed.current, outbox.current, id));
    if (!mutations.length) return;
    const at = new Date().toISOString();
    const entry = (extra: Partial<OutboxEntry>): OutboxEntry => ({ id: crypto.randomUUID(), at, mutations: [], ...extra });
    // Files go up before the design that lists them; files no design uses any more are removed after it is deleted.
    outbox.current = [...outbox.current, ...files.map(entry), entry({ mutations }), ...after.map(entry)];
    render(); setStatus(online ? 'waiting' : 'offline');
    // The queue is stored before anything is sent.
    const current = generation.current;
    void persist().then(() => { if (online && current === generation.current) void enqueue(flush); });
  }
  const create = (type: RecordType, payload: unknown): Mutation => ({ requestId: crypto.randomUUID(), entityId: crypto.randomUUID(), baseRevision: 0, type, schemaVersion: 1, payload });
  const deletion = (id: string, base: (id: string) => number): Mutation => ({ requestId: crypto.randomUUID(), entityId: id, baseRevision: base(id), delete: true });
  const remove = (record: LibraryRecord) => {
    const view = pendingView(confirmed.current.values(), outbox.current, namespace);
    const orphans = record.type === 'design' ? orphanedArtifacts(view, record) : [];
    change((all, base) => all.some(item => item.id === record.id && !item.deletedAt) ? [deletion(record.id, base)] : [], [], orphans.map(id => ({ removeArtifact: id })));
  };
  function rename(record: LibraryRecord<InputPayload | DesignPayload | CollectionPayload>, name: string) {
    const valid = parseName(name);
    change((all, base) => {
      const current = all.find(item => item.id === record.id);
      return current && !current.deletedAt ? [{ requestId: crypto.randomUUID(), entityId: current.id, baseRevision: base(current.id), type: current.type, schemaVersion: 1,
        payload: { ...(current.payload as object), name: valid } }] : [];
    });
  }
  // Files are kept in this browser first and uploaded before the design. If the browser has no room for
  // them, the design is still saved, without them.
  async function addDesign(payload: DesignPayload, files: Omit<Artifact, 'namespace' | 'id' | 'sha256' | 'byteLength' | 'createdAt'>[]) {
    const { artifacts: _artifacts, ...design } = payload; void _artifacts;
    const createdAt = new Date().toISOString();
    let stored: Artifact[] = [];
    for (const file of files) stored.push({ ...file, namespace, id: crypto.randomUUID(), sha256: await sha256(file.bytes), byteLength: file.bytes.length, createdAt });
    let note = '';
    try { if (stored.length) await putArtifacts(stored); }
    catch { stored = []; note = 'The design is saved, but this browser had no room to keep its image files for your account.'; }
    setLocalFiles(previous => [...previous, ...stored.map(({ bytes: _bytes, ...meta }) => { void _bytes; return meta; })]);
    change(() => [create('design', stored.length ? { ...design, artifacts: stored.map(file => file.id) } : design)], stored.map(file => ({ upload: file.id })));
    return note;
  }
  // Returns a file's exact bytes, from this browser if kept here, otherwise from the account; the hash is
  // checked either way, and a downloaded copy is kept here.
  async function readFile(id: string): Promise<Artifact> {
    try { return await readArtifact(id, namespace); } catch { /* not kept here */ }
    const details = remoteFiles.find(file => file.id === id);
    if (!details) throw new Error('This file is not in your account.');
    const bytes = await fetchArtifact(id);
    if (await sha256(bytes) !== details.sha256) throw new Error('This saved file is damaged.');
    const artifact = { ...details, namespace, bytes } as Artifact;
    void putArtifacts([artifact]).then(() => setLocalFiles(previous => [...previous.filter(file => file.id !== id), { ...details, namespace } as ArtifactMeta]), () => {});
    return artifact;
  }
  const artifacts: ArtifactMeta[] = [...localFiles, ...remoteFiles.filter(file => !localFiles.some(local => local.id === file.id)).map(file => ({ ...file, namespace }) as ArtifactMeta)];
  // For import: send one batch directly and read the account back. Both throw on failure.
  const send = (mutations: Mutation[]) => enqueue(async () => { const stored = apply((await sendBody(requestBody(mutations))).changes); await persist(stored); render(); });
  const reload = () => enqueue(async current => { await pull(current); return [...confirmed.current.values()]; })
    .then(all => { if (!all) throw new AccountLibraryError(0, 'The account changed.'); return all; });
  const ofType = <T,>(type: RecordType) => records.filter(record => record.type === type && !record.deletedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) as LibraryRecord<T>[];
  return {
    kind: 'account' as const, loading, status, waiting, send, reload, records, warning, artifacts, addDesign, readArtifact: readFile,
    palettes: ofType<PalettePayload>('palette'), collections: ofType<CollectionPayload>('collection'), favorites: ofType<FavoritePayload>('favorite'),
    inputs: ofType<InputPayload>('input'), designs: ofType<DesignPayload>('design'),
    add: <T,>(type: RecordType, payload: T) => change(() => [create(type, payload)]),
    rename, remove, removeFavorite: remove, isFavorite: (favorite: FavoritePayload) => !!findFavorite(records, favorite),
    toggleFavorite: (favorite: FavoritePayload) => change((all, base) => {
      const existing = findFavorite(all, favorite);
      return [existing ? deletion(existing.id, base) : create('favorite', favorite)];
    }),
    toggleMembership: (collectionId: string, item: LibraryRecord<FavoritePayload | DesignPayload>) => change((all, base) => {
      const existing = findMembership(all, collectionId, item.id);
      return [existing ? deletion(existing.id, base) : create('membership', { collectionId, itemType: item.type as MembershipPayload['itemType'], itemId: item.id })];
    }),
  };
}
