import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ANIMATION } from './animation.ts';
import { MAX_SHARE_LENGTH, SHARE_PREFIX, decodeShare, encodeShare } from './share.ts';
import { DEFAULT_COLORS, DEFAULT_LAYOUT, FONT, MAX_INPUT } from './recipe.ts';
import type { Recipe } from './recipe.ts';
const ID = '00000000-0000-4000-8000-000000000001', FRESH = '00000000-0000-4000-8000-0000000000ff';
const recipe: Recipe = { schemaVersion: 4, id: ID, input: ' <script>alert(1)</script>\n🙂 ünïcödé & "quotes"', familyId: FONT.familyId, variantId: FONT.variantId,
  fontSha256: FONT.sha256, rendererVersion: FONT.rendererVersion, colors: { ...DEFAULT_COLORS, foreground: '#FF4D6D' },
  layout: { ...DEFAULT_LAYOUT, spacing: 'full', width: 40, align: 'center', blocks: true }, animation: { ...DEFAULT_ANIMATION, effect: 'glitch', seed: 99, intensity: 5 } };
const size = { columns: 30, rows: 12 };
const encode = (value: unknown) => SHARE_PREFIX + Buffer.from(value as Uint8Array).toString('base64url');
async function deflate(text: string) {
  return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
}
test('a share link restores every editable setting with a fresh id and nothing else', async () => {
  const link = await encodeShare(recipe, size);
  assert(link.startsWith(SHARE_PREFIX) && /^[\w-]+$/.test(link.slice(SHARE_PREFIX.length)));
  const restored = await decodeShare(link, FRESH);
  assert.deepEqual(restored, { recipe: { ...recipe, id: FRESH }, size });
  const json = new TextDecoder().decode(await new Response(new Blob([Buffer.from(link.slice(SHARE_PREFIX.length), 'base64url')]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  assert(!json.includes(ID), 'the recipe id stays private');
  assert.deepEqual(Object.keys(JSON.parse(json)), ['v', 'recipe', 'size']);
});
test('the longest text fits the measured link budget', async () => {
  // Worst case for compression: varied characters at the maximum input length.
  const input = Array.from({ length: MAX_INPUT }, (_, index) => String.fromCodePoint(0x4e00 + (index * 7919) % 20000)).join('').slice(0, MAX_INPUT);
  const link = await encodeShare({ ...recipe, input }, size);
  assert(link.length < MAX_SHARE_LENGTH, `${link.length} characters`);
  const ascii = await encodeShare({ ...recipe, input: 'ASKI '.repeat(400) }, size);
  assert(ascii.length < 1000, `${ascii.length} characters`);
});
test('malformed, oversized and future links fail with useful errors', async () => {
  await assert.rejects(decodeShare('#nothing', FRESH), /not a share link/);
  await assert.rejects(decodeShare('#share=2.abc', FRESH), /newer version/);
  await assert.rejects(decodeShare(SHARE_PREFIX + '$$$', FRESH), /damaged/);
  await assert.rejects(decodeShare(SHARE_PREFIX + 'AAAA', FRESH), /damaged/);
  await assert.rejects(decodeShare(encode(await deflate('{"v":1}')), FRESH), /damaged/);
  await assert.rejects(decodeShare(encode(await deflate(JSON.stringify({ v: 1, recipe: { ...recipe, schemaVersion: 9 }, size }))), FRESH), /newer version/);
  await assert.rejects(decodeShare(encode(await deflate(JSON.stringify({ v: 1, recipe: { ...recipe, fontSha256: 'x' }, size }))), FRESH), /font version/);
  await assert.rejects(decodeShare(encode(await deflate(JSON.stringify({ v: 1, recipe: { ...recipe, colors: { foreground: 'red' } }, size }))), FRESH), /#RRGGBB/);
  await assert.rejects(decodeShare(SHARE_PREFIX + 'A'.repeat(MAX_SHARE_LENGTH), FRESH), /too large/);
  // A small link that inflates past the limit is rejected while decompressing.
  await assert.rejects(decodeShare(encode(await deflate(' '.repeat(400_000))), FRESH), /too large/);
  await assert.rejects(decodeShare(encode(await deflate('ÿ')), FRESH), /damaged/);
});
