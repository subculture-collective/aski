import { getVariant } from './catalog.ts';
export const FONT = {
  familyId: 'ansi-compact', variantId: 'ansi-compact.regular',
  sha256: '7725d789f12f20f854a2d0fb6f23df3080fefd0753e94055f2078b3853afe30f', name: 'ANSI Compact', rendererVersion: 'figlet@1.12.0',
} as const;
export const MAX_INPUT = 2000;
export const SLOTS = ['foreground', 'background', 'shadow', 'highlight'] as const;
export type Slot = typeof SLOTS[number];
export type Colors = Record<Slot, string>;
// Lilac identity: ink on white, with the focus purple and lime for mapped shadow/highlight slots.
export const DEFAULT_COLORS: Colors = { foreground: '#211B30', background: '#FFFFFF', shadow: '#6330B5', highlight: '#D4FF60' };
// Version 1 has no colors. Version 2 adds an assignment for every known slot; a font uses the slots it supports
// and the rest are kept so switching fonts does not lose them.
export interface RecipeV1 {
  schemaVersion: 1; id: string; input: string; familyId: string; variantId: string; fontSha256: string;
  rendererVersion: typeof FONT.rendererVersion;
}
export const SPACINGS = ['default', 'full', 'fitted', 'smush'] as const;
export type Spacing = typeof SPACINGS[number];
export const ALIGNMENTS = ['left', 'center', 'right'] as const;
export const MIN_WIDTH = 20;
export const MAX_WIDTH = 1000;
// Version 3 adds layout: horizontal spacing mode, an optional maximum width in columns and block alignment.
export interface Layout { spacing: Spacing; width: number | null; align: typeof ALIGNMENTS[number] }
export const DEFAULT_LAYOUT: Layout = { spacing: 'default', width: null, align: 'left' };
export interface RecipeV2 extends Omit<RecipeV1, 'schemaVersion'> { schemaVersion: 2; colors: Colors }
export interface Recipe extends Omit<RecipeV2, 'schemaVersion'> { schemaVersion: 3; layout: Layout }
export type StoredRecipe = RecipeV1 | RecipeV2 | Recipe;
export const RECIPE_VERSIONS: readonly number[] = [1, 2, 3];
export function parseWidth(value: unknown): number | null {
  if (value === null || value === '') return null;
  const width = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof width !== 'number' || !Number.isInteger(width) || width < MIN_WIDTH || width > MAX_WIDTH) throw new Error(`Use a whole number of columns from ${MIN_WIDTH} to ${MAX_WIDTH}, or no limit.`);
  return width;
}
// Smushing is accepted only for fonts whose header defines smushing rules.
export function parseLayout(value: unknown, font: { spacing: { smush: boolean } }): Layout {
  if (!value || typeof value !== 'object') throw new Error('Invalid layout.');
  const l = value as Partial<Layout>;
  if (!SPACINGS.includes(l.spacing as Spacing)) throw new Error('Unknown spacing mode.');
  if (l.spacing === 'smush' && !font.spacing.smush) throw new Error('This font does not define smushing rules.');
  if (!ALIGNMENTS.includes(l.align as Layout['align'])) throw new Error('Unknown alignment.');
  return { spacing: l.spacing!, width: parseWidth(l.width), align: l.align! };
}
export function parseColor(value: unknown): string {
  const match = typeof value === 'string' && /^#?([\da-f]{6})$/i.exec(value.trim());
  if (!match) throw new Error('Enter a color as #RRGGBB.');
  return '#' + match[1].toUpperCase();
}
export function parseColors(value: unknown): Colors {
  if (!value || typeof value !== 'object') throw new Error('Invalid colors.');
  for (const key of Object.keys(value)) if (!SLOTS.includes(key as Slot)) throw new Error('Unknown color slot.');
  const source = value as Partial<Record<Slot, unknown>>;
  return Object.fromEntries(SLOTS.map(slot => [slot, source[slot] === undefined ? DEFAULT_COLORS[slot] : parseColor(source[slot])])) as Colors;
}
// Accepts any supported version and returns the current one.
export function parseRecipe(value: unknown): Recipe {
  if (!value || typeof value !== 'object') throw new Error('Invalid recipe.');
  const r = value as Partial<Omit<Recipe, 'schemaVersion'>> & { schemaVersion?: number };
  if (!RECIPE_VERSIONS.includes(r.schemaVersion!)) throw new Error('This recipe version is not supported.');
  if (typeof r.id !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(r.id)) throw new Error('Invalid recipe ID.');
  if (typeof r.input !== 'string') throw new Error('Text is required.');
  if (r.input.length > MAX_INPUT) throw new Error(`Use ${MAX_INPUT} characters or fewer.`);
  const font = getVariant(typeof r.variantId === 'string' ? r.variantId : '');
  if (r.familyId !== font.familyId) throw new Error('This font is not available.');
  if (r.fontSha256 !== font.sha256 || r.rendererVersion !== FONT.rendererVersion) throw new Error('This font version is not available.');
  const colors = r.schemaVersion === 1 ? { ...DEFAULT_COLORS } : parseColors(r.colors);
  const layout = r.schemaVersion === 3 ? parseLayout(r.layout, font) : { ...DEFAULT_LAYOUT };
  return { schemaVersion: 3, id: r.id, input: r.input, familyId: font.familyId, variantId: font.variantId, fontSha256: font.sha256, rendererVersion: r.rendererVersion, colors, layout };
}
