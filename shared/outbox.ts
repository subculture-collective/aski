import { MAX_NAME } from './library.ts';
import type { LibraryRecord, MembershipPayload, RecordType } from './library.ts';
// The signed-in library's queue of changes not yet acknowledged by the account service
// (docs/account-sync-contract.md). Entries are sent in order, one batch at a time. An entry keeps the exact
// request bytes once sent, so a retry repeats them; an entry is rewritten only after the server refused it,
// which rolls the whole batch back.
export type Mutation = { requestId: string; entityId: string; baseRevision: number }
  & ({ delete: true } | { type: RecordType; schemaVersion: 1; payload: unknown });
export interface OutboxEntry { id: string; at: string; mutations: Mutation[]; body?: string }
// A refused batch: the status, the record the refusal is about, and the server's current copy of it.
export interface Rejection { status: number; message: string; entityId?: string; record?: Omit<LibraryRecord, 'namespace'>; duplicate?: boolean }
const isDelete = (m: Mutation): m is Mutation & { delete: true } => 'delete' in m;
// The server adds exactly one revision per accepted change, so a queued change's base is the last known
// revision plus the changes already queued for the same record.
export function nextRevision(confirmed: ReadonlyMap<string, LibraryRecord>, outbox: OutboxEntry[], id: string) {
  let revision = confirmed.get(id)?.revision ?? 0;
  for (const entry of outbox) for (const m of entry.mutations) if (m.entityId === id) revision += 1;
  return revision;
}
// The library as it will be once every queued change is accepted.
export function pendingView(confirmed: Iterable<LibraryRecord>, outbox: OutboxEntry[], namespace: string): LibraryRecord[] {
  const records = new Map([...confirmed].map(record => [record.id, record]));
  for (const entry of outbox) for (const m of entry.mutations) {
    const current = records.get(m.entityId);
    if (isDelete(m)) {
      if (!current || current.deletedAt) continue;
      records.set(m.entityId, { ...current, deletedAt: entry.at, revision: current.revision + 1 });
      // The server removes a deleted item's collection entries with it.
      for (const link of records.values()) if (link.type === 'membership' && !link.deletedAt && link.payload
        && [(link.payload as MembershipPayload).collectionId, (link.payload as MembershipPayload).itemId].includes(m.entityId))
        records.set(link.id, { ...link, deletedAt: entry.at, revision: link.revision + 1 });
    } else records.set(m.entityId, { namespace, id: m.entityId, type: m.type, schemaVersion: 1, payload: m.payload, revision: (current?.revision ?? 0) + 1,
      deletedAt: null, createdAt: current?.createdAt ?? entry.at, updatedAt: entry.at });
  }
  return [...records.values()];
}
const tag = (payload: unknown, label: string) => {
  const name = (payload as { name?: unknown } | null)?.name;
  if (typeof name !== 'string') return payload;
  const suffix = ` (${label})`;
  return { ...(payload as object), name: name.slice(0, MAX_NAME - suffix.length).trimEnd() + suffix };
};
const label = (m: Mutation) => {
  const name = isDelete(m) ? undefined : (m.payload as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? `“${name}”` : 'An item';
};
// Rewrites the first entry after the server refused it. The policy:
// - Concurrent edit: the server's version stays; the local edit becomes a new item named as a conflicting copy.
// - Edit of an item deleted elsewhere (or unknown to the account): the deletion stays; the edit becomes a new item.
// - Delete of an item edited elsewhere: the edited version is kept. A delete never turns into a create.
// - Duplicate favorite or collection entry: the account's existing one is used instead.
// Later queued changes to the same item follow it to its new UUID with matching revisions.
export function resolveRejection(outbox: OutboxEntry[], rejection: Rejection, newId: () => string = () => crypto.randomUUID()): { outbox: OutboxEntry[]; notice: string } {
  const [head, ...rest] = outbox;
  const index = rejection.entityId ? head.mutations.findIndex(m => m.entityId === rejection.entityId) : -1;
  if (index < 0) return { outbox: rest, notice: `A change could not be saved to your account: ${rejection.message}` };
  const m = head.mutations[index];
  const server = rejection.record;
  let replacement: Mutation[] = [], notice = '';
  // Later changes to m's record move to `to`; their base revision is recomputed from the old one.
  let remap: { from: string; to: string; base: (old: number) => number } | null = null;
  if (rejection.status === 409 && rejection.duplicate && server) {
    remap = { from: m.entityId, to: server.id, base: old => server.revision + old - m.baseRevision - 1 };
  } else if ((rejection.status === 409 && server) || rejection.status === 404) {
    if (isDelete(m)) notice = server && !server.deletedAt ? 'An item you deleted was changed in another session, so the changed version was kept.' : '';
    else {
      const deleted = !server || !!server.deletedAt;
      const id = newId();
      replacement = [{ requestId: newId(), entityId: id, baseRevision: 0, type: m.type, schemaVersion: 1, payload: tag(m.payload, deleted ? 'recovered' : 'conflicting copy') }];
      remap = { from: m.entityId, to: id, base: old => old - m.baseRevision };
      notice = deleted ? `${label(m)} was deleted in another session. Your edit was kept as a new item.`
        : `${label(m)} changed in another session. Both versions are kept; yours is marked as a conflicting copy.`;
    }
  } else notice = `A change could not be saved to your account: ${rejection.message}`;
  const move = (x: Mutation): Mutation => {
    if (!remap) return x;
    let next = x;
    if (x.entityId === remap.from) next = { ...x, entityId: remap.to, baseRevision: remap.base(x.baseRevision) };
    if (!isDelete(next) && next.type === 'membership') {
      const link = next.payload as MembershipPayload;
      if (link.collectionId === remap.from || link.itemId === remap.from) next = { ...next, payload: {
        ...link, collectionId: link.collectionId === remap.from ? remap.to : link.collectionId, itemId: link.itemId === remap.from ? remap.to : link.itemId } };
    }
    return next;
  };
  // Nothing after the refused batch has been sent, and the refused batch was rolled back, so both may change.
  const mutations = [...head.mutations.slice(0, index), ...replacement, ...head.mutations.slice(index + 1).map(move)];
  const later = rest.map(entry => ({ id: entry.id, at: entry.at, mutations: entry.mutations.map(move) }));
  return { outbox: mutations.length ? [{ id: head.id, at: head.at, mutations }, ...later] : later, notice };
}
