import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVariant } from './catalog.ts';
import { DEFAULT_ANIMATION, TYPEWRITER_STEPS, frameAt, frameCount, frameIndex, parseAnimation, toCanvas, typewriterPrefixes } from './animation.ts';
import type { Animation } from './animation.ts';
import { loadFont, renderRecipe } from './render.ts';
import { DEFAULT_COLORS, DEFAULT_LAYOUT, FONT, parseRecipe } from './recipe.ts';
import type { Layout } from './recipe.ts';
const render = (variantId: string, input: string, animation: Partial<Animation> = {}, layout: Partial<Layout> = {}) => {
  const font = getVariant(variantId);
  loadFont(readFileSync(new URL('../public' + font.path, import.meta.url), 'utf8'), variantId);
  return renderRecipe({ schemaVersion: 4, id: '00000000-0000-4000-8000-000000000001', input, familyId: font.familyId, variantId, fontSha256: font.sha256,
    rendererVersion: FONT.rendererVersion, colors: DEFAULT_COLORS, layout: { ...DEFAULT_LAYOUT, ...layout }, animation: { ...DEFAULT_ANIMATION, ...animation } });
};
const shape = (frame: string, columns: number, rows: number) => {
  const lines = frame.split('\n');
  assert.equal(lines.length, rows);
  for (const line of lines) assert.equal(Array.from(line).length, columns);
};
test('frames are repeatable for the same timestamp and sample whole frames', () => {
  const animation = { ...DEFAULT_ANIMATION, effect: 'reveal' as const };
  const model = render('figlet/future', 'ABC\nD', animation);
  for (const time of [0, 333, 1000, 1999, 2500, 2999]) assert.equal(frameAt(model, animation, time), frameAt(model, animation, time));
  // 340ms and 400ms fall in the same 12 fps frame.
  assert.equal(frameAt(model, animation, 340), frameAt(model, animation, 400));
  assert.equal(frameCount(animation), 36);
  assert.equal(frameIndex(animation, 3000), 0);
  assert.equal(frameIndex({ ...animation, loop: false }, 9000), 35);
});
test('typewriter frames keep the final canvas and type one prefix at a time', () => {
  for (const align of ['left', 'center', 'right'] as const) {
    const animation = { ...DEFAULT_ANIMATION, effect: 'typewriter' as const };
    const model = render('figlet/future', 'TYPE\nIT', animation, { align });
    assert.equal(model.typewriter!.length, 8);
    for (const frame of model.typewriter!) shape(frame, model.columns, model.rows);
    assert.equal(model.typewriter![0].trim(), '');
    assert.deepEqual(model.typewriter!.at(-1)!.split('\n'), toCanvas(model.text, model.columns, model.rows));
    // Every visible cell of every frame is already in the same place in the final artwork.
    const final = toCanvas(model.text, model.columns, model.rows).map(row => Array.from(row));
    for (const frame of model.typewriter!) frame.split('\n').forEach((row, r) => Array.from(row).forEach((cell, c) => { if (cell !== ' ') assert.equal(cell, final[r][c], `${align} ${r}:${c}`); }));
    shape(frameAt(model, animation, 0), model.columns, model.rows);
    assert.equal(frameAt(model, animation, 0).trim(), '');
    assert.equal(frameAt(model, animation, 2000), model.typewriter!.at(-1));
  }
  assert.deepEqual(typewriterPrefixes(3), [0, 1, 2, 3]);
  // Long inputs use fewer prefix renders to bound the work.
  assert.equal(typewriterPrefixes(300).length, TYPEWRITER_STEPS + 1);
  assert.equal(typewriterPrefixes(2000).length, 4);
  assert.equal(typewriterPrefixes(2000).at(-1), 2000);
  assert.equal(render('figlet/future', 'X', { effect: 'reveal' }).typewriter, undefined);
});
test('reveal directions wipe the finished artwork by row or column', () => {
  const model = render('figlet/letter', 'AB\nCD', { effect: 'reveal' });
  const final = toCanvas(model.text, model.columns, model.rows);
  const half = (direction: Animation['direction']) => frameAt(model, { ...DEFAULT_ANIMATION, effect: 'reveal', direction }, 1000).split('\n');
  const rows = Math.ceil(model.rows / 2), columns = Math.ceil(model.columns / 2);
  half('down').forEach((row, r) => assert.equal(row, r < rows ? final[r] : ' '.repeat(model.columns)));
  half('up').forEach((row, r) => assert.equal(row, r >= model.rows - rows ? final[r] : ' '.repeat(model.columns)));
  half('right').forEach((row, r) => assert.equal(row, final[r].slice(0, columns) + ' '.repeat(model.columns - columns)));
  half('left').forEach((row, r) => assert.equal(row, ' '.repeat(model.columns - columns) + final[r].slice(model.columns - columns)));
  assert.deepEqual(frameAt(model, { ...DEFAULT_ANIMATION, effect: 'reveal' }, 2100).split('\n'), final);
});
test('animation settings are validated and older recipes gain the default', () => {
  assert.throws(() => parseAnimation({ ...DEFAULT_ANIMATION, effect: 'morph' }), /effect/);
  assert.throws(() => parseAnimation({ ...DEFAULT_ANIMATION, fps: 60 }), /Frame rate/);
  assert.throws(() => parseAnimation({ ...DEFAULT_ANIMATION, durationMs: 100 }), /Duration/);
  const v3 = { schemaVersion: 3, id: '00000000-0000-4000-8000-000000000001', input: 'A', familyId: FONT.familyId, variantId: FONT.variantId, fontSha256: FONT.sha256, rendererVersion: FONT.rendererVersion, colors: DEFAULT_COLORS, layout: DEFAULT_LAYOUT };
  assert.deepEqual(parseRecipe(v3).animation, DEFAULT_ANIMATION);
});
test('seeking, end hold and play-once resolve through the same frame function', () => {
  const animation: Animation = { ...DEFAULT_ANIMATION, effect: 'reveal', durationMs: 1000, holdMs: 500, fps: 10, loop: false };
  const model = render('figlet/letter', 'HOLD', animation);
  const final = toCanvas(model.text, model.columns, model.rows).join('\n');
  assert.equal(frameCount(animation), 15);
  // Every frame in the hold shows the finished artwork; seeking to a frame equals playing to it.
  for (let index = 10; index < 15; index++) assert.equal(frameAt(model, animation, index * 100), final);
  assert.notEqual(frameAt(model, animation, 500), final);
  assert.equal(frameAt(model, animation, 60_000), final);
  assert.equal(frameAt(model, { ...animation, loop: true }, 1500), frameAt(model, animation, 0));
});
import { cycleSlots, frameDataAt } from './animation.ts';
const PRESETS = ['palette-cycle', 'shimmer', 'glitch'] as const;
test('every preset gives the same cells and colors for the same recipe, seed and timestamp', () => {
  for (const effect of PRESETS) for (const variantId of ['figlet/linguaholic-shadow-3d', 'figlet/letter']) {
    const animation: Animation = { ...DEFAULT_ANIMATION, effect, seed: 42, direction: 'right' };
    const model = render(variantId, 'GLITCH ME\nTWO', animation);
    const font = getVariant(variantId);
    for (let index = 0; index < frameCount(animation); index++) {
      const time = index * 1000 / animation.fps;
      const a = frameDataAt(model, animation, time, DEFAULT_COLORS, font), b = frameDataAt(model, animation, time, DEFAULT_COLORS, font);
      assert.deepEqual(a, b, `${effect} ${index}`);
      shape(a.text, model.columns, model.rows);
      assert.equal(a.runs.map(run => run.text).join(''), a.text);
    }
  }
});
test('glitch stays inside the canvas, depends on the seed and restores the original', () => {
  const animation: Animation = { ...DEFAULT_ANIMATION, effect: 'glitch', intensity: 5, seed: 7 };
  const model = render('figlet/letter', 'NOISE', animation);
  const final = toCanvas(model.text, model.columns, model.rows).join('\n');
  const glyphs = new Set(final);
  let changed = 0;
  for (let index = 0; index < frameCount(animation); index++) {
    const frame = frameAt(model, animation, index * 1000 / animation.fps);
    shape(frame, model.columns, model.rows);
    for (const cell of frame) assert(glyphs.has(cell) || cell === ' ', 'only characters from the artwork');
    if (frame !== final) changed++;
  }
  assert(changed > 0);
  for (let time = 2000; time < 3000; time += 100) assert.equal(frameAt(model, animation, time), final);
  const other = { ...animation, seed: 8 };
  assert.notDeepEqual(Array.from({ length: 24 }, (_, i) => frameAt(model, animation, i * 1000 / 12)), Array.from({ length: 24 }, (_, i) => frameAt(model, other, i * 1000 / 12)));
});
test('palette cycle rotates supported slots and states how single-slot fonts cycle', () => {
  assert.deepEqual(cycleSlots(['foreground', 'background', 'shadow']), ['foreground', 'shadow']);
  assert.deepEqual(cycleSlots(['foreground', 'background']), ['foreground', 'shadow', 'highlight']);
  const animation: Animation = { ...DEFAULT_ANIMATION, effect: 'palette-cycle' };
  const font = getVariant('figlet/linguaholic-shadow-3d');
  const model = render(font.variantId, 'A', animation);
  const colors = { ...DEFAULT_COLORS, foreground: '#111111', shadow: '#222222' };
  const half = frameDataAt(model, animation, 1000, colors, font).colors;
  assert.deepEqual([half.foreground, half.shadow, half.background], ['#222222', '#111111', colors.background]);
  assert.deepEqual(frameDataAt(model, animation, 2000, colors, font).colors, colors);
  // The text never changes for color-only presets.
  assert.equal(frameDataAt(model, animation, 1000, colors, font).text, toCanvas(model.text, model.columns, model.rows).join('\n'));
});
test('shimmer moves a highlight band across visible cells only, then clears it', () => {
  const animation: Animation = { ...DEFAULT_ANIMATION, effect: 'shimmer', direction: 'right', intensity: 1 };
  const font = getVariant('figlet/letter');
  const model = render(font.variantId, 'SHINE', animation);
  const highlighted = (time: number) => frameDataAt(model, animation, time, DEFAULT_COLORS, font).runs.filter(run => run.slot === 'highlight');
  const early = highlighted(250), late = highlighted(1500);
  assert(early.length && late.length);
  for (const run of [...early, ...late]) assert(!/\s/.test(run.text));
  assert.equal(highlighted(2000).length, 0);
  assert.deepEqual(parseAnimation({ effect: 'glitch', direction: 'down', durationMs: 2000, fps: 12, loop: true, holdMs: 0 }).seed, DEFAULT_ANIMATION.seed);
});
