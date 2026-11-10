import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { variants, families, getFamily, getVariant } from './catalog.ts';
import { loadFont, renderRecipe } from './render.ts';
import { FONT } from './recipe.ts';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const recipe = (variantId: string, input: string) => {
  const font = getVariant(variantId);
  return { schemaVersion: 1, id: '00000000-0000-4000-8000-000000000001', input,
    familyId: font.familyId, variantId, fontSha256: font.sha256, rendererVersion: FONT.rendererVersion };
};
test('catalog IDs, packaged bytes and notices remain bound to reviewed rights', () => {
  assert.equal(variants.length, 19);
  assert.equal(new Set(variants.map(f => f.variantId)).size, variants.length);
  for (const font of variants) {
    const source = readFileSync(new URL('../public' + font.path, import.meta.url));
    assert.equal(hash(source), font.sha256);
    assert.equal(hash(readFileSync(new URL('../public' + font.noticePath, import.meta.url), 'utf8').slice(0, -1)), font.headerSha256);
    assert.equal(font.rights, 'approved');
    loadFont(source.toString(), font.variantId);
    const value = recipe(font.variantId, 'ASKI\nA🙂');
    const result = renderRecipe(value);
    assert(result.rows > font.height);
    assert(result.unsupported.includes('🙂'));
    assert.equal(value.input, 'ASKI\nA🙂');
  }
});
test('only source-confirmed relations share a family; unknown metadata is explicit', () => {
  assert.equal(getVariant('figlet/future-thin').familyId, getVariant('figlet/future').familyId);
  assert.equal(getVariant('figlet/emboss-2').familyId, getVariant('figlet/emboss').familyId);
  assert.notEqual(getVariant('figlet/linguaholic-neon').familyId, getVariant('figlet/linguaholic-rounded').familyId);
  assert(variants.every(f => f.tags === null));
  assert.throws(() => getVariant('figlet/isometric1'), /not available/);
});
test('coverage follows encoded glyphs and rejects absent controls and Unicode glyphs', () => {
  const font = getVariant('figlet/circle');
  loadFont(readFileSync(new URL('../public' + font.path, import.meta.url), 'utf8'), font.variantId);
  const value = recipe(font.variantId, 'A\t🙂');
  assert.deepEqual(renderRecipe(value).unsupported, ['\t', '🙂']);
  assert.equal(value.input, 'A\t🙂');
});
test('licensed 3D multiline output matches the pinned parity sample', () => {
  const font = getVariant('figlet/linguaholic-shadow-3d');
  loadFont(readFileSync(new URL('../public' + font.path, import.meta.url), 'utf8'), font.variantId);
  const audit = JSON.parse(readFileSync(new URL('../research/font-audit/catalog-audit.json', import.meta.url), 'utf8'));
  const sample = audit.samples.find((s: { font: string; input: string }) => s.font === font.name && s.input === 'ASKI\nA🙂');
  assert.equal(hash(renderRecipe(recipe(font.variantId, sample.input)).text), sample.outputSha256);
});
test('each confirmed family is listed once with every variant and a stable default', () => {
  assert.equal(families.length, new Set(variants.map(f => f.familyId)).size);
  assert.deepEqual(families.flatMap(f => f.variants.map(v => v.variantId)).sort(), variants.map(v => v.variantId).sort());
  for (const family of families) {
    assert(family.variants.every(v => v.familyId === family.familyId));
    assert.equal(family.variants[0].variantId, family.defaultVariantId);
  }
  assert.deepEqual(getFamily('figlet/future').variants.map(v => v.name), ['Future', 'Future Smooth', 'Future Thin']);
  assert.equal(getFamily('ansi-compact').defaultVariantId, 'ansi-compact.regular');
  assert.throws(() => getFamily('figlet/unknown'), /not available/);
});
test('looks come from the characters each font draws for letters', () => {
  assert.deepEqual(getVariant('figlet/linguaholic-shadow-3d').looks, ['block', 'line']);
  assert.deepEqual(getVariant('figlet/small-braille').looks, ['braille']);
  assert.deepEqual(getVariant('figlet/letter').looks, ['letter']);
  // Related 3D and line styles stay separate families even when they share a look.
  assert.notEqual(getVariant('figlet/linguaholic-shadow-3d').familyId, getVariant('figlet/emboss').familyId);
  assert(variants.every(font => Array.isArray(font.looks)));
});
