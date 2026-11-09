export const FONT = {
  familyId: 'ansi-compact', variantId: 'ansi-compact.regular',
  sha256: '7725d789f12f20f854a2d0fb6f23df3080fefd0753e94055f2078b3853afe30f', name: 'ANSI Compact', rendererVersion: 'figlet@1.12.0',
} as const;
export const MAX_INPUT = 2000;
export interface RecipeV1 {
  schemaVersion: 1;
  id: string;
  input: string;
  familyId: typeof FONT.familyId;
  variantId: typeof FONT.variantId;
}
export function parseRecipe(value: unknown): RecipeV1 {
  if (!value || typeof value !== 'object') throw new Error('Invalid recipe.');
  const r = value as Partial<RecipeV1>;
  if (r.schemaVersion !== 1) throw new Error('This recipe version is not supported.');
  if (typeof r.id !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(r.id)) throw new Error('Invalid recipe ID.');
  if (typeof r.input !== 'string') throw new Error('Text is required.');
  if (r.input.length > MAX_INPUT) throw new Error(`Use ${MAX_INPUT} characters or fewer.`);
  if (r.familyId !== FONT.familyId || r.variantId !== FONT.variantId) throw new Error('This font is not available.');
  return { schemaVersion: 1, id: r.id, input: r.input, familyId: r.familyId, variantId: r.variantId };
}
