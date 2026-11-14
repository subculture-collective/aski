import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FONT, MAX_INPUT, parseRecipe } from './recipe.ts';
import { loadFont, renderRecipe } from './render.ts';
loadFont(readFileSync(new URL('../public/fonts/ansi-compact.flf', import.meta.url), 'utf8'));
const recipe = { schemaVersion: 1, id: '00000000-0000-4000-8000-000000000001', input: ' A\nB', familyId: FONT.familyId, variantId: FONT.variantId, fontSha256: FONT.sha256, rendererVersion: FONT.rendererVersion };
test('the reviewed font source matches its recorded identity', () => {
  assert.equal(createHash('sha256').update(readFileSync(new URL('../public/fonts/ansi-compact.flf', import.meta.url))).digest('hex'), FONT.sha256);
});
test('multiline output preserves the recorded leading spaces and line endings', () => {
  const expected = readFileSync(new URL('./fixtures/multiline.txt', import.meta.url), 'utf8');
  const result = renderRecipe(recipe);
  assert.equal(result.text, expected); assert(result.text.startsWith(' ')); assert(result.rows > 6);
  assert.equal(result.columns, Math.max(...result.text.split('\n').map(line => line.length)));
});
test('empty text and CRLF are handled without trimming artwork', () => {
  assert.deepEqual(renderRecipe({ ...recipe, input: '' }), { text: '', rows: 0, columns: 0, unsupported: [] });
  assert.equal(renderRecipe({ ...recipe, input: 'A\r\nB' }).text, renderRecipe({ ...recipe, input: 'A\nB' }).text);
});
test('coverage reports a code point once while preserving original input', () => {
  const value = { ...recipe, input: 'A🙂🙂' };
  assert.deepEqual(renderRecipe(value).unsupported, ['🙂']); assert.equal(value.input, 'A🙂🙂');
});
test('unknown versions, IDs, fonts and oversized input fail explicitly', () => {
  assert.throws(() => parseRecipe({ ...recipe, schemaVersion: 99 }), /version/);
  assert.throws(() => parseRecipe({ ...recipe, id: 'bad' }), /ID/);
  assert.throws(() => parseRecipe({ ...recipe, variantId: 'unknown' }), /font/);
  assert.throws(() => parseRecipe({ ...recipe, fontSha256: 'wrong' }), /font version/);
  assert.throws(() => parseRecipe({ ...recipe, rendererVersion: 'unknown' }), /font version/);
  assert.throws(() => renderRecipe({ ...recipe, input: 'a'.repeat(MAX_INPUT + 1) }), /2000/);
  // The limit counts characters, so an emoji is one of them.
  assert.doesNotThrow(() => parseRecipe({ ...recipe, input: '🙂'.repeat(MAX_INPUT) }));
  assert.throws(() => parseRecipe({ ...recipe, input: '🙂'.repeat(MAX_INPUT + 1) }), /2000/);
});
