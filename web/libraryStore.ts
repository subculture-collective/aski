import { LIBRARY_NAMESPACE, createRecord, findFavorite, parseArtifact, parseRecord, sha256 } from '../shared/library.ts';
import type { Artifact, ArtifactMeta, FavoritePayload, LibraryRecord, MembershipPayload, RecordType } from '../shared/library.ts';
import type { OutboxEntry } from '../shared/outbox.ts';
// IndexedDB keeps the local library; it can later hold artifact bytes, which localStorage cannot.
const DATABASE = 'aski-library';
const STORE = 'records';
const ARTIFACTS = 'artifacts';
const IMPORTS = 'imports';
const SYNC = 'sync';
let opening: Promise<IDBDatabase> | null = null;
function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
}
function open() {
  opening ||= new Promise<IDBDatabase>((resolve, reject) => {
    // Version 2 adds the artifact byte store, version 3 the import maps and version 4 the per-account sync
    // state; existing records are kept as they are.
    const pending = indexedDB.open(DATABASE, 4);
    pending.onupgradeneeded = () => {
      for (const name of [STORE, ARTIFACTS]) if (!pending.result.objectStoreNames.contains(name))
        pending.result.createObjectStore(name, { keyPath: ['namespace', 'id'] }).createIndex('namespace', 'namespace');
      for (const name of [IMPORTS, SYNC]) if (!pending.result.objectStoreNames.contains(name)) pending.result.createObjectStore(name, { keyPath: 'subject' });
    };
    pending.onsuccess = () => {
      // Let another tab running a newer build upgrade the database; this tab reopens on its next use.
      pending.result.onversionchange = () => { pending.result.close(); opening = null; };
      resolve(pending.result);
    };
    pending.onerror = () => reject(pending.error);
    pending.onblocked = () => reject(new Error('blocked'));
  });
  opening.catch(() => { opening = null; });
  return opening;
}
async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  const transaction = (await open()).transaction(STORE, mode);
  const result = request(work(transaction.objectStore(STORE)));
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error); });
  return result;
}
// Unreadable records (unknown versions or fonts) are reported but never rewritten or removed.
export async function loadLibrary(namespace = LIBRARY_NAMESPACE) {
  const rows = await transact('readonly', store => store.index('namespace').getAll(namespace));
  const records: LibraryRecord[] = [];
  let unreadable = 0;
  for (const row of rows) { try { records.push(parseRecord(row)); } catch { unreadable += 1; } }
  return { records, unreadable };
}
export const putRecord = (record: LibraryRecord) => transact('readwrite', store => store.put(parseRecord(record)));
// Anonymous records have never been synced, so removing one deletes it outright.
// Deletes in one transaction so a collection and its memberships, or a design and its unused files,
// disappear together.
// A file is deleted only if no stored record still lists it, including records this build cannot read.
export async function deleteRecords(records: LibraryRecord[], artifacts: string[] = [], namespace = LIBRARY_NAMESPACE) {
  const transaction = (await open()).transaction([STORE, ARTIFACTS], 'readwrite');
  for (const record of records) transaction.objectStore(STORE).delete([record.namespace, record.id]);
  if (artifacts.length) {
    const rows = transaction.objectStore(STORE).index('namespace').getAll(namespace);
    rows.onsuccess = () => {
      const doomed = new Set(records.map(record => record.id));
      const used = new Set(rows.result.filter(row => !doomed.has(row?.id)).flatMap(row => Array.isArray(row?.payload?.artifacts) ? row.payload.artifacts : []));
      for (const id of artifacts) if (!used.has(id)) transaction.objectStore(ARTIFACTS).delete([namespace, id]);
    };
  }
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error); });
}
// Stores a design and its files in one transaction: either all of them are saved or none are.
export async function putDesignWithArtifacts(design: LibraryRecord, artifacts: Artifact[]) {
  const transaction = (await open()).transaction([STORE, ARTIFACTS], 'readwrite');
  for (const artifact of artifacts) transaction.objectStore(ARTIFACTS).put(parseArtifact(artifact));
  transaction.objectStore(STORE).put(parseRecord(design));
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error); });
}
// Metadata only; bytes are read when a file is downloaded.
export async function loadArtifactMeta(namespace = LIBRARY_NAMESPACE): Promise<ArtifactMeta[]> {
  const transaction = (await open()).transaction(ARTIFACTS, 'readonly');
  const rows = await request(transaction.objectStore(ARTIFACTS).index('namespace').getAll(namespace));
  return rows.map(({ bytes: _bytes, ...meta }) => { void _bytes; return meta as ArtifactMeta; });
}
// Returns the stored bytes after checking they still match their recorded hash.
export async function readArtifact(id: string, namespace = LIBRARY_NAMESPACE) {
  const transaction = (await open()).transaction(ARTIFACTS, 'readonly');
  const artifact = parseArtifact(await request(transaction.objectStore(ARTIFACTS).get([namespace, id])));
  if (await sha256(artifact.bytes) !== artifact.sha256) throw new Error('This saved file is damaged.');
  return artifact;
}
// One map per account from browser record UUIDs to account UUIDs. It holds IDs only, never content or tokens.
export async function loadImportMap(subject: string): Promise<Record<string, string>> {
  const transaction = (await open()).transaction(IMPORTS, 'readonly');
  const row = await request(transaction.objectStore(IMPORTS).get(subject));
  return row?.map && typeof row.map === 'object' ? row.map : {};
}
export async function saveImportMap(subject: string, map: Record<string, string>) {
  const transaction = (await open()).transaction(IMPORTS, 'readwrite');
  transaction.objectStore(IMPORTS).put({ subject, map });
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error); });
}
// Per account: the change-log cursor, the queue of unsent changes and the address to name it by. The account's
// records are cached in the record store under the namespace "account:<subject>"; tombstones keep only
// their envelope. No session token is ever stored.
export interface SyncState { subject: string; email: string; cursor: string; outbox: OutboxEntry[] }
const done = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error); });
export async function loadAccountCache(subject: string) {
  const transaction = (await open()).transaction([STORE, SYNC], 'readonly');
  const [rows, state] = await Promise.all([request(transaction.objectStore(STORE).index('namespace').getAll('account:' + subject)), request(transaction.objectStore(SYNC).get(subject))]);
  const records: LibraryRecord[] = [];
  for (const row of rows) { try { records.push(row?.deletedAt ? { ...row, payload: null } : parseRecord(row)); } catch { /* left in storage unread */ } }
  return { records, state: (state as SyncState | undefined) ?? { subject, email: '', cursor: '', outbox: [] } };
}
// Applies a page of changes and the matching sync state in one transaction, so the cursor never moves
// past changes that were not stored. A resync clears the cached records first.
export async function saveAccountCache(state: SyncState, changes: LibraryRecord[] = [], replace = false) {
  const transaction = (await open()).transaction([STORE, SYNC], 'readwrite');
  const store = transaction.objectStore(STORE);
  if (replace) { const keys = store.index('namespace').getAllKeys('account:' + state.subject); keys.onsuccess = () => { for (const key of keys.result) store.delete(key); write(); }; }
  else write();
  function write() { for (const record of changes) store.put(record); transaction.objectStore(SYNC).put(state); }
  await done(transaction);
}
// On sign-out the cached account records are removed. Unsent changes stay, bound to their account.
export async function forgetAccountCache(subject: string) {
  const transaction = (await open()).transaction([STORE, SYNC], 'readwrite');
  const keys = transaction.objectStore(STORE).index('namespace').getAllKeys('account:' + subject);
  keys.onsuccess = () => { for (const key of keys.result) transaction.objectStore(STORE).delete(key); };
  const state = transaction.objectStore(SYNC).get(subject);
  state.onsuccess = () => { if (state.result) transaction.objectStore(SYNC).put({ ...state.result, cursor: '' }); };
  await done(transaction);
}
export async function waitingChanges(): Promise<SyncState[]> {
  const transaction = (await open()).transaction(SYNC, 'readonly');
  return ((await request(transaction.objectStore(SYNC).getAll())) as SyncState[]).filter(state => state.outbox?.length);
}
// Copies an account's unsent changes into this browser's library as new items, then clears them, in one
// transaction. Deletions are not copied. Collection entries are kept when both ends were copied.
export async function copyWaitingToBrowser(subject: string) {
  const transaction = (await open()).transaction([STORE, SYNC], 'readwrite');
  const state = await request(transaction.objectStore(SYNC).get(subject)) as SyncState | undefined;
  const latest = new Map<string, { type: RecordType; payload: unknown }>();
  for (const entry of state?.outbox ?? []) for (const m of entry.mutations) {
    if ('delete' in m) latest.delete(m.entityId); else latest.set(m.entityId, { type: m.type, payload: m.payload });
  }
  const ids = new Map<string, string>([...latest.keys()].map(id => [id, crypto.randomUUID()]));
  const local = (await request(transaction.objectStore(STORE).index('namespace').getAll(LIBRARY_NAMESPACE))).filter(row => !row?.deletedAt);
  let copied = 0;
  const put = (type: RecordType, payload: unknown, id: string) => {
    try { transaction.objectStore(STORE).put(parseRecord(createRecord(type, payload, undefined, id))); copied += 1; } catch { /* a change this build cannot read is not copied */ }
  };
  // Items first, then collection entries, so every entry can find both ends.
  for (const [id, { type, payload }] of latest) {
    if (type === 'membership') continue;
    // This browser keeps one favorite per style; an equal one already here is used instead.
    const existing = type === 'favorite' ? findFavorite(local, payload as FavoritePayload) : undefined;
    if (existing) ids.set(id, existing.id); else put(type, payload, ids.get(id)!);
  }
  for (const [, { type, payload }] of latest) {
    if (type !== 'membership') continue;
    const link = payload as MembershipPayload;
    if (latest.has(link.collectionId) && latest.get(link.itemId)?.type === link.itemType)
      put('membership', { ...link, collectionId: ids.get(link.collectionId), itemId: ids.get(link.itemId) }, crypto.randomUUID());
  }
  if (state) transaction.objectStore(SYNC).put({ ...state, outbox: [] });
  await done(transaction);
  return copied;
}
export async function discardWaiting(subject: string) {
  const transaction = (await open()).transaction(SYNC, 'readwrite');
  const state = transaction.objectStore(SYNC).get(subject);
  state.onsuccess = () => { if (state.result) transaction.objectStore(SYNC).put({ ...state.result, outbox: [] }); };
  await done(transaction);
}
