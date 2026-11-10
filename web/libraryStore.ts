import { LIBRARY_NAMESPACE, parseArtifact, parseRecord, sha256 } from '../shared/library.ts';
import type { Artifact, ArtifactMeta, LibraryRecord } from '../shared/library.ts';
// IndexedDB keeps the local library; it can later hold artifact bytes, which localStorage cannot.
const DATABASE = 'aski-library';
const STORE = 'records';
const ARTIFACTS = 'artifacts';
let opening: Promise<IDBDatabase> | null = null;
function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
}
function open() {
  opening ||= new Promise<IDBDatabase>((resolve, reject) => {
    // Version 2 adds the artifact byte store; version-1 records are kept as they are.
    const pending = indexedDB.open(DATABASE, 2);
    pending.onupgradeneeded = () => {
      for (const name of [STORE, ARTIFACTS]) if (!pending.result.objectStoreNames.contains(name))
        pending.result.createObjectStore(name, { keyPath: ['namespace', 'id'] }).createIndex('namespace', 'namespace');
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
