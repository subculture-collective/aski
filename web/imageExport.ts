import { CELL, blockRects } from '../shared/cells.ts';
import type { ColorRun } from '../shared/color.ts';
import { FONT_STACK, glyphs, imageSize } from '../shared/image.ts';
import type { ImageOptions } from '../shared/image.ts';
import type { Colors } from '../shared/recipe.ts';
// Draws the same cells as the SVG export onto a canvas and encodes PNG.
export function toPng(runs: ColorRun[], colors: Colors, size: { columns: number; rows: number }, options: ImageOptions): Promise<Blob> {
  const { width, height } = imageSize(size.columns, size.rows, options);
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('This browser cannot draw images.'));
  if (!options.transparent) { context.fillStyle = colors.background; context.fillRect(0, 0, width, height); }
  context.translate(options.padding, options.padding);
  if (options.blocks) for (const rect of blockRects(runs, colors, options.scale)) {
    context.globalAlpha = rect.opacity; context.fillStyle = rect.fill; context.fillRect(rect.x, rect.y, rect.width, rect.height);
  } else {
    context.font = `${CELL.height * options.scale * 0.8}px ${FONT_STACK}`;
    context.textBaseline = 'alphabetic';
    for (const glyph of glyphs(runs, colors, options.scale)) {
      context.fillStyle = glyph.fill; context.fillText(glyph.character, glyph.x, glyph.y + CELL.height * options.scale * 0.78);
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create the PNG.')), 'image/png'));
}
