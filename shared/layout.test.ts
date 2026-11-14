import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getVariant, variants } from './catalog.ts';
import { alignBlocks, loadFont, renderRecipe } from './render.ts';
import { DEFAULT_COLORS, DEFAULT_LAYOUT, FONT, parseLayout, parseRecipe, parseWidth } from './recipe.ts';
import type { Layout } from './recipe.ts';
const render = (variantId: string, input: string, layout: Partial<Layout> = {}) => {
  const font = getVariant(variantId);
  loadFont(readFileSync(new URL('../public' + font.path, import.meta.url), 'utf8'), variantId);
  return renderRecipe({ schemaVersion: 3, id: '00000000-0000-4000-8000-000000000001', input, familyId: font.familyId, variantId, fontSha256: font.sha256,
    rendererVersion: FONT.rendererVersion, colors: DEFAULT_COLORS, layout: { ...DEFAULT_LAYOUT, ...layout } });
};
const spaceColumns = (text: string) => {
  const rows = text.split('\n').filter(Boolean);
  const width = Math.max(...rows.map(row => row.length));
  return Array.from({ length: width }, (_, column) => rows.every(row => (row[column] ?? ' ') === ' ')).map((empty, column) => empty ? column : -1).filter(column => column >= 0);
};
test('the default layout still matches the recorded parity sample', () => {
  const audit = JSON.parse(readFileSync(new URL('../research/font-audit/catalog-audit.json', import.meta.url), 'utf8'));
  const sample = audit.samples.find((s: { font: string; input: string }) => s.font === 'Linguaholic Shadow 3D' && s.input === 'ASKI\nA🙂');
  assert.equal(createHash('sha256').update(render('figlet/linguaholic-shadow-3d', sample.input).text).digest('hex'), sample.outputSha256);
});
test('full spacing is never narrower than fitted, and fitted keeps the word gap', () => {
  for (const variantId of ['ansi-compact.regular', 'figlet/future', 'figlet/letter']) {
    const full = render(variantId, 'A B', { spacing: 'full' });
    const fitted = render(variantId, 'A B', { spacing: 'fitted' });
    assert(full.columns >= fitted.columns, variantId);
    // A column of spaces separates the words; fitting never removes it.
    const gaps = spaceColumns(fitted.text).filter(column => column > 0 && column < fitted.columns - 1);
    assert(gaps.length > 0, `${variantId} lost its word gap`);
  }
});
test('maximum width wraps at word boundaries and reports accurate dimensions', () => {
  const font = getVariant('figlet/future');
  const wide = render(font.variantId, 'ONE TWO THREE FOUR');
  const wrapped = render(font.variantId, 'ONE TWO THREE FOUR', { width: 30 });
  assert(wrapped.columns <= 30 && wrapped.rows > wide.rows && wrapped.rows % font.height === 0);
  const lines = wrapped.text.split('\n'); if (wrapped.text.endsWith('\n')) lines.pop();
  assert.equal(wrapped.rows, lines.length);
  assert.equal(wrapped.columns, Math.max(...lines.map(line => Array.from(line).length)));
});
test('alignment shifts whole blocks without changing the artwork inside them', () => {
  const left = render('figlet/future', 'WIDE\nI');
  for (const align of ['center', 'right'] as const) {
    const shifted = render('figlet/future', 'WIDE\nI', { align });
    assert.equal(shifted.columns, left.columns); assert.equal(shifted.rows, left.rows);
    const a = left.text.split('\n'), b = shifted.text.split('\n');
    a.forEach((row, index) => { assert.equal(b[index].trim(), row.trim()); assert.equal(b[index].length, row.length); });
    assert(b.at(-1)!.indexOf('╹') > a.at(-1)!.indexOf('╹'));
  }
  assert.equal(alignBlocks('ab\ncd\nx \ny ', 2, 'right'), 'ab\ncd\n x\n y');
  assert.equal(alignBlocks('abcd\nx   \n', 1, 'center'), 'abcd\n x  \n');
  // Spaces inside the artwork survive.
  assert.equal(alignBlocks('a  b\nc   ', 1, 'right'), 'a  b\n   c');
  assert.equal(alignBlocks('odd\nrows\nhere', 2, 'right'), 'odd\nrows\nhere');
});
test('layout values are validated and smushing needs font rules', () => {
  assert.equal(parseWidth(''), null); assert.equal(parseWidth('80'), 80);
  for (const bad of [19, 1001, 40.5, 'wide', -1]) assert.throws(() => parseWidth(bad), /columns/);
  assert(variants.every(font => !font.spacing.smush));
  assert.throws(() => parseLayout({ spacing: 'smush', width: null, align: 'left' }, getVariant('figlet/future')), /smushing/);
  assert.throws(() => parseLayout({ spacing: 'squeeze', width: null, align: 'left' }, getVariant('figlet/future')), /spacing/);
  assert.throws(() => parseLayout({ spacing: 'full', width: null, align: 'justify' }, getVariant('figlet/future')), /alignment/);
  assert.deepEqual(parseLayout({ spacing: 'smush', width: null, align: 'left' }, { spacing: { smush: true } }).spacing, 'smush');
  const v2 = { schemaVersion: 2, id: '00000000-0000-4000-8000-000000000001', input: 'A', familyId: FONT.familyId, variantId: FONT.variantId, fontSha256: FONT.sha256, rendererVersion: FONT.rendererVersion, colors: DEFAULT_COLORS };
  assert.deepEqual(parseRecipe(v2).layout, DEFAULT_LAYOUT);
});

test('a maximum width wraps between words and never merges them, whatever the spacing', () => {
  for (const variantId of variants.map(variant => variant.variantId)) for (const spacing of ['default', 'full', 'fitted'] as const) {
    const free = render(variantId, 'HELLO WORLD', { spacing });
    // A width wider than the art changes nothing.
    assert.equal(render(variantId, 'HELLO WORLD', { spacing, width: Math.max(20, free.columns + 10) }).text, free.text, `${variantId} ${spacing} wide`);
    // A width that cannot hold both words puts each word on its own line, drawn as it is alone.
    const width = Math.max(20, render(variantId, 'HELLO', { spacing }).columns, render(variantId, 'WORLD', { spacing }).columns);
    if (width >= free.columns) continue;
    assert.equal(render(variantId, 'HELLO WORLD', { spacing, width }).text, render(variantId, 'HELLO\nWORLD', { spacing }).text, `${variantId} ${spacing} wrapped`);
  }
});
