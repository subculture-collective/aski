import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVariant, variants } from './catalog.ts';
import { BLOCK_SHAPES, CELL, blockRects, supportsBlocks } from './cells.ts';
import { colorize } from './color.ts';
import { loadFont, renderRecipe } from './render.ts';
import { DEFAULT_COLORS, FONT } from './recipe.ts';
import type { Colors } from './recipe.ts';
const colors: Colors = { ...DEFAULT_COLORS, foreground: '#000000', background: '#FFFFFF' };
// Paints rectangles into a coverage grid (0 = background) to look for gaps between neighbours.
function raster(text: string, scale: number) {
  const lines = text.split('\n');
  const width = Math.max(...lines.map(line => Array.from(line).length)) * CELL.width * scale, height = lines.length * CELL.height * scale;
  const grid = new Float32Array(width * height);
  for (const rect of blockRects(colorize(text, { colorMapping: null }), colors, scale)) {
    for (const value of [rect.x, rect.y, rect.width, rect.height]) assert(Number.isInteger(value), 'whole-pixel edges');
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) grid[y * width + x] = Math.max(grid[y * width + x], rect.opacity);
  }
  return { grid, width, at: (x: number, y: number) => grid[y * width + x] };
}
test('adjoining full and partial blocks leave no seams at several scales', () => {
  for (const scale of [1, 2, 3, 5]) {
    const full = raster('██\n██', scale);
    assert(full.grid.every(value => value === 1), `full blocks cover every pixel at ${scale}x`);
    // Upper half next to full block: the top half row is continuous, the lower right half is background.
    const half = raster('█▀', scale);
    const middle = CELL.height * scale / 2;
    for (let x = 0; x < 16 * scale; x++) assert.equal(half.at(x, middle - 1), 1);
    assert.equal(half.at(12 * scale, middle + 1), 0);
    // Stacked lower half over upper half form one continuous column.
    const stacked = raster('▄\n▀', scale);
    for (let y = CELL.height * scale / 2; y < CELL.height * scale * 1.5; y++) assert.equal(stacked.at(4 * scale, y), 1);
    // Quadrants meet edge to edge.
    const quads = raster('▟▙', scale);
    assert.equal(quads.at(8 * scale - 1, 12 * scale), 1); assert.equal(quads.at(8 * scale, 12 * scale), 1);
    assert.equal(quads.at(2 * scale, 2 * scale), 0);
  }
});
test('runs merge into long rectangles and shades keep their color role', () => {
  const rects = blockRects(colorize('████', { colorMapping: null }), colors);
  assert.deepEqual(rects, [{ x: 0, y: 0, width: 32, height: 16, fill: '#000000', opacity: 1 }]);
  const shade = blockRects([{ slot: 'shadow', text: '░▒▓' }], { ...colors, shadow: '#123456' });
  assert.deepEqual(shade.map(rect => [rect.fill, rect.opacity]), [['#123456', 0.25], ['#123456', 0.5], ['#123456', 0.75]]);
  assert.throws(() => blockRects([], colors, 1.5), /whole number/);
});
test('only fonts drawn entirely with block shapes qualify; others are never converted', () => {
  assert.deepEqual(variants.filter(font => font.blocks).map(font => font.name), ['ANSI Compact', 'Classy', 'Coder Mini', 'Linguaholic Mini Block', 'Small Block']);
  assert.equal(supportsBlocks('█▀ ▄'), true);
  assert.equal(supportsBlocks('█/'), false);
  for (const name of ['figlet/pagga', 'figlet/letter', 'figlet/linguaholic-shadow-3d']) assert.equal(getVariant(name).blocks, false);
  // Unknown characters produce no shapes rather than a guessed block.
  assert.deepEqual(blockRects(colorize('/#', { colorMapping: null }), colors), []);
  // Every recorded glyph has shapes inside its cell.
  for (const [glyph, shapes] of Object.entries(BLOCK_SHAPES)) for (const [x, y, w, h] of shapes) assert(x >= 0 && y >= 0 && x + w <= 8 && y + h <= 16, glyph);
});
test('a supported font renders identical text and shapes that cover exactly its block cells', () => {
  const font = getVariant('ansi-compact.regular');
  loadFont(readFileSync(new URL('../public' + font.path, import.meta.url), 'utf8'));
  const text = renderRecipe({ schemaVersion: 1, id: '00000000-0000-4000-8000-000000000001', input: 'AB', familyId: font.familyId, variantId: font.variantId, fontSha256: font.sha256, rendererVersion: FONT.rendererVersion }).text;
  const cells = Array.from(text.replace(/\n/g, '')).filter(cell => cell !== ' ').length;
  const area = blockRects(colorize(text, font), colors).reduce((sum, rect) => sum + rect.width * rect.height, 0);
  const expected = Array.from(text.replace(/\n/g, '')).reduce((sum, cell) => sum + (BLOCK_SHAPES[cell] || []).reduce((s, [, , w, h]) => s + w * h, 0), 0);
  assert(cells > 0); assert.equal(area, expected);
});
