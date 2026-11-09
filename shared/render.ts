import figlet from 'figlet';
import { FONT, parseRecipe } from './recipe.ts';
export interface RenderResult { text: string; columns: number; rows: number; unsupported: string[] }
export function loadFont(source: string): void { figlet.parseFont(FONT.name, source); }
export function renderRecipe(value: unknown): RenderResult {
  const recipe = parseRecipe(value);
  const input = recipe.input.replace(/\r\n?/g, '\n');
  const unsupported = [...new Set(Array.from(input).filter(c => c !== '\n' && (c.codePointAt(0)! < 32 || c.codePointAt(0)! > 126)))];
  if (!input) return { text: '', columns: 0, rows: 0, unsupported };
  const text = figlet.textSync(input, { font: FONT.name, horizontalLayout: 'default', verticalLayout: 'full' });
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return { text, columns: Math.max(0, ...lines.map(line => Array.from(line).length)), rows: lines.length, unsupported };
}
export interface RenderRequest { jobId: number; recipe: unknown }
export type RenderReply = { jobId: number; result: RenderResult } | { jobId: number; error: string };
