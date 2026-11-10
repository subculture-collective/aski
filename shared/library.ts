import { getFamily, getVariant } from './catalog.ts';
// Local library records follow the account contract's envelope (docs/account-sync-contract.md):
// UUID, type, schemaVersion, payload and revision. Anonymous records stay in the "anonymous" namespace;
// revision 0 means the record has never been acknowledged by a server.
export const LIBRARY_NAMESPACE = 'anonymous';
export const RECORD_TYPES = ['input', 'palette', 'design', 'favorite', 'collection', 'membership'] as const;
export type RecordType = typeof RECORD_TYPES[number];
export interface FavoritePayload { familyId: string; variantId?: string }
export interface LibraryRecord<T = unknown> {
  namespace: string; id: string; type: RecordType; schemaVersion: 1; payload: T;
  revision: number; deletedAt: string | null; createdAt: string; updatedAt: string;
}
const UUID = /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i;
export function createRecord<T>(type: RecordType, payload: T, now = new Date().toISOString(), id: string = crypto.randomUUID()): LibraryRecord<T> {
  return { namespace: LIBRARY_NAMESPACE, id, type, schemaVersion: 1, payload, revision: 0, deletedAt: null, createdAt: now, updatedAt: now };
}
// Throws for records this version cannot read. Callers keep such records untouched in storage.
export function parseRecord(value: unknown): LibraryRecord {
  const r = value as Partial<LibraryRecord> | null;
  if (!r || typeof r !== 'object') throw new Error('Invalid library record.');
  if (r.schemaVersion !== 1) throw new Error('This library record version is not supported.');
  if (typeof r.id !== 'string' || !UUID.test(r.id)) throw new Error('Invalid library record ID.');
  if (!RECORD_TYPES.includes(r.type as RecordType)) throw new Error('Unknown library record type.');
  if (typeof r.namespace !== 'string' || !Number.isInteger(r.revision) || r.revision! < 0) throw new Error('Invalid library record.');
  if (r.type === 'favorite') parseFavorite(r.payload);
  return r as LibraryRecord;
}
// A favorite names a stable family and, optionally, one of its variants. It never holds text or output.
export function parseFavorite(value: unknown): FavoritePayload {
  const p = value as Partial<FavoritePayload> | null;
  if (!p || typeof p.familyId !== 'string') throw new Error('Invalid favorite.');
  getFamily(p.familyId);
  if (p.variantId !== undefined && (typeof p.variantId !== 'string' || getVariant(p.variantId).familyId !== p.familyId)) throw new Error('This font is not available.');
  return p.variantId === undefined ? { familyId: p.familyId } : { familyId: p.familyId, variantId: p.variantId };
}
export const favoriteKey = (favorite: FavoritePayload) => `${favorite.familyId}\u0000${favorite.variantId ?? ''}`;
// Favorites are unique by family/variant within a namespace.
export function findFavorite(records: LibraryRecord[], favorite: FavoritePayload) {
  const key = favoriteKey(favorite);
  return records.find(record => record.type === 'favorite' && !record.deletedAt && favoriteKey(record.payload as FavoritePayload) === key);
}
