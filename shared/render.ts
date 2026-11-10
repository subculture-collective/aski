import figlet from 'figlet';
import { FONT, parseRecipe } from './recipe.ts';
import type { Layout } from './recipe.ts';
import { getVariant } from './catalog.ts';
export interface RenderResult { text: string; columns: number; rows: number; unsupported: string[] }
export function loadFont(source: string, variantId: string = FONT.variantId): void { figlet.parseFont(getVariant(variantId).name, source); }
export function renderRecipe(value: unknown): RenderResult {
  const recipe = parseRecipe(value);
  const input = recipe.input.replace(/\r\n?/g, '\n');
  const font = getVariant(recipe.variantId);
  const coverage = new Set(font.coverage);
  const unsupported = [...new Set(Array.from(input).filter(c => c !== '\n' && !coverage.has(c.codePointAt(0)!)))];
  if (!input) return { text: '', columns: 0, rows: 0, unsupported };
  const { spacing, width, align } = recipe.layout;
  const raw = figlet.textSync(input, { font: font.name, horizontalLayout: spacing === 'smush' ? 'controlled smushing' : spacing,
    verticalLayout: 'full', width: width ?? undefined, whitespaceBreak: true });
  const text = alignBlocks(raw, font.height, align);
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return { text, columns: Math.max(0, ...lines.map(line => Array.from(line).length)), rows: lines.length, unsupported };
}
// Each input line (and each wrapped line) becomes a block of `height` rows. Figlet pads every row to the
// widest block; alignment moves that padding to the left, right or both sides of each block. Characters
// inside a block's visible width, including its spaces, are never changed or removed.
export function alignBlocks(text: string, height: number, align: Layout['align']) {
  if (align === 'left' || !text) return text;
  const trailing = text.endsWith('\n');
  const rows = (trailing ? text.slice(0, -1) : text).split('\n').map(row => Array.from(row));
  if (rows.length % height) return text;
  const blocks = Array.from({ length: rows.length / height }, (_, index) => rows.slice(index * height, (index + 1) * height));
  const visible = (row: string[]) => { let end = row.length; while (end && row[end - 1] === ' ') end--; return end; };
  const widths = blocks.map(block => Math.max(...block.map(visible)));
  const total = Math.max(...rows.map(row => row.length));
  const aligned = blocks.flatMap((block, index) => {
    const spare = total - widths[index];
    const before = align === 'center' ? Math.floor(spare / 2) : spare;
    return block.map(row => ' '.repeat(before) + row.slice(0, widths[index]).join('') + ' '.repeat(spare - before));
  });
  return aligned.join('\n') + (trailing ? '\n' : '');
}
export interface RenderRequest { jobId: number; recipe: unknown }
export type RenderReply = { jobId: number; result: RenderResult } | { jobId: number; error: string };
