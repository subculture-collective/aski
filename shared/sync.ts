import { findFavorite, findMembership } from './library.ts';
import type { DesignPayload, FavoritePayload, LibraryRecord, MembershipPayload, RecordType } from './library.ts';
// Explicit import of the browser library into an account (docs/account-sync-contract.md). Each local record
// gets one account UUID, kept in a per-account map that is saved before anything is sent. A record whose
// mapped UUID is already in the account (live or deleted there) is not sent again, so an interrupted or
// repeated import never duplicates work and never brings back something deleted in the account.
export type ImportMap = Record<string, string>;
export interface ImportCreate { localId: string; mutation: { requestId: string; entityId: string; baseRevision: 0; type: RecordType; schemaVersion: 1; payload: unknown } }
export interface ImportPlan { map: ImportMap; creates: ImportCreate[]; already: number; skipped: number; withoutFiles: number }
// Referenced records come before the records that reference them.
const ORDER: RecordType[] = ['input', 'palette', 'favorite', 'design', 'collection', 'membership'];
export function planImport(local: LibraryRecord[], remote: LibraryRecord[], map: ImportMap, newId: () => string = () => crypto.randomUUID()): ImportPlan {
  const next: ImportMap = { ...map };
  const known = new Map(remote.map(record => [record.id, record]));
  const live = remote.filter(record => !record.deletedAt);
  const creates: ImportCreate[] = [];
  let already = 0, skipped = 0, withoutFiles = 0;
  const items = local.filter(record => !record.deletedAt)
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.createdAt.localeCompare(b.createdAt));
  // A UUID this import will create counts as present for references later in the same plan.
  const creating = new Set<string>();
  const present = (id: string | undefined) => !!id && (creating.has(id) || (known.has(id) && !known.get(id)!.deletedAt));
  for (const record of items) {
    const mapped = next[record.id];
    if (mapped && known.has(mapped)) { already += 1; continue; }
    let payload = record.payload;
    if (record.type === 'favorite') {
      // The account keeps one favorite per family and variant.
      const existing = findFavorite(live, record.payload as FavoritePayload);
      if (existing) { next[record.id] = existing.id; already += 1; continue; }
    }
    if (record.type === 'design') {
      // Image files stay in this browser until artifact sync; the recipe and exact text are imported.
      const { artifacts, ...design } = record.payload as DesignPayload;
      if (artifacts?.length) withoutFiles += 1;
      payload = design;
    }
    if (record.type === 'membership') {
      const link = record.payload as MembershipPayload;
      const collectionId = next[link.collectionId], itemId = next[link.itemId];
      // A membership needs both ends in the account; one whose collection or item was deleted there is left out.
      if (!present(collectionId) || !present(itemId)) { skipped += 1; continue; }
      if (findMembership(live, collectionId, itemId)) { already += 1; continue; }
      payload = { collectionId, itemType: link.itemType, itemId };
    }
    const entityId = mapped || newId();
    next[record.id] = entityId; creating.add(entityId);
    creates.push({ localId: record.id, mutation: { requestId: newId(), entityId, baseRevision: 0, type: record.type, schemaVersion: 1, payload } });
  }
  return { map: next, creates, already, skipped, withoutFiles };
}
// What the import will add, by type, for the confirmation shown before anything is written.
export function importScope(plan: ImportPlan) {
  const counts = new Map<RecordType, number>();
  for (const { mutation } of plan.creates) counts.set(mutation.type, (counts.get(mutation.type) || 0) + 1);
  const names: Record<RecordType, [string, string]> = { input: ['saved text', 'saved texts'], palette: ['palette', 'palettes'], favorite: ['favorite', 'favorites'],
    design: ['design', 'designs'], collection: ['collection', 'collections'], membership: ['collection entry', 'collection entries'] };
  return ORDER.filter(type => counts.get(type)).map(type => `${counts.get(type)} ${names[type][counts.get(type) === 1 ? 0 : 1]}`);
}
