import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { DEFAULT_ANIMATION } from './animation.ts';
import { GIF_LIMITS, createGif, gifSchedule, validateGif } from './gif.ts';
const W = 6, H = 4;
const solid = (rgba: number[]) => Uint8ClampedArray.from({ length: W * H * 4 }, (_, i) => rgba[i % 4]);
function decode(bytes: Uint8Array) {
  const parsed = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const frames = decompressFrames(parsed, true);
  const loops = parsed.frames.some(frame => 'application' in frame && frame.application.id === 'NETSCAPE2.0');
  return { parsed, frames, loops };
}
test('the schedule keeps exact total time in whole centiseconds', () => {
  const animation = { ...DEFAULT_ANIMATION, durationMs: 1000, holdMs: 500, fps: 12 };
  const schedule = gifSchedule(animation);
  assert.equal(schedule.length, 18);
  assert.equal(schedule.reduce((sum, frame) => sum + frame.delayCs, 0), 150);
  assert(schedule.every(frame => frame.delayCs === 8 || frame.delayCs === 9));
  // Cycles that are not a whole number of frames: the last frame runs to the end.
  for (const [durationMs, holdMs, fps] of [[2500, 0, 15], [2000, 1500, 15], [1234, 0, 12], [500, 0, 1]]) {
    const total = gifSchedule({ ...DEFAULT_ANIMATION, durationMs, holdMs, fps }).reduce((sum, frame) => sum + frame.delayCs, 0);
    assert.equal(total, Math.round((durationMs + holdMs) / 10), `${durationMs}+${holdMs} at ${fps} fps`);
  }
});
test('opaque looping GIFs keep frame count, delays, disposal and merge identical frames', () => {
  const gif = createGif({ width: W, height: H, transparent: false, loop: true });
  gif.add(solid([255, 0, 0, 255]), 10); gif.add(solid([255, 0, 0, 255]), 15); gif.add(solid([0, 0, 255, 255]), 20);
  const { bytes, frames } = gif.finish();
  assert.equal(frames, 2);
  const decoded = decode(bytes);
  assert.equal(decoded.loops, true);
  assert.deepEqual(decoded.frames.map(frame => [frame.delay, frame.disposalType, frame.dims.width, frame.dims.height]), [[250, 1, W, H], [200, 1, W, H]]);
  assert.deepEqual(Array.from(decoded.frames[0].patch.slice(0, 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(decoded.frames[1].patch.slice(0, 4)), [0, 0, 255, 255]);
});
test('transparent play-once GIFs clear between frames and keep binary alpha', () => {
  const gif = createGif({ width: W, height: H, transparent: true, loop: false });
  const half = solid([0, 0, 0, 0]); half.set([0, 255, 0, 255], 0);
  gif.add(half, 10); gif.add(solid([0, 255, 0, 255]), 10);
  const decoded = decode(gif.finish().bytes);
  assert.equal(decoded.loops, false);
  assert.deepEqual(decoded.frames.map(frame => frame.disposalType), [2, 2]);
  const first = decoded.frames[0].patch;
  assert.deepEqual(Array.from(first.slice(0, 4)), [0, 255, 0, 255]);
  assert.equal(first[7], 0, 'transparent pixel');
});
test('budgets are explained before anything is allocated', () => {
  assert.equal(validateGif(320, 128, 40), '');
  assert.match(validateGif(GIF_LIMITS.side + 1, 10, 1), /at most 2048 pixels/);
  assert.match(validateGif(100, 100, GIF_LIMITS.frames + 1), /at most 600 frames/);
  assert.match(validateGif(2000, 2000, 100), /too large/);
});
