import data from './catalog-data.json' with { type: 'json' };
export const variants = data;
export type FontVariant = typeof variants[number];
export function getVariant(id: string): FontVariant {
  const font = variants.find(item => item.variantId === id);
  if (!font) throw new Error('This font is not available.');
  return font;
}
export interface FontFamily { familyId: string; name: string; defaultVariantId: string; variants: FontVariant[] }
// One entry per confirmed family, in catalog order. The variant sharing the family ID is the default.
export const families: FontFamily[] = Array.from(new Set(variants.map(item => item.familyId)), familyId => {
  const members = variants.filter(item => item.familyId === familyId);
  const base = members.find(item => item.variantId === familyId) || members[0];
  return { familyId, name: base.name, defaultVariantId: base.variantId,
    variants: [base, ...members.filter(item => item !== base).sort((a, b) => a.name.localeCompare(b.name))] };
});
export function getFamily(id: string): FontFamily {
  const family = families.find(item => item.familyId === id);
  if (!family) throw new Error('This font is not available.');
  return family;
}
