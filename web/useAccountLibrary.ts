import { useEffect, useRef, useState } from 'react';
import { findFavorite, findMembership, parseName, parseRecord } from '../shared/library.ts';
import type { Artifact, ArtifactMeta, CollectionPayload, DesignPayload, FavoritePayload, InputPayload, LibraryRecord, MembershipPayload, PalettePayload, RecordType } from '../shared/library.ts';
import { nextRevision, pendingView, resolveRejection } from '../shared/outbox.ts';
import type { OutboxEntry } from '../shared/outbox.ts';
import { AccountLibraryError, readChanges, requestBody, sendBody } from './accountLibrary.ts';
import type { Mutation, WireRecord } from './accountLibrary.ts';
import { loadAccountCache, saveAccountCache } from './libraryStore.ts';
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
        if (failure.status === 401) { setStatus('signed-out'); onSessionEnded(); return; }
        if (failure.status === 0 || failure.status >= 500) { setStatus('offline'); schedule(current); return; }
        if (failure.status === 429) { setStatus('waiting'); schedule(current, Math.max(failure.retryAfter, 1) * 1000); return; }
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
  function enqueue<T>(work: (current: number) => Promise<T>) {
    const current = generation.current;
    const next = queue.current.then(() => current === generation.current ? work(current) : undefined);
    queue.current = next.catch(() => {});
    return next;
  }
  function refresh() {
    return enqueue(async current => {
      try { await pull(current); }
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
    setRecords([]); setWarning(''); setWaiting(0);
    if (!subject) { setLoading(false); setStatus('signed-out'); return; }
    setLoading(true); setStatus('loading');
    // The copy in this browser shows first; the account is read after it.
    void loadAccountCache(subject).then(({ records: cached, state }) => {
      if (current !== generation.current) return;
      for (const record of cached) confirmed.current.set(record.id, record);
      cursor.current = state.cursor; outbox.current = state.outbox; render();
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
  function change(build: (records: LibraryRecord[], base: (id: string) => number) => Mutation[]) {
    if (!subject) return;
    const mutations = build(pendingView(confirmed.current.values(), outbox.current, namespace), id => nextRevision(confirmed.current, outbox.current, id));
    if (!mutations.length) return;
    outbox.current = [...outbox.current, { id: crypto.randomUUID(), at: new Date().toISOString(), mutations }];
    render(); setStatus(online ? 'waiting' : 'offline');
    // The queue is stored before anything is sent.
    const current = generation.current;
    void persist().then(() => { if (online && current === generation.current) void enqueue(flush); });
  }
  const create = (type: RecordType, payload: unknown): Mutation => ({ requestId: crypto.randomUUID(), entityId: crypto.randomUUID(), baseRevision: 0, type, schemaVersion: 1, payload });
  const deletion = (id: string, base: (id: string) => number): Mutation => ({ requestId: crypto.randomUUID(), entityId: id, baseRevision: base(id), delete: true });
  const remove = (record: LibraryRecord) => change((all, base) => all.some(item => item.id === record.id && !item.deletedAt) ? [deletion(record.id, base)] : []);
  function rename(record: LibraryRecord<InputPayload | DesignPayload | CollectionPayload>, name: string) {
    const valid = parseName(name);
    change((all, base) => {
      const current = all.find(item => item.id === record.id);
      return current && !current.deletedAt ? [{ requestId: crypto.randomUUID(), entityId: current.id, baseRevision: base(current.id), type: current.type, schemaVersion: 1,
        payload: { ...(current.payload as object), name: valid } }] : [];
    });
  }
  // Image files are not stored in accounts yet, so a design is saved with its recipe and exact text only.
  async function addDesign(payload: DesignPayload, files: Omit<Artifact, 'namespace' | 'id' | 'sha256' | 'byteLength' | 'createdAt'>[]) {
    const { artifacts: _artifacts, ...design } = payload; void _artifacts;
    change(() => [create('design', design)]);
    return files.length ? 'Saved to your account without its image files. Image files are kept only with designs saved in this browser.' : '';
  }
  // For import: send one batch directly and read the account back. Both throw on failure.
  const send = (mutations: Mutation[]) => enqueue(async () => { const stored = apply((await sendBody(requestBody(mutations))).changes); await persist(stored); render(); });
  const reload = () => enqueue(async current => { await pull(current); return [...confirmed.current.values()]; })
    .then(all => { if (!all) throw new AccountLibraryError(0, 'The account changed.'); return all; });
  const ofType = <T,>(type: RecordType) => records.filter(record => record.type === type && !record.deletedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) as LibraryRecord<T>[];
  return {
    kind: 'account' as const, loading, status, waiting, send, reload, records, warning, artifacts: [] as ArtifactMeta[], addDesign,
    readArtifact: async (_id: string): Promise<Artifact> => { void _id; throw new Error('Image files are not stored in your account yet.'); },
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
