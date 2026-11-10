import * as gifenc from 'gifenc';
// Bundlers load gifenc's ES module (named exports); Node loads its CommonJS build (exports on `default`).
const { GIFEncoder, applyPalette, quantize } = ('GIFEncoder' in gifenc ? gifenc : (gifenc as unknown as { default: typeof gifenc }).default);
import { cycleMs, frameCount, frameTime } from './animation.ts';
import type { Animation } from './animation.ts';
// Budgets are checked before any frame is drawn or encoded.
export const GIF_LIMITS = { side: 2048, frames: 600, pixelFrames: 120_000_000 } as const;
export function validateGif(width: number, height: number, frames: number) {
  if (width > GIF_LIMITS.side || height > GIF_LIMITS.side)
    return `A GIF can be at most ${GIF_LIMITS.side} pixels on a side; this one would be ${width} × ${height}. Lower the scale or padding, or set a maximum width.`;
  if (frames > GIF_LIMITS.frames) return `A GIF can have at most ${GIF_LIMITS.frames} frames; this one would have ${frames}. Shorten the duration or hold, or lower the frame rate.`;
  if (width * height * frames > GIF_LIMITS.pixelFrames) return `This GIF is too large to encode on most devices (${width} × ${height} × ${frames} frames). Lower the scale, frame rate or duration.`;
  return '';
}
// GIF delays are whole centiseconds. Rounding the cumulative time keeps the total length exact.
export function gifSchedule(animation: Animation) {
  const count = frameCount(animation);
  // The last frame runs to the end of the cycle, so the total is exactly duration + hold.
  const centiseconds = (index: number) => Math.round((index >= count ? cycleMs(animation) : frameTime(animation, index)) / 10);
  return Array.from({ length: count }, (_, index) => ({ index, delayCs: centiseconds(index + 1) - centiseconds(index) }));
}
export interface GifOptions { width: number; height: number; transparent: boolean; loop: boolean }
const same = (a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array) => a.length === b.length && a.every((value, index) => value === b[index]);
// Streams frames into gifenc with one frame of lookahead: identical neighbours merge into one longer frame.
// Opaque frames replace the whole canvas (disposal 1); transparent frames clear first (disposal 2) so no
// trails remain. Transparency is binary: alpha below 50% becomes the transparent index.
export function createGif(options: GifOptions) {
  const gif = GIFEncoder();
  let pending: { rgba: Uint8ClampedArray | Uint8Array; delayCs: number } | null = null;
  let written = 0;
  const format = options.transparent ? 'rgba4444' : 'rgb565';
  const write = () => {
    if (!pending) return;
    const palette = quantize(pending.rgba, 256, options.transparent ? { format, oneBitAlpha: true } : { format });
    const transparentIndex = options.transparent ? palette.findIndex(color => color[3] === 0) : -1;
    gif.writeFrame(applyPalette(pending.rgba, palette, format), options.width, options.height, {
      palette, delay: pending.delayCs * 10, repeat: options.loop ? 0 : -1, dispose: options.transparent ? 2 : 1,
      transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex) });
    written++;
  };
  return {
    add(rgba: Uint8ClampedArray | Uint8Array, delayCs: number) {
      if (pending && same(pending.rgba, rgba)) { pending.delayCs += delayCs; return; }
      write(); pending = { rgba: rgba.slice(), delayCs };
    },
    finish() { write(); pending = null; gif.finish(); return { bytes: gif.bytes(), frames: written }; },
  };
}
