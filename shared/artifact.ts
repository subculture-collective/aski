import { ARTIFACT_TYPES } from './library.ts';
import type { ArtifactMeta } from './library.ts';
// Checks uploaded file bytes against their declared type and size before an account stores them. Every
// upload is untrusted, including bytes from aski's own client (docs/account-sync-contract.md).
export const MAX_ARTIFACT = 32 * 1024 * 1024;
export const MAX_DIMENSION = 16_384;
const SVG_NS = 'http://www.w3.org/2000/svg';
// Exactly the elements and attributes aski's SVG export writes; anything else is refused.
const ELEMENTS: Record<string, string[]> = {
  svg: ['xmlns', 'width', 'height', 'viewBox'], g: ['transform', 'shape-rendering', 'font-family', 'font-size', 'xml:space'],
  rect: ['x', 'y', 'width', 'height', 'fill', 'fill-opacity'], text: ['x', 'y', 'fill'],
};
const fail = (message: string) => { throw new Error(message); };
function checkSvg(bytes: Uint8Array, width: number, height: number) {
  let source = '';
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('The SVG is not valid UTF-8.'); }
  // No declarations, comments, processing instructions, CDATA or custom entities.
  if (/<[!?]/.test(source)) fail('The SVG contains declarations or instructions.');
  if (/&(?!(amp|lt|gt|quot|apos|#\d{1,7}|#x[\da-f]{1,6});)/i.test(source)) fail('The SVG contains an unknown entity.');
  const tags = [...source.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<>]*")*)\s*(\/?)>/g)];
  // Text between tags is allowed; any other "<" means markup this check did not understand.
  if (source.replace(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<>]*")*)\s*(\/?)>/g, '').includes('<')) fail('The SVG contains unsupported markup.');
  const stack: string[] = [];
  for (const [index, [, closing, name, attributes, selfClosing]] of tags.entries()) {
    if (!ELEMENTS[name]) fail(`The SVG contains a <${name}> element.`);
    if (closing) { if (stack.pop() !== name) fail('The SVG is not well formed.'); continue; }
    if (index === 0 ? name !== 'svg' : !stack.length) fail('The SVG must have one <svg> root.');
    const values = new Map<string, string>();
    for (const [, key, value] of attributes.matchAll(/\s+([\w:.-]+)="([^"]*)"/g)) {
      if (!ELEMENTS[name].includes(key) || values.has(key)) fail(`The SVG contains a ${key} attribute on <${name}>.`);
      if (/url\s*\(|script:|expression\s*\(/i.test(value)) fail('The SVG refers to an external resource.');
      values.set(key, value);
    }
    if (name === 'svg' && (values.get('xmlns') !== SVG_NS || values.get('width') !== String(width) || values.get('height') !== String(height))) fail('The SVG size does not match.');
    if (!selfClosing) stack.push(name);
  }
  if (!tags.length || stack.length) fail('The SVG is not well formed.');
}
// Throws with a reason when the bytes are not an image of the declared type and pixel size.
export function checkArtifact(bytes: Uint8Array, mime: string, width: number, height: number) {
  if (!ARTIFACT_TYPES.includes(mime as ArtifactMeta['mime'])) fail('This file type is not supported.');
  if (!bytes.length || bytes.length > MAX_ARTIFACT) fail('The file is empty or too large.');
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= MAX_DIMENSION)) fail('The image size is not valid.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (mime === 'image/png') {
    if (bytes.length < 24 || ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value) || ascii(12, 16) !== 'IHDR') fail('The file is not a PNG.');
    if (view.getUint32(16) !== width || view.getUint32(20) !== height) fail('The PNG size does not match.');
  } else if (mime === 'image/gif') {
    if (bytes.length < 13 || !['GIF87a', 'GIF89a'].includes(ascii(0, 6))) fail('The file is not a GIF.');
    if (view.getUint16(6, true) !== width || view.getUint16(8, true) !== height) fail('The GIF size does not match.');
  } else checkSvg(bytes, width, height);
}
