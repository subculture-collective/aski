import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LibraryRecord } from './library.ts';
import { nextRevision, pendingView, resolveRejection } from './outbox.ts';
import type { Mutation, OutboxEntry } from './outbox.ts';
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const AT = '2026-11-12T00:00:00.000Z';
const account = (type: LibraryRecord['type'], payload: unknown, revision = 1, deletedAt: string | null = null): LibraryRecord =>
  ({ namespace: 'account:x', id: id(), type, schemaVersion: 1, payload, revision, deletedAt, createdAt: AT, updatedAt: AT });
const entry = (...mutations: Mutation[]): OutboxEntry => ({ id: id(), at: AT, mutations });
const update = (record: { id: string; type: LibraryRecord['type'] }, base: number, payload: unknown): Mutation => ({ requestId: id(), entityId: record.id, baseRevision: base, type: record.type, schemaVersion: 1, payload });
const remove = (entityId: string, base: number): Mutation => ({ requestId: id(), entityId, baseRevision: base, delete: true });
test('queued changes to one record chain their revisions and show in the pending view', () => {
  const design = account('collection', { name: 'A' }, 3);
  const confirmed = new Map([[design.id, design]]);
  const outbox = [entry(update(design, nextRevision(confirmed, [], design.id), { name: 'B' }))];
  outbox.push(entry(update(design, nextRevision(confirmed, outbox, design.id), { name: 'C' })));
  assert.deepEqual(outbox.map(e => e.mutations[0].baseRevision), [3, 4]);
  const view = pendingView(confirmed.values(), outbox, 'account:x');
  assert.equal((view[0].payload as { name: string }).name, 'C'); assert.equal(view[0].revision, 5);
});
test('a queued delete hides the record and its collection entries without touching the members', () => {
  const collection = account('collection', { name: 'Keep' }); const favorite = account('favorite', { familyId: 'figlet/future' });
  const link = account('membership', { collectionId: collection.id, itemType: 'favorite', itemId: favorite.id });
  const view = pendingView([collection, favorite, link], [entry(remove(collection.id, 1))], 'account:x');
  assert.deepEqual(view.filter(r => r.deletedAt).map(r => r.id).sort(), [collection.id, link.id].sort());
  assert.equal(view.find(r => r.id === favorite.id)!.deletedAt, null);
});
test('a concurrent edit keeps the server version and turns the local edit into a named copy; later edits follow it', () => {
  const design = account('collection', { name: 'Shared' }, 4);
  const first = update(design, 4, { name: 'Mine' }), second = update(design, 5, { name: 'Mine again' });
  const link: Mutation = { requestId: id(), entityId: id(), baseRevision: 0, type: 'membership', schemaVersion: 1, payload: { collectionId: design.id, itemType: 'favorite', itemId: id() } };
  const result = resolveRejection([entry(first), entry(second, link)], { status: 409, message: 'changed', entityId: design.id, record: { ...design, revision: 5, payload: { name: 'Theirs' } } }, id);
  const [copy] = result.outbox[0].mutations as (Mutation & { payload: { name: string } })[];
  assert.notEqual(copy.entityId, design.id); assert.equal(copy.baseRevision, 0); assert.equal(copy.payload.name, 'Mine (conflicting copy)');
  const [again, moved] = result.outbox[1].mutations as (Mutation & { payload: { name?: string; collectionId?: string } })[];
  assert.equal(again.entityId, copy.entityId); assert.equal(again.baseRevision, 1); assert.equal(moved.payload.collectionId, copy.entityId);
  assert.match(result.notice, /Both versions are kept/);
  assert.equal(result.outbox[0].body, undefined);
});
test('an edit of a record deleted elsewhere is recovered as a new item; a delete is never replayed as a create', () => {
  const input = account('input', { text: 'x', name: 'N'.repeat(120) }, 2);
  const edited = resolveRejection([entry(update(input, 2, { text: 'y', name: 'N'.repeat(120) }))], { status: 409, message: 'changed', entityId: input.id, record: { ...input, revision: 3, deletedAt: AT, payload: null } }, id);
  const [created] = edited.outbox[0].mutations as (Mutation & { payload: { name: string; text: string } })[];
  assert.equal(created.baseRevision, 0); assert.equal(created.payload.text, 'y');
  assert.equal(created.payload.name.length, 120); assert.match(created.payload.name, / \(recovered\)$/);
  const missing = resolveRejection([entry(update(input, 2, { text: 'z', name: 'Z' }))], { status: 404, message: 'missing', entityId: input.id }, id);
  assert.equal((missing.outbox[0].mutations[0] as Mutation & { baseRevision: number }).baseRevision, 0);
  // Deletes are dropped, never converted.
  for (const record of [{ ...input, revision: 3, deletedAt: AT, payload: null }, { ...input, revision: 3 }]) {
    const result = resolveRejection([entry(remove(input.id, 2))], { status: 409, message: 'changed', entityId: input.id, record }, id);
    assert.deepEqual(result.outbox, []);
    assert.equal(!!result.notice, !record.deletedAt);
  }
  assert.deepEqual(resolveRejection([entry(remove(input.id, 2))], { status: 404, message: 'missing', entityId: input.id }, id).outbox, []);
});
test('a duplicate favorite uses the account one, and queued references move to it', () => {
  const mine = id(); const existing = account('favorite', { familyId: 'figlet/future' }, 1);
  const create: Mutation = { requestId: id(), entityId: mine, baseRevision: 0, type: 'favorite', schemaVersion: 1, payload: { familyId: 'figlet/future' } };
  const link: Mutation = { requestId: id(), entityId: id(), baseRevision: 0, type: 'membership', schemaVersion: 1, payload: { collectionId: id(), itemType: 'favorite', itemId: mine } };
  const result = resolveRejection([entry(create, link), entry(remove(mine, 1))], { status: 409, message: 'duplicate', entityId: mine, record: existing, duplicate: true }, id);
  assert.equal(result.outbox[0].mutations.length, 1);
  assert.equal(((result.outbox[0].mutations[0] as Mutation & { payload: { itemId: string } }).payload).itemId, existing.id);
  assert.deepEqual([result.outbox[1].mutations[0].entityId, result.outbox[1].mutations[0].baseRevision], [existing.id, 1]);
  assert.equal(result.notice, '');
});
test('a refusal that names no queued record drops only the refused entry and says why', () => {
  const outbox = [entry(update(account('input', { text: 'x', name: 'x' }), 1, { text: 'y', name: 'y' })), entry(remove(id(), 1))];
  const result = resolveRejection(outbox, { status: 400, message: 'Invalid library change.' }, id);
  assert.equal(result.outbox.length, 1); assert.match(result.notice, /Invalid library change/);
  // A refusal of one change in a batch removes that change and keeps the rest of the batch.
  const bad = update(account('input', { text: 'x', name: 'x' }), 1, { text: 'y', name: 'y' }); const good = remove(id(), 1);
  const partial = resolveRejection([entry(bad, good)], { status: 400, message: 'Use a name of 1–120 characters.', entityId: bad.entityId }, id);
  assert.deepEqual(partial.outbox[0].mutations, [good]);
});
