import { getFamily, getVariant } from './catalog.ts';
import { RECIPE_VERSIONS, parseColors } from './recipe.ts';
import type { Colors, StoredRecipe } from './recipe.ts';
// Local library records follow the account contract's envelope (docs/account-sync-contract.md):
// UUID, type, schemaVersion, payload and revision. Anonymous records stay in the "anonymous" namespace;
// revision 0 means the record has never been acknowledged by a server.
export const LIBRARY_NAMESPACE = 'anonymous';
export const RECORD_TYPES = ['input', 'palette', 'design', 'favorite', 'collection', 'membership'] as const;
export type RecordType = typeof RECORD_TYPES[number];
export interface FavoritePayload { familyId: string; variantId?: string }
export interface InputPayload { text: string; name: string }
export interface CollectionPayload { name: string }
// Collections hold reusable styles (favorites) and exact saved designs by reference.
export const MEMBER_TYPES = ['favorite', 'design'] as const;
export interface MembershipPayload { collectionId: string; itemType: typeof MEMBER_TYPES[number]; itemId: string }
// A design keeps the editable recipe and the exact text it produced when saved. The snapshot is never
// re-rendered, so a later font or renderer change cannot alter it.
export interface PalettePayload { name: string; slots: Colors }
export interface DesignPayload { name: string; recipe: StoredRecipe; snapshot: { text: string; columns: number; rows: number }; artifacts?: string[] }
// Immutable exported bytes kept with a saved design. They are never regenerated; the hash proves it.
export const ARTIFACT_TYPES = ['image/png', 'image/svg+xml', 'image/gif'] as const;
export interface ArtifactMeta {
  namespace: string; id: string; sha256: string; mime: typeof ARTIFACT_TYPES[number]; byteLength: number; width: number; height: number;
  provenance: { variantId: string; fontSha256: string; rendererVersion: string }; createdAt: string;
}
export interface Artifact extends ArtifactMeta { bytes: Uint8Array }
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
  if (r.type === 'collection') parseName((r.payload as Partial<CollectionPayload> | null)?.name);
  if (r.type === 'membership') parseMembership(r.payload);
  if (r.type === 'palette') parsePalette(r.payload);
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
  const recipe = p?.recipe as Partial<StoredRecipe> | undefined;
  const snapshot = p?.snapshot;
  if (!recipe || !RECIPE_VERSIONS.includes(recipe.schemaVersion!) || typeof recipe.input !== 'string' || typeof recipe.familyId !== 'string'
    || typeof recipe.variantId !== 'string' || typeof recipe.fontSha256 !== 'string' || typeof recipe.rendererVersion !== 'string') throw new Error('Invalid saved design.');
  if (!snapshot || typeof snapshot.text !== 'string' || !Number.isInteger(snapshot.columns) || !Number.isInteger(snapshot.rows)) throw new Error('Invalid saved design.');
  if (p!.artifacts !== undefined && (!Array.isArray(p!.artifacts) || p!.artifacts.some(id => typeof id !== 'string' || !UUID.test(id)))) throw new Error('Invalid saved design.');
  return { name: parseName(p!.name), recipe: recipe as StoredRecipe, snapshot: { text: snapshot.text, columns: snapshot.columns, rows: snapshot.rows },
    ...(p!.artifacts ? { artifacts: [...p!.artifacts] } : {}) };
}
// Default names come from the first line of text, shortened to fit a list.
export function defaultName(text: string, prefix = '') {
  const line = Array.from(text.split(/\r?\n/).find(item => item.trim()) || 'Untitled').slice(0, 40).join('').trim();
  return (prefix ? `${prefix}: ${line}` : line).slice(0, MAX_NAME);
}
export function parseMembership(value: unknown): MembershipPayload {
  const p = value as Partial<MembershipPayload> | null;
  if (!p || typeof p.collectionId !== 'string' || !UUID.test(p.collectionId) || typeof p.itemId !== 'string' || !UUID.test(p.itemId)
    || !MEMBER_TYPES.includes(p.itemType as MembershipPayload['itemType'])) throw new Error('Invalid collection membership.');
  return { collectionId: p.collectionId, itemType: p.itemType!, itemId: p.itemId };
}
const live = (records: LibraryRecord[]) => records.filter(record => !record.deletedAt);
// Membership is unique per collection and item.
export function findMembership(records: LibraryRecord[], collectionId: string, itemId: string) {
  return live(records).find(record => record.type === 'membership'
    && (record.payload as MembershipPayload).collectionId === collectionId && (record.payload as MembershipPayload).itemId === itemId) as LibraryRecord<MembershipPayload> | undefined;
}
// Records to delete with a collection or item: the record and the memberships that point at it.
// Removing a collection never removes the favorites or designs inside it.
export function cascade(records: LibraryRecord[], target: LibraryRecord) {
  return [target, ...live(records).filter(record => record.type === 'membership'
    && ((record.payload as MembershipPayload).collectionId === target.id || (record.payload as MembershipPayload).itemId === target.id))];
}
// Members in insertion order, skipping references to items that no longer exist.
export function membersOf(records: LibraryRecord[], collectionId: string) {
  const items = new Map(live(records).map(record => [record.id, record]));
  return live(records).filter(record => record.type === 'membership' && (record.payload as MembershipPayload).collectionId === collectionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(record => items.get((record.payload as MembershipPayload).itemId)).filter(item => item && item.type !== 'membership') as LibraryRecord<FavoritePayload | DesignPayload>[];
}
// A saved palette assigns a #RRGGBB color to every known slot.
export function parsePalette(value: unknown): PalettePayload {
  const p = value as Partial<PalettePayload> | null;
  if (!p) throw new Error('Invalid palette.');
  return { name: parseName(p.name), slots: parseColors(p.slots) };
}
export function parseArtifact(value: unknown): Artifact {
  const a = value as Partial<Artifact> | null;
  if (!a || typeof a.id !== 'string' || !UUID.test(a.id) || typeof a.sha256 !== 'string' || !/^[\da-f]{64}$/.test(a.sha256)
    || !ARTIFACT_TYPES.includes(a.mime as Artifact['mime']) || !(a.bytes instanceof Uint8Array) || a.bytes.length !== a.byteLength) throw new Error('Invalid saved file.');
  return a as Artifact;
}
// Artifacts that no remaining design references, for deletion together with a design.
export function orphanedArtifacts(records: LibraryRecord[], removed: LibraryRecord) {
  const used = new Set(records.filter(record => record.id !== removed.id && record.type === 'design' && !record.deletedAt)
    .flatMap(record => (record.payload as DesignPayload).artifacts || []));
  return ((removed.payload as DesignPayload).artifacts || []).filter(id => !used.has(id));
}
export async function sha256(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
