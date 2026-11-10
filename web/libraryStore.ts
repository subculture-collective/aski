import { LIBRARY_NAMESPACE, parseRecord } from '../shared/library.ts';
import type { LibraryRecord } from '../shared/library.ts';
// IndexedDB keeps the local library; it can later hold artifact bytes, which localStorage cannot.
const DATABASE = 'aski-library';
const STORE = 'records';
let opening: Promise<IDBDatabase> | null = null;
function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
}
function open() {
  opening ||= new Promise<IDBDatabase>((resolve, reject) => {
    const pending = indexedDB.open(DATABASE, 1);
    pending.onupgradeneeded = () => {
      const store = pending.result.createObjectStore(STORE, { keyPath: ['namespace', 'id'] });
      store.createIndex('namespace', 'namespace');
    };
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
    pending.onblocked = () => reject(new Error('Library upgrade blocked by another tab.'));
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
// Deletes in one transaction so a collection and its memberships disappear together.
export async function deleteRecords(records: LibraryRecord[]) {
  const transaction = (await open()).transaction(STORE, 'readwrite');
  for (const record of records) transaction.objectStore(STORE).delete([record.namespace, record.id]);
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error); });
}
