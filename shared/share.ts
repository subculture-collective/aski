import { RECIPE_VERSIONS, parseRecipe } from './recipe.ts';
import type { Recipe } from './recipe.ts';
// Share links carry one editable design in the URL fragment, which browsers never send to a server.
// Payload version 1: { v: 1, recipe: <recipe without its id>, size: { columns, rows } }, as UTF-8 JSON,
// compressed with deflate-raw and base64url-encoded after "#share=1.".
export const SHARE_PREFIX = '#share=1.';
// The longest link we create. 2,000 characters of text compress to well under this; see docs/share-links.md.
export const MAX_SHARE_LENGTH = 16_000;
const toBase64Url = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text: string) => {
  if (!/^[\w-]*$/.test(text)) throw new Error('This share link is damaged.');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};
async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); throw new Error('This share link is too large.'); }
    chunks.push(value);
  }
  return new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer());
}
export interface SharedDesign { recipe: Omit<Recipe, 'id'>; size: { columns: number; rows: number } }
export async function encodeShare(recipe: Recipe, size: { columns: number; rows: number }) {
  const { id: _id, ...shared } = recipe; void _id;
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, recipe: shared, size }));
  const fragment = SHARE_PREFIX + toBase64Url(await transform(json, new CompressionStream('deflate-raw')));
  if (fragment.length > MAX_SHARE_LENGTH) throw new Error('This design is too long to share as a link. Shorten the text and try again.');
  return fragment;
}
// Validates everything through the recipe parser; the caller supplies a fresh recipe id.
export async function decodeShare(fragment: string, id: string): Promise<{ recipe: Recipe; size: SharedDesign['size'] }> {
  if (!fragment.startsWith('#share=')) throw new Error('This is not a share link.');
  // Only a version number other than 1 means a newer aski; a cut-off prefix is a damaged link.
  if (!fragment.startsWith(SHARE_PREFIX)) throw new Error(/^#share=\d+\./.test(fragment) ? 'This share link comes from a newer version of aski.' : 'This share link is damaged.');
  if (fragment.length > MAX_SHARE_LENGTH) throw new Error('This share link is too large.');
  let value: { v?: unknown; recipe?: { schemaVersion?: unknown }; size?: { columns?: unknown; rows?: unknown } };
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await transform(fromBase64Url(fragment.slice(SHARE_PREFIX.length)), new DecompressionStream('deflate-raw'), 256 * 1024))); }
  catch (error) { throw new Error(error instanceof Error && /too large/.test(error.message) ? error.message : 'This share link is damaged.', { cause: error }); }
  if (value?.v !== 1 || !value.recipe || typeof value.recipe !== 'object') throw new Error('This share link is damaged.');
  if (!RECIPE_VERSIONS.includes(value.recipe.schemaVersion as number)) throw new Error('This share link comes from a newer version of aski.');
  const recipe = parseRecipe({ ...value.recipe, id });
  const { columns, rows } = value.size || {};
  if (!Number.isInteger(columns) || !Number.isInteger(rows)) throw new Error('This share link is damaged.');
  return { recipe, size: { columns: columns as number, rows: rows as number } };
}
