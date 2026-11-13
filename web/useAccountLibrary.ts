import { useEffect, useRef, useState } from 'react';
import { findFavorite, findMembership, parseName, parseRecord } from '../shared/library.ts';
import type { Artifact, ArtifactMeta, CollectionPayload, DesignPayload, FavoritePayload, InputPayload, LibraryRecord, MembershipPayload, PalettePayload, RecordType } from '../shared/library.ts';
import { AccountLibraryError, readChanges, sendMutations } from './accountLibrary.ts';
import type { Mutation, WireRecord } from './accountLibrary.ts';
// The signed-in library, read from and written to the account service. It has the same shape as the
// browser library so the studio's panels work with either. Changes are sent one batch at a time, each
// based on the newest revision this page has seen; the server refuses a change made from an older one.
// This page keeps no offline copy yet, so a change that cannot be sent is reported and not retried.
export function useAccountLibrary(subject: string | null, onSessionEnded: () => void) {
  const namespace = 'account:' + subject;
  const [records, setRecords] = useState<LibraryRecord[]>([]);
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const confirmed = useRef(new Map<string, LibraryRecord>());
  const cursor = useRef('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // Bumped when the account changes so replies for a previous account are ignored.
  const generation = useRef(0);
  function apply(changes: WireRecord[], current: number) {
    if (current !== generation.current) return;
    let unreadable = 0;
    for (const change of changes) {
      try {
        // A tombstone carries no payload; only its envelope is kept so the item stays deleted.
        const record = change.deletedAt ? { ...change, namespace, payload: null } as LibraryRecord : parseRecord({ ...change, namespace });
        const known = confirmed.current.get(record.id);
        if (!known || known.revision <= record.revision) confirmed.current.set(record.id, record);
      } catch { unreadable += 1; }
    }
    setRecords([...confirmed.current.values()]);
    if (unreadable) setWarning(`${unreadable} account ${unreadable === 1 ? 'item needs' : 'items need'} a newer version of aski and ${unreadable === 1 ? 'is' : 'are'} not shown.`);
  }
  // Reads every change since the last one applied. A resync answer starts again from an empty library.
  async function pull(current: number) {
    for (;;) {
      const page = await readChanges(cursor.current);
      if (current !== generation.current) return;
      if (page.resync) { cursor.current = ''; confirmed.current.clear(); continue; }
      apply(page.changes, current); cursor.current = page.cursor;
      if (!page.more) return;
    }
  }
  function report(error: unknown, current: number) {
    if (current !== generation.current) return;
    const failure = error instanceof AccountLibraryError ? error : new AccountLibraryError(0, 'Your account library is unavailable.');
    if (failure.status === 401) {
      setWarning('Your session ended. Sign in again to use your account library. Work in this browser is unchanged.');
      onSessionEnded(); return;
    }
    if (failure.status === 409 && failure.record) {
      apply([failure.record], current);
      setWarning('This item changed in another session, so your change was not saved. The latest version is shown.'); return;
    }
    if (failure.status === 404 || failure.status === 409) void pull(current).catch(() => {});
    setWarning(failure.status === 404 ? 'This item was removed in another session.'
      : failure.status === 429 ? 'Too many changes at once. Wait a minute and try again.' : `${failure.message} The change was not saved.`);
  }
  function enqueue<T>(work: (current: number) => Promise<T>) {
    const current = generation.current;
    const next = queue.current.then(() => current === generation.current ? work(current) : undefined);
    queue.current = next.catch(() => {});
    return next;
  }
  // Builds the batch from the newest records when its turn comes, so quick successive edits stay in order.
  function change(build: (records: LibraryRecord[]) => Mutation[]) {
    return enqueue(async current => {
      const mutations = build([...confirmed.current.values()]);
      if (!mutations.length) return true;
      try { const { changes } = await sendMutations(mutations); setWarning(''); apply(changes, current); return true; }
      catch (error) { report(error, current); return false; }
    }).then(ok => ok !== false);
  }
  const refresh = () => enqueue(async current => { try { await pull(current); } catch (error) { report(error, current); } });
  useEffect(() => {
    generation.current += 1; cursor.current = ''; confirmed.current.clear();
    setRecords([]); setWarning('');
    if (!subject) { setLoading(false); return; }
    setLoading(true);
    void refresh().finally(() => setLoading(false));
    // Picks up changes from other sessions when the page comes back into view.
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // refresh reads only refs, so the subject alone decides when to start over.
  }, [subject]);
  const create = (type: RecordType, payload: unknown): Mutation => ({ requestId: crypto.randomUUID(), entityId: crypto.randomUUID(), baseRevision: 0, type, schemaVersion: 1, payload });
  const remove = (record: LibraryRecord) => void change(all => {
    const current = all.find(item => item.id === record.id);
    return current && !current.deletedAt ? [{ requestId: crypto.randomUUID(), entityId: current.id, baseRevision: current.revision, delete: true }] : [];
  });
  function rename(record: LibraryRecord<InputPayload | DesignPayload | CollectionPayload>, name: string) {
    const valid = parseName(name);
    void change(all => {
      const current = all.find(item => item.id === record.id);
      return current && !current.deletedAt ? [{ requestId: crypto.randomUUID(), entityId: current.id, baseRevision: current.revision, type: current.type, schemaVersion: 1,
        payload: { ...(current.payload as object), name: valid } }] : [];
    });
  }
  // Image files are not stored in accounts yet, so a design is saved with its recipe and exact text only.
  async function addDesign(payload: DesignPayload, files: Omit<Artifact, 'namespace' | 'id' | 'sha256' | 'byteLength' | 'createdAt'>[]) {
    const { artifacts: _artifacts, ...design } = payload; void _artifacts;
    if (!await change(() => [create('design', design)])) return 'Could not save this design to your account. Your draft is unchanged.';
    return files.length ? 'Saved to your account without its image files. Image files are kept only with designs saved in this browser.' : '';
  }
  const ofType = <T,>(type: RecordType) => records.filter(record => record.type === type && !record.deletedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) as LibraryRecord<T>[];
  // For import: send one batch in order with other changes, and read the account back. Both throw on failure.
  const send = (mutations: Mutation[]) => enqueue(async current => { apply((await sendMutations(mutations)).changes, current); });
  const reload = () => enqueue(async current => { await pull(current); return [...confirmed.current.values()]; })
    .then(records => { if (!records) throw new AccountLibraryError(0, 'The account changed.'); return records; });
  return {
    kind: 'account' as const, loading, send, reload, records, warning, artifacts: [] as ArtifactMeta[], addDesign,
    readArtifact: async (_id: string): Promise<Artifact> => { void _id; throw new Error('Image files are not stored in your account yet.'); },
    palettes: ofType<PalettePayload>('palette'), collections: ofType<CollectionPayload>('collection'), favorites: ofType<FavoritePayload>('favorite'),
    inputs: ofType<InputPayload>('input'), designs: ofType<DesignPayload>('design'),
    add: <T,>(type: RecordType, payload: T) => void change(() => [create(type, payload)]),
    rename, remove, removeFavorite: remove, isFavorite: (favorite: FavoritePayload) => !!findFavorite(records, favorite),
    toggleFavorite: (favorite: FavoritePayload) => void change(all => {
      const existing = findFavorite(all, favorite);
      return existing ? [{ requestId: crypto.randomUUID(), entityId: existing.id, baseRevision: existing.revision, delete: true }] : [create('favorite', favorite)];
    }),
    toggleMembership: (collectionId: string, item: LibraryRecord<FavoritePayload | DesignPayload>) => void change(all => {
      const existing = findMembership(all, collectionId, item.id);
      return existing ? [{ requestId: crypto.randomUUID(), entityId: existing.id, baseRevision: existing.revision, delete: true }]
        : [create('membership', { collectionId, itemType: item.type as MembershipPayload['itemType'], itemId: item.id })];
    }),
  };
}
