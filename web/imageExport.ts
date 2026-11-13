import type { ColorRun } from '../shared/color.ts';
import { imageSize } from '../shared/image.ts';
import type { ImageOptions } from '../shared/image.ts';
import type { Colors } from '../shared/recipe.ts';
import { drawCells } from './draw.ts';
import { loadArtFont } from './artFont.ts';
// Draws the same cells as the SVG export onto a canvas and encodes PNG.
export async function toPng(runs: ColorRun[], colors: Colors, size: { columns: number; rows: number }, options: ImageOptions): Promise<Blob> {
  if (!options.blocks) await loadArtFont();
  const { width, height } = imageSize(size.columns, size.rows, options);
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw images.');
  drawCells(context, runs, colors, width, height, options);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create the PNG.')), 'image/png'));
}
