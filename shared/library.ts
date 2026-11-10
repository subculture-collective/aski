import { getFamily, getVariant } from './catalog.ts';
import type { RecipeV1 } from './recipe.ts';
// Local library records follow the account contract's envelope (docs/account-sync-contract.md):
// UUID, type, schemaVersion, payload and revision. Anonymous records stay in the "anonymous" namespace;
// revision 0 means the record has never been acknowledged by a server.
export const LIBRARY_NAMESPACE = 'anonymous';
export const RECORD_TYPES = ['input', 'palette', 'design', 'favorite', 'collection', 'membership'] as const;
export type RecordType = typeof RECORD_TYPES[number];
export interface FavoritePayload { familyId: string; variantId?: string }
export interface InputPayload { text: string; name: string }
// A design keeps the editable recipe and the exact text it produced when saved. The snapshot is never
// re-rendered, so a later font or renderer change cannot alter it.
export interface DesignPayload { name: string; recipe: RecipeV1; snapshot: { text: string; columns: number; rows: number } }
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
  if (r.type === 'input') parseInput(r.payload);
  if (r.type === 'design') parseDesign(r.payload);
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
export const MAX_NAME = 120;
export function parseName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_NAME) throw new Error(`Use a name of 1–${MAX_NAME} characters.`);
  return value.trim();
}
// Saved text keeps the editor's own limit so an over-length draft can still be kept.
export function parseInput(value: unknown): InputPayload {
  const p = value as Partial<InputPayload> | null;
  if (!p || typeof p.text !== 'string' || p.text.length > 100_000) throw new Error('Invalid saved text.');
  return { text: p.text, name: parseName(p.name) };
}
// Recipe provenance is stored as written. Whether this build can still render it is checked on open.
export function parseDesign(value: unknown): DesignPayload {
  const p = value as Partial<DesignPayload> | null;
  const recipe = p?.recipe as Partial<RecipeV1> | undefined;
  const snapshot = p?.snapshot;
  if (!recipe || recipe.schemaVersion !== 1 || typeof recipe.input !== 'string' || typeof recipe.familyId !== 'string'
    || typeof recipe.variantId !== 'string' || typeof recipe.fontSha256 !== 'string' || typeof recipe.rendererVersion !== 'string') throw new Error('Invalid saved design.');
  if (!snapshot || typeof snapshot.text !== 'string' || !Number.isInteger(snapshot.columns) || !Number.isInteger(snapshot.rows)) throw new Error('Invalid saved design.');
  return { name: parseName(p!.name), recipe: recipe as RecipeV1, snapshot: { text: snapshot.text, columns: snapshot.columns, rows: snapshot.rows } };
}
// Default names come from the first line of text, shortened to fit a list.
export function defaultName(text: string, prefix = '') {
  const line = Array.from(text.split(/\r?\n/).find(item => item.trim()) || 'Untitled').slice(0, 40).join('').trim();
  return (prefix ? `${prefix}: ${line}` : line).slice(0, MAX_NAME);
}
