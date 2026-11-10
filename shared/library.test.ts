import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, findFavorite, parseFavorite, parseRecord } from './library.ts';
const NOW = '2026-11-10T00:00:00.000Z';
test('favorite records use the contract envelope and stable family/variant references', () => {
  const record = createRecord('favorite', { familyId: 'figlet/future', variantId: 'figlet/future-thin' }, NOW);
  assert.equal(record.namespace, 'anonymous'); assert.equal(record.schemaVersion, 1); assert.equal(record.revision, 0);
  assert.equal(record.deletedAt, null); assert.match(record.id, /^[\da-f-]{36}$/);
  assert.deepEqual(parseRecord(structuredClone(record)), record);
  assert.deepEqual(Object.keys(record.payload), ['familyId', 'variantId']);
});
test('favorites reject unknown fonts and variants from another family', () => {
  assert.deepEqual(parseFavorite({ familyId: 'figlet/circle' }), { familyId: 'figlet/circle' });
  assert.throws(() => parseFavorite({ familyId: 'figlet/unknown' }), /not available/);
  assert.throws(() => parseFavorite({ familyId: 'figlet/future', variantId: 'figlet/emboss' }), /not available/);
  assert.throws(() => parseFavorite({ variantId: 'figlet/future' }), /Invalid favorite/);
});
test('unknown versions and types are unreadable rather than rewritten', () => {
  const record = createRecord('favorite', { familyId: 'figlet/circle' }, NOW);
  assert.throws(() => parseRecord({ ...record, schemaVersion: 2 }), /version/);
  assert.throws(() => parseRecord({ ...record, type: 'sticker' }), /type/);
  assert.throws(() => parseRecord({ ...record, id: 'nope' }), /ID/);
  assert.throws(() => parseRecord({ ...record, revision: -1 }), /Invalid/);
});
test('a favorite is unique by family and variant and ignores deleted records', () => {
  const thin = createRecord('favorite', { familyId: 'figlet/future', variantId: 'figlet/future-thin' }, NOW);
  const family = createRecord('favorite', { familyId: 'figlet/future' }, NOW);
  assert.equal(findFavorite([thin, family], { familyId: 'figlet/future', variantId: 'figlet/future-thin' }), thin);
  assert.equal(findFavorite([thin, family], { familyId: 'figlet/future' }), family);
  assert.equal(findFavorite([{ ...thin, deletedAt: NOW }], { familyId: 'figlet/future', variantId: 'figlet/future-thin' }), undefined);
});
