import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from './library.ts';
import type { LibraryRecord } from './library.ts';
import { importScope, planImport } from './sync.ts';
import { FONT } from './recipe.ts';
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
let clock = 0;
const local = <T,>(type: LibraryRecord['type'], payload: T) => createRecord(type, payload, new Date(Date.UTC(2026, 10, 10, 0, 0, ++clock)).toISOString(), id());
const recipe = { schemaVersion: 1, id: id(), input: 'HI', familyId: FONT.familyId, variantId: FONT.variantId, fontSha256: FONT.sha256, rendererVersion: FONT.rendererVersion };
// The account copy of a planned record, as the server would return it.
const stored = (record: LibraryRecord, entityId: string, payload = record.payload, deletedAt: string | null = null): LibraryRecord => ({ ...record, id: entityId, namespace: 'account:x', revision: 1, payload, deletedAt });
function library() {
  const collection = local('collection', { name: 'Keep' });
  const favorite = local('favorite', { familyId: 'figlet/future' });
  const design = local('design', { name: 'Hi', recipe, snapshot: { text: 'HI', columns: 2, rows: 1 }, artifacts: [id()] });
  return { collection, favorite, design, all: [
    local('membership', { collectionId: collection.id, itemType: 'design', itemId: design.id }),
    local('membership', { collectionId: collection.id, itemType: 'favorite', itemId: favorite.id }),
    collection, favorite, design, local('input', { text: 'words', name: 'Words' }),
  ] };
}
test('an import creates referenced records first, maps every reference and leaves image files behind', () => {
  const { all, collection, design, favorite } = library();
  const plan = planImport(all, [], {}, id);
  assert.deepEqual(plan.creates.map(item => item.mutation.type), ['input', 'favorite', 'design', 'collection', 'membership', 'membership']);
  assert(plan.creates.every(item => item.mutation.baseRevision === 0 && item.mutation.entityId === plan.map[item.localId] && item.mutation.entityId !== item.localId));
  const designCreate = plan.creates.find(item => item.localId === design.id)!;
  assert.equal('artifacts' in (designCreate.mutation.payload as object), false); assert.equal(plan.withoutFiles, 1);
  const links = plan.creates.filter(item => item.mutation.type === 'membership').map(item => item.mutation.payload);
  assert.deepEqual(links, [{ collectionId: plan.map[collection.id], itemType: 'design', itemId: plan.map[design.id] }, { collectionId: plan.map[collection.id], itemType: 'favorite', itemId: plan.map[favorite.id] }]);
  assert.deepEqual(importScope(plan), ['1 saved text', '1 favorite', '1 design', '1 collection', '2 collection entries']);
});
test('a repeated import after readback sends nothing', () => {
  const { all } = library();
  const first = planImport(all, [], {}, id);
  const remote = first.creates.map(({ localId, mutation }) => stored(all.find(record => record.id === localId)!, mutation.entityId, mutation.payload));
  const again = planImport(all, remote, first.map, id);
  assert.equal(again.creates.length, 0); assert.equal(again.already, all.length); assert.deepEqual(again.map, first.map);
});
test('an interrupted import resumes with the same account IDs and only the missing records', () => {
  const { all } = library();
  const first = planImport(all, [], {}, id);
  // The first two creates reached the account before the connection dropped.
  const arrived = first.creates.slice(0, 2).map(({ localId, mutation }) => stored(all.find(record => record.id === localId)!, mutation.entityId, mutation.payload));
  const resumed = planImport(all, arrived, first.map, id);
  assert.deepEqual(resumed.creates.map(item => item.mutation.entityId), first.creates.slice(2).map(item => item.mutation.entityId));
  assert(resumed.creates.every((item, i) => item.mutation.requestId !== first.creates[i + 2].mutation.requestId));
});
test('equal favorites and memberships already in the account are reused; equal collection names stay separate', () => {
  const { all, collection, favorite } = library();
  const remoteFavorite = stored(local('favorite', { familyId: 'figlet/future' }), id());
  const remoteCollection = stored(local('collection', { name: 'Keep' }), id());
  const plan = planImport(all, [remoteFavorite, remoteCollection], {}, id);
  assert.equal(plan.map[favorite.id], remoteFavorite.id);
  assert.equal(plan.creates.some(item => item.localId === favorite.id), false);
  assert.notEqual(plan.map[collection.id], remoteCollection.id);
  assert.equal(plan.creates.filter(item => item.mutation.type === 'collection').length, 1);
  // The new collection's entry for the existing favorite points at the account's favorite.
  assert(plan.creates.some(item => item.mutation.type === 'membership' && (item.mutation.payload as { itemId: string }).itemId === remoteFavorite.id));
  // Once that entry exists in the account it is not sent again.
  const link = plan.creates.find(item => (item.mutation.payload as { itemId?: string }).itemId === remoteFavorite.id)!;
  const withLink = planImport(all, [remoteFavorite, remoteCollection, stored(all.find(record => record.id === link.localId)!, id(), link.mutation.payload)], plan.map, id);
  assert.equal(withLink.creates.some(item => (item.mutation.payload as { itemId?: string }).itemId === remoteFavorite.id), false);
});
test('records deleted in the account are not brought back, and memberships that point at them are left out', () => {
  const { all, collection } = library();
  const first = planImport(all, [], {}, id);
  const remote = first.creates.filter(item => item.mutation.type !== 'membership')
    .map(({ localId, mutation }) => stored(all.find(record => record.id === localId)!, mutation.entityId, localId === collection.id ? null : mutation.payload, localId === collection.id ? '2026-11-11T00:00:00.000Z' : null));
  const again = planImport(all, remote, first.map, id);
  assert.equal(again.creates.length, 0); assert.equal(again.skipped, 2);
});
test('deleted local records are not imported', () => {
  const removed = { ...local('input', { text: 'gone', name: 'Gone' }), deletedAt: '2026-11-11T00:00:00.000Z' };
  assert.equal(planImport([removed], [], {}, id).creates.length, 0);
});
