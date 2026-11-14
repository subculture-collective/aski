import figlet from 'figlet';
import { FONT, parseRecipe } from './recipe.ts';
import type { Layout, Recipe } from './recipe.ts';
import { toCanvas, typewriterPrefixes } from './animation.ts';
import { getVariant } from './catalog.ts';
export interface RenderResult { text: string; columns: number; rows: number; unsupported: string[]; typewriter?: string[] }
export function loadFont(source: string, variantId: string = FONT.variantId): void { figlet.parseFont(getVariant(variantId).name, source); }
export function renderRecipe(value: unknown): RenderResult {
  const recipe = parseRecipe(value);
  const input = recipe.input.replace(/\r\n?/g, '\n');
  const font = getVariant(recipe.variantId);
  const coverage = new Set(font.coverage);
  const unsupported = [...new Set(Array.from(input).filter(c => c !== '\n' && !coverage.has(c.codePointAt(0)!)))];
  if (!input) return { text: '', columns: 0, rows: 0, unsupported };
  const raw = figletText(input, recipe);
  const text = alignBlocks(raw, font.height, recipe.layout.align);
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  const result: RenderResult = { text, columns: Math.max(0, ...lines.map(line => Array.from(line).length)), rows: lines.length, unsupported };
  if (recipe.animation.effect === 'typewriter') result.typewriter = typewriterFrames(input, recipe, raw, result);
  return result;
}
function figletText(input: string, recipe: Recipe) {
  const { spacing, width } = recipe.layout;
  const options = { font: getVariant(recipe.variantId).name, horizontalLayout: spacing === 'smush' ? 'controlled smushing' as const : spacing, verticalLayout: 'full' as const };
  if (width === null) return figlet.textSync(input, options);
  // figlet's own word wrap joins words with the space glyph's overlap, which merges words under fitted
  // spacing. So the text is wrapped first, whole words while they fit and a word wider than the limit
  // between characters, and figlet draws the wrapped lines in one pass.
  const fits = (text: string) => Math.max(0, ...figlet.textSync(text, options).split('\n').map(row => Array.from(row).length)) <= width;
  const lines: string[] = [];
  for (const line of input.split('\n')) {
    let current = '';
    for (const word of line.split(' ')) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (fits(candidate)) { current = candidate; continue; }
      if (current !== '') lines.push(current);
      current = '';
      for (const character of Array.from(word)) {
        if (current === '' || fits(current + character)) current += character;
        else { lines.push(current); current = character; }
      }
    }
    lines.push(current);
  }
  return figlet.textSync(lines.join('\n'), options);
}
const splitBlocks = (text: string, height: number) => {
  const rows = text.replace(/\n$/, '').split('\n').map(row => Array.from(row));
  return Array.from({ length: Math.ceil(rows.length / height) }, (_, index) => rows.slice(index * height, (index + 1) * height));
};
const visibleWidth = (row: string[]) => { let end = row.length; while (end && row[end - 1] === ' ') end--; return end; };
// Each typewriter frame renders a prefix of the input with the same layout, then draws each block where the
// final artwork's block starts. The canvas is the final artwork's size, so text never moves as it types.
function typewriterFrames(input: string, recipe: Recipe, raw: string, final: RenderResult) {
  const height = getVariant(recipe.variantId).height;
  const finalBlocks = splitBlocks(raw, height);
  const total = Math.max(...finalBlocks.map(block => Math.max(...block.map(row => row.length))));
  const starts = finalBlocks.map(block => {
    const spare = total - Math.max(...block.map(visibleWidth));
    return recipe.layout.align === 'left' ? 0 : recipe.layout.align === 'center' ? Math.floor(spare / 2) : spare;
  });
  const characters = Array.from(input);
  return typewriterPrefixes(characters.length).map(count => {
    const canvas = toCanvas('', final.columns, final.rows).map(row => Array.from(row));
    if (count) splitBlocks(figletText(characters.slice(0, count).join(''), recipe), height).forEach((block, index) => {
      if (index >= starts.length) return;
      const width = Math.max(...block.map(visibleWidth));
      block.forEach((row, line) => row.slice(0, width).forEach((cell, column) => {
        const target = canvas[index * height + line];
        if (target && starts[index] + column < target.length) target[starts[index] + column] = cell;
      }));
    });
    return canvas.map(row => row.join('')).join('\n');
  });
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
