import data from './catalog-data.json' with { type: 'json' };
export const variants = data;
export type FontVariant = typeof variants[number];
export function getVariant(id: string): FontVariant {
  const font = variants.find(item => item.variantId === id);
  if (!font) throw new Error('This font is not available.');
  return font;
}
