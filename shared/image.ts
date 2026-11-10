import { CELL, blockRects } from './cells.ts';
import type { ColorRun } from './color.ts';
import type { Colors } from './recipe.ts';
// Still images share the 8 x 16 cell grid with seamless blocks. Text-mode glyphs are drawn at 80% of the
// cell height so a monospace advance (about 0.6 em) fits the 8-unit cell width.
export const IMAGE_LIMITS = { scale: [1, 8], padding: [0, 256], side: 8192, pixels: 16_000_000 } as const;
export interface ImageOptions { scale: number; padding: number; transparent: boolean; blocks: boolean }
export const DEFAULT_IMAGE: ImageOptions = { scale: 2, padding: 16, transparent: false, blocks: false };
export const FONT_STACK = "ui-monospace, 'Cascadia Mono', 'Liberation Mono', Menlo, Consolas, monospace";
export function imageSize(columns: number, rows: number, options: Pick<ImageOptions, 'scale' | 'padding'>) {
  const { scale, padding } = options;
  if (!Number.isInteger(scale) || scale < IMAGE_LIMITS.scale[0] || scale > IMAGE_LIMITS.scale[1]) throw new Error(`Scale must be ${IMAGE_LIMITS.scale[0]}–${IMAGE_LIMITS.scale[1]}.`);
  if (!Number.isInteger(padding) || padding < IMAGE_LIMITS.padding[0] || padding > IMAGE_LIMITS.padding[1]) throw new Error(`Padding must be ${IMAGE_LIMITS.padding[0]}–${IMAGE_LIMITS.padding[1]} pixels.`);
  const width = columns * CELL.width * scale + padding * 2, height = rows * CELL.height * scale + padding * 2;
  if (width > IMAGE_LIMITS.side || height > IMAGE_LIMITS.side || width * height > IMAGE_LIMITS.pixels)
    throw new Error(`This image would be ${width} × ${height} pixels, over the ${IMAGE_LIMITS.side}-pixel side or 16-megapixel limit that phone browsers can draw. Lower the scale or padding, or set a maximum width.`);
  return { width, height };
}
const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g; // eslint-disable-line no-control-regex
export const escapeXml = (text: string) => text.replace(XML_INVALID, '�')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export interface Glyph { x: number; y: number; character: string; fill: string }
// Each visible character with its own cell position, so alignment never depends on the viewer's font width.
export function glyphs(runs: ColorRun[], colors: Colors, scale: number): Glyph[] {
  const result: Glyph[] = [];
  let row = 0, column = 0;
  for (const run of runs) for (const character of run.text) {
    if (character === '\n') { row++; column = 0; continue; }
    if (run.slot && character !== ' ') result.push({ x: column * CELL.width * scale, y: row * CELL.height * scale, character, fill: colors[run.slot] });
    column++;
  }
  return result;
}
// A self-contained SVG: no scripts, external references or embedded fonts. Block mode is pure geometry;
// text mode places one <text> per character run row with an explicit x for every character.
export function toSvg(runs: ColorRun[], colors: Colors, size: { columns: number; rows: number }, options: ImageOptions) {
  const { width, height } = imageSize(size.columns, size.rows, options);
  const { scale, padding } = options;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`];
  if (!options.transparent) parts.push(`<rect width="${width}" height="${height}" fill="${colors.background}"/>`);
  parts.push(`<g transform="translate(${padding} ${padding})">`);
  if (options.blocks) {
    parts.push('<g shape-rendering="crispEdges">');
    for (const rect of blockRects(runs, colors, scale)) parts.push(`<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${rect.fill}"${rect.opacity === 1 ? '' : ` fill-opacity="${rect.opacity}"`}/>`);
    parts.push('</g>');
  } else {
    const size = CELL.height * scale * 0.8;
    parts.push(`<g font-family="${FONT_STACK.replace(/'/g, '&apos;')}" font-size="${size}" xml:space="preserve">`);
    // Consecutive same-color glyphs on one row share a <text> element with an x list.
    let group: Glyph[] = [];
    const flush = () => {
      if (!group.length) return;
      parts.push(`<text x="${group.map(glyph => glyph.x).join(' ')}" y="${group[0].y + CELL.height * scale * 0.78}" fill="${group[0].fill}">${escapeXml(group.map(glyph => glyph.character).join(''))}</text>`);
      group = [];
    };
    for (const glyph of glyphs(runs, colors, scale)) {
      if (group.length && (group[0].y !== glyph.y || group[0].fill !== glyph.fill)) flush();
      group.push(glyph);
    }
    flush();
    parts.push('</g>');
  }
  parts.push('</g></svg>');
  return parts.join('\n') + '\n';
}
