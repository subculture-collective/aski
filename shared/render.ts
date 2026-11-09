import figlet from 'figlet';
import { FONT, parseRecipe } from './recipe.ts';
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
  const text = figlet.textSync(input, { font: font.name, horizontalLayout: 'default', verticalLayout: 'full' });
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return { text, columns: Math.max(0, ...lines.map(line => Array.from(line).length)), rows: lines.length, unsupported };
}
export interface RenderRequest { jobId: number; recipe: unknown }
export type RenderReply = { jobId: number; result: RenderResult } | { jobId: number; error: string };
