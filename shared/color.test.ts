import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVariant, variants } from './catalog.ts';
import { colorize } from './color.ts';
import { loadFont, renderRecipe } from './render.ts';
import { DEFAULT_COLORS, FONT, parseColor, parseColors, parseRecipe } from './recipe.ts';
import { parsePalette } from './library.ts';
const render = (variantId: string, input: string) => {
  const font = getVariant(variantId);
  loadFont(readFileSync(new URL('../public' + font.path, import.meta.url), 'utf8'), variantId);
  return renderRecipe({ schemaVersion: 2, id: '00000000-0000-4000-8000-000000000001', input, familyId: font.familyId, variantId, fontSha256: font.sha256, rendererVersion: FONT.rendererVersion, colors: DEFAULT_COLORS }).text;
};
test('every style offers foreground and background; extra slots come only from reviewed mappings', () => {
  for (const font of variants) {
    assert.deepEqual(font.slots.slice(0, 2), ['foreground', 'background']);
    assert.deepEqual(font.slots.slice(2), Object.keys(font.colorMapping || {}));
  }
  assert.deepEqual(getVariant('figlet/linguaholic-shadow-3d').slots, ['foreground', 'background', 'shadow']);
  assert.deepEqual(getVariant('figlet/emboss').slots, ['foreground', 'background']);
});
test('colorized runs keep every character and alignment', () => {
  for (const variantId of ['figlet/linguaholic-shadow-3d', 'figlet/emboss', 'ansi-compact.regular']) {
    const text = render(variantId, ' AK\nB');
    const runs = colorize(text, getVariant(variantId));
    assert.equal(runs.map(run => run.text).join(''), text);
    assert(runs.every(run => run.slot !== null || /^\s+$/.test(run.text)));
    assert(runs.every(run => run.slot === null || !/\s/.test(run.text)));
  }
});
test('the mapped font separates its shadow; unmapped fonts never invent one', () => {
  const shadow = colorize(render('figlet/linguaholic-shadow-3d', 'A'), getVariant('figlet/linguaholic-shadow-3d'));
  assert(shadow.some(run => run.slot === 'shadow' && /^[╔╗╚╝═║]+$/.test(run.text)));
  assert(shadow.some(run => run.slot === 'foreground' && /^█+$/.test(run.text)));
  // Emboss draws with box-drawing characters too, but has no reviewed mapping.
  assert(colorize(render('figlet/emboss', 'A'), getVariant('figlet/emboss')).every(run => run.slot !== 'shadow'));
});
test('colors are validated #RRGGBB values and version-1 recipes migrate to defaults', () => {
  assert.equal(parseColor(' ff00aa '), '#FF00AA'); assert.equal(parseColor('#00ff66'), '#00FF66');
  for (const bad of ['#FFF', 'red', '#GGGGGG', '', null]) assert.throws(() => parseColor(bad), /#RRGGBB/);
  assert.throws(() => parseColors({ glow: '#FFFFFF' }), /slot/);
  assert.deepEqual(parseColors({ foreground: '#000000' }), { ...DEFAULT_COLORS, foreground: '#000000' });
  const v1 = { schemaVersion: 1, id: '00000000-0000-4000-8000-000000000001', input: 'A', familyId: FONT.familyId, variantId: FONT.variantId, fontSha256: FONT.sha256, rendererVersion: FONT.rendererVersion };
  assert.deepEqual(parseRecipe(v1).colors, DEFAULT_COLORS);
  assert.equal(parseRecipe(v1).schemaVersion, 2);
  assert.throws(() => parseRecipe({ ...v1, schemaVersion: 2, colors: { foreground: 'nope' } }), /#RRGGBB/);
  assert.deepEqual(parsePalette({ name: 'Mine', slots: { background: '#000000' } }).slots, { ...DEFAULT_COLORS, background: '#000000' });
  assert.throws(() => parsePalette({ name: '', slots: {} }), /name/);
});
