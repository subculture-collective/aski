import type { FontVariant } from './catalog.ts';
import type { Slot } from './recipe.ts';
// Splits rendered text into runs by color slot without changing a single character. Characters a font's
// reviewed mapping assigns to a slot use that slot; other visible characters are foreground; spaces and
// line breaks carry no color, so the background shows through and alignment is untouched.
export interface ColorRun { slot: Slot | null; text: string }
export function slotLookup(font: Pick<FontVariant, 'colorMapping'>) {
  const lookup = new Map<string, Slot>();
  for (const [slot, characters] of Object.entries(font.colorMapping || {})) for (const character of characters as string[]) lookup.set(character, slot as Slot);
  return lookup;
}
export function colorize(text: string, font: Pick<FontVariant, 'colorMapping'>): ColorRun[] {
  const lookup = slotLookup(font);
  const runs: ColorRun[] = [];
  for (const character of text) {
    const slot: Slot | null = /\s/.test(character) ? null : lookup.get(character) || 'foreground';
    const last = runs.at(-1);
    if (last && last.slot === slot) last.text += character; else runs.push({ slot, text: character });
  }
  return runs;
}
