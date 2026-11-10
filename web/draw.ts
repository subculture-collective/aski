import { CELL, blockRects } from '../shared/cells.ts';
import type { ColorRun } from '../shared/color.ts';
import { FONT_STACK, glyphs } from '../shared/image.ts';
import type { ImageOptions } from '../shared/image.ts';
import type { Colors } from '../shared/recipe.ts';
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
// Draws one frame of cells; PNG and GIF exports share it so they match each other and the SVG.
export function drawCells(context: Context, runs: ColorRun[], colors: Colors, width: number, height: number, options: ImageOptions) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.clearRect(0, 0, width, height);
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
  context.globalAlpha = 1;
}
