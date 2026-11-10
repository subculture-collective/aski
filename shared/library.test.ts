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
import { readFileSync } from 'node:fs';
import { defaultName, parseDesign, parseInput } from './library.ts';
import { loadFont, renderRecipe } from './render.ts';
import { FONT, parseRecipe } from './recipe.ts';
const recipe = { schemaVersion: 1 as const, id: '00000000-0000-4000-8000-000000000001', input: ' A\nB', familyId: FONT.familyId, variantId: FONT.variantId, fontSha256: FONT.sha256, rendererVersion: FONT.rendererVersion };
test('saved text and designs are separate record types with validated names', () => {
  assert.deepEqual(parseInput({ text: ' A\nB', name: ' Hello ' }), { text: ' A\nB', name: 'Hello' });
  assert.throws(() => parseInput({ text: 'x', name: '' }), /name/);
  assert.throws(() => parseInput({ text: 'x', name: 'n'.repeat(121) }), /name/);
  const input = createRecord('input', { text: 'A', name: 'A' }, NOW);
  const design = createRecord('design', { name: 'D', recipe, snapshot: { text: 'out', columns: 3, rows: 1 } }, NOW);
  assert.equal(parseRecord(input).type, 'input'); assert.equal(parseRecord(design).type, 'design');
  assert.throws(() => parseRecord({ ...design, payload: { ...design.payload, snapshot: { text: 1 } } }), /design/);
  assert.equal(defaultName('\n  \nFirst line here\nsecond'), 'First line here');
  assert.equal(defaultName('', 'Circle'), 'Circle: Untitled');
  assert.equal(Array.from(defaultName('🙂'.repeat(60))).length, 40);
});
test('a changed renderer leaves the saved snapshot and provenance untouched', () => {
  loadFont(readFileSync(new URL('../public/fonts/ansi-compact.flf', import.meta.url), 'utf8'));
  const snapshot = renderRecipe(recipe);
  // Simulates a design saved by an older renderer whose output no longer matches this build.
  const older = parseDesign({ name: 'Old', recipe: { ...recipe, rendererVersion: 'figlet@1.0.0' }, snapshot: { ...snapshot, text: 'OLDER OUTPUT' } });
  assert.equal(older.snapshot.text, 'OLDER OUTPUT');
  assert.equal(older.recipe.rendererVersion, 'figlet@1.0.0');
  assert.throws(() => parseRecipe(older.recipe), /font version/);
  const current = parseDesign({ name: 'Now', recipe, snapshot });
  assert.equal(renderRecipe(parseRecipe(current.recipe)).text, current.snapshot.text);
});
import { cascade, findMembership, membersOf, parseMembership } from './library.ts';
test('collections hold styles and designs by reference; removing one never removes the items', () => {
  const style = createRecord('favorite', { familyId: 'figlet/circle' }, '2026-01-01T00:00:00.000Z');
  const design = createRecord('design', { name: 'D', recipe, snapshot: { text: 'x', columns: 1, rows: 1 } }, '2026-01-02T00:00:00.000Z');
  const project = createRecord('collection', { name: 'Project' }, NOW);
  const other = createRecord('collection', { name: 'Project' }, NOW);
  const m = (collection: typeof project, item: { id: string; type: string }, at: string) => createRecord('membership', { collectionId: collection.id, itemType: item.type as 'favorite', itemId: item.id }, at);
  const records = [style, design, project, other, m(project, style, '2026-01-03T00:00:00.000Z'), m(project, design, '2026-01-04T00:00:00.000Z'), m(other, design, '2026-01-05T00:00:00.000Z')];
  assert.deepEqual(membersOf(records, project.id), [style, design]);
  assert.deepEqual(membersOf(records, other.id), [design]);
  assert(findMembership(records, other.id, design.id)); assert.equal(findMembership(records, other.id, style.id), undefined);
  // Equal names are separate collections.
  assert.notEqual(project.id, other.id);
  const goneWithProject = cascade(records, project);
  assert.deepEqual(goneWithProject.map(r => r.type), ['collection', 'membership', 'membership']);
  const remaining = records.filter(r => !goneWithProject.includes(r));
  assert(remaining.includes(style) && remaining.includes(design));
  assert.deepEqual(membersOf(remaining, other.id), [design]);
  const goneWithDesign = cascade(records, design);
  assert.deepEqual(goneWithDesign.map(r => r.type), ['design', 'membership', 'membership']);
  assert.deepEqual(membersOf(records.filter(r => !goneWithDesign.includes(r)), project.id), [style]);
  assert.throws(() => parseMembership({ collectionId: project.id, itemType: 'input', itemId: style.id }), /membership/);
  assert.throws(() => parseRecord({ ...project, payload: { name: '' } }), /name/);
});
