import type { ColorRun } from './color.ts';
import type { Colors } from './recipe.ts';
// Block elements drawn as rectangles on a cell grid measured in eighths: [x, y, width, height, opacity].
// A cell is 8 units wide and 16 tall (one unit = 1/8 width, 2 units = 1/8 height), so every edge lands
// on a whole pixel at any whole-number scale and neighbouring shapes share edges without seams.
type Shape = [number, number, number, number, number?];
const full: Shape = [0, 0, 8, 16];
const eighthsUp = (n: number): Shape => [0, 16 - n * 2, 8, n * 2];
const eighthsLeft = (n: number): Shape => [0, 0, n, 16];
const Q = { tl: [0, 0, 4, 8] as Shape, tr: [4, 0, 4, 8] as Shape, bl: [0, 8, 4, 8] as Shape, br: [4, 8, 4, 8] as Shape };
export const BLOCK_SHAPES: Record<string, Shape[]> = {
  '█': [full], '▀': [[0, 0, 8, 8]], '▄': [[0, 8, 8, 8]], '▌': [[0, 0, 4, 16]], '▐': [[4, 0, 4, 16]],
  '▔': [[0, 0, 8, 2]], '▕': [[7, 0, 1, 16]],
  '▁': [eighthsUp(1)], '▂': [eighthsUp(2)], '▃': [eighthsUp(3)], '▅': [eighthsUp(5)], '▆': [eighthsUp(6)], '▇': [eighthsUp(7)],
  '▏': [eighthsLeft(1)], '▎': [eighthsLeft(2)], '▍': [eighthsLeft(3)], '▋': [eighthsLeft(5)], '▊': [eighthsLeft(6)], '▉': [eighthsLeft(7)],
  '▖': [Q.bl], '▗': [Q.br], '▘': [Q.tl], '▝': [Q.tr], '▚': [Q.tl, Q.br], '▞': [Q.tr, Q.bl],
  '▙': [Q.tl, Q.bl, Q.br], '▛': [Q.tl, Q.tr, Q.bl], '▜': [Q.tl, Q.tr, Q.br], '▟': [Q.tr, Q.bl, Q.br],
  // Shades keep their role as lighter fills of the same color.
  '░': [[0, 0, 8, 16, 0.25]], '▒': [[0, 0, 8, 16, 0.5]], '▓': [[0, 0, 8, 16, 0.75]],
};
export const CELL = { width: 8, height: 16 } as const;
// A font qualifies only when every character it draws has a shape; anything else stays text.
export const supportsBlocks = (drawn: Iterable<string>) => [...drawn].every(character => /\s/.test(character) || character in BLOCK_SHAPES);
export interface Rect { x: number; y: number; width: number; height: number; fill: string; opacity: number }
// Converts color runs into pixel rectangles at a whole-number scale, merging horizontal neighbours with the
// same geometry and color so long strokes become one rectangle.
export function blockRects(runs: ColorRun[], colors: Colors, scale = 1): Rect[] {
  if (!Number.isInteger(scale) || scale < 1) throw new Error('Scale must be a whole number.');
  const rects: Rect[] = [];
  const open = new Map<string, Rect>();
  let row = 0, column = 0;
  for (const run of runs) for (const character of run.text) {
    if (character === '\n') { row++; column = 0; open.clear(); continue; }
    const shapes = run.slot ? BLOCK_SHAPES[character] : undefined;
    if (shapes) for (const [x, y, width, height, opacity = 1] of shapes) {
      const fill = colors[run.slot!];
      const left = (column * CELL.width + x) * scale, top = (row * CELL.height + y) * scale;
      const key = `${top}:${height}:${fill}:${opacity}`;
      const previous = open.get(key);
      if (previous && previous.x + previous.width === left) previous.width += width * scale;
      else { const rect = { x: left, y: top, width: width * scale, height: height * scale, fill, opacity }; rects.push(rect); open.set(key, rect); }
    }
    column++;
  }
  return rects;
}
