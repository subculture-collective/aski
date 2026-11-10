import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVariant } from './catalog.ts';
import { colorize } from './color.ts';
import { DEFAULT_IMAGE, escapeXml, glyphs, imageSize, toSvg } from './image.ts';
import { loadFont, renderRecipe } from './render.ts';
import { DEFAULT_COLORS, FONT } from './recipe.ts';
const render = (variantId: string, input: string) => {
  const font = getVariant(variantId);
  loadFont(readFileSync(new URL('../public' + font.path, import.meta.url), 'utf8'), variantId);
  const result = renderRecipe({ schemaVersion: 1, id: '00000000-0000-4000-8000-000000000001', input, familyId: font.familyId, variantId, fontSha256: font.sha256, rendererVersion: FONT.rendererVersion });
  return { ...result, runs: colorize(result.text, font) };
};
test('image size follows the cell grid, scale and padding, with explicit limits', () => {
  assert.deepEqual(imageSize(10, 4, { scale: 2, padding: 16 }), { width: 10 * 16 + 32, height: 4 * 32 + 32 });
  assert.throws(() => imageSize(10, 4, { scale: 9, padding: 0 }), /Scale/);
  assert.throws(() => imageSize(10, 4, { scale: 1, padding: -1 }), /Padding/);
  assert.throws(() => imageSize(2000, 300, { scale: 8, padding: 0 }), /Lower the scale/);
});
test('text-mode SVG places every character in its cell and escapes markup', () => {
  const art = render('figlet/letter', '<&>');
  const svg = toSvg(art.runs, DEFAULT_COLORS, art, DEFAULT_IMAGE);
  assert(!/<script|foreignObject|href|<!DOCTYPE|<!ENTITY|url\(/i.test(svg));
  assert(svg.includes('&lt;') || svg.includes('&amp;') || svg.includes('&gt;'));
  const texts = [...svg.matchAll(/<text x="([^"]+)" y="[^"]+" fill="#[0-9A-F]{6}">([^<]*)<\/text>/g)];
  const placed = texts.reduce((sum, [, xs]) => sum + xs.split(' ').length, 0);
  assert.equal(placed, glyphs(art.runs, DEFAULT_COLORS, 2).length);
  for (const [, xs, content] of texts) assert.equal(xs.split(' ').length, Array.from(content.replace(/&(lt|gt|amp|quot|apos);/g, '_')).length);
  assert.equal(escapeXml('a<b>&"\'\u0001'), 'a&lt;b&gt;&amp;&quot;&apos;�');
  assert(svg.includes(`<rect width="${art.columns * 16 + 32}" height="${art.rows * 32 + 32}" fill="#FFFFFF"/>`));
});
test('transparent and block-mode SVGs keep colors and seamless geometry', () => {
  const art = render('ansi-compact.regular', 'HI');
  const colors = { ...DEFAULT_COLORS, foreground: '#FF0000' };
  const transparent = toSvg(art.runs, colors, art, { ...DEFAULT_IMAGE, transparent: true, blocks: true });
  assert(!transparent.includes(`fill="${colors.background}"`));
  const rects = [...transparent.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9A-F]{6})"/g)];
  assert(rects.length > 0);
  assert(rects.every(([, , , , , fill]) => fill === '#FF0000'));
  assert(transparent.includes('shape-rendering="crispEdges"'));
  assert(!transparent.includes('<text'));
});
