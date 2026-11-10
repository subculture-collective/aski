import type { ColorRun } from './color.ts';
import { colorize } from './color.ts';
import type { Colors, Slot } from './recipe.ts';
import type { FontVariant } from './catalog.ts';
// One deterministic frame function serves the preview and (later) GIF export. Every frame has exactly the
// final artwork's rows and columns, so nothing shifts or crops between frames.
export const EFFECTS = ['none', 'typewriter', 'reveal', 'palette-cycle', 'shimmer', 'glitch'] as const;
export const DIRECTIONS = ['down', 'up', 'right', 'left'] as const;
export interface Animation {
  effect: typeof EFFECTS[number]; direction: typeof DIRECTIONS[number];
  durationMs: number; fps: number; loop: boolean; holdMs: number;
  // Shimmer band width and glitch strength (1–5); the glitch seed makes random frames repeatable.
  intensity: number; seed: number;
}
export const DEFAULT_ANIMATION: Animation = { effect: 'none', direction: 'down', durationMs: 2000, fps: 12, loop: true, holdMs: 1000, intensity: 3, seed: 1 };
export const LIMITS = { durationMs: [500, 20_000], fps: [1, 30], holdMs: [0, 10_000], intensity: [1, 5], seed: [0, 2 ** 31 - 1] } as const;
// Typewriter frames come from at most this many prefix renders, independent of frame rate.
export const TYPEWRITER_STEPS = 24;
const integer = (value: unknown, [low, high]: readonly [number, number], label: string) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) throw new Error(`${label} must be a whole number from ${low} to ${high}.`);
  return value;
};
export function parseAnimation(value: unknown): Animation {
  const a = value as Partial<Animation> | null;
  if (!a || typeof a !== 'object') throw new Error('Invalid animation.');
  if (!EFFECTS.includes(a.effect as Animation['effect'])) throw new Error('Unknown animation effect.');
  if (!DIRECTIONS.includes(a.direction as Animation['direction'])) throw new Error('Unknown animation direction.');
  if (typeof a.loop !== 'boolean') throw new Error('Invalid loop setting.');
  // Intensity and seed were added within version 4; records without them take the defaults.
  return { effect: a.effect!, direction: a.direction!, durationMs: integer(a.durationMs, LIMITS.durationMs, 'Duration'),
    fps: integer(a.fps, LIMITS.fps, 'Frame rate'), loop: a.loop, holdMs: integer(a.holdMs, LIMITS.holdMs, 'End hold'),
    intensity: integer(a.intensity ?? DEFAULT_ANIMATION.intensity, LIMITS.intensity, 'Intensity'), seed: integer(a.seed ?? DEFAULT_ANIMATION.seed, LIMITS.seed, 'Seed') };
}
export const cycleMs = (animation: Animation) => animation.durationMs + animation.holdMs;
export const frameCount = (animation: Animation) => Math.max(1, Math.ceil(cycleMs(animation) * animation.fps / 1000));
// Frame i is shown at exactly i / fps seconds, so preview and export sample the same instants.
export const frameTime = (animation: Animation, index: number) => index * 1000 / animation.fps;
export const frameIndex = (animation: Animation, timeMs: number) => {
  const count = frameCount(animation);
  const index = Math.floor(Math.max(0, timeMs) * animation.fps / 1000);
  return animation.loop ? index % count : Math.min(index, count - 1);
};
export function typewriterPrefixes(characters: number) {
  const steps = Math.min(TYPEWRITER_STEPS, characters);
  return Array.from({ length: steps + 1 }, (_, step) => steps ? Math.round(step * characters / steps) : 0);
}
export function toCanvas(text: string, columns: number, rows: number) {
  const lines = text.replace(/\n$/, '').split('\n');
  return Array.from({ length: rows }, (_, row) => {
    const cells = Array.from(lines[row] ?? '').slice(0, columns);
    return cells.join('') + ' '.repeat(columns - cells.length);
  });
}
export interface FrameModel { text: string; columns: number; rows: number; typewriter?: string[] }
const progressAt = (animation: Animation, timeMs: number) => {
  const index = frameIndex(animation, timeMs);
  return { index, progress: Math.min(1, frameTime(animation, index) / animation.durationMs) };
};
// Small seeded generator (mulberry32): the same seed and frame always give the same glitch.
export function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Glitch shifts some rows sideways inside the canvas and swaps some cells for other characters already in
// the artwork. Shifted rows are clipped and padded, so nothing leaves the canvas. The last frame of the
// duration and the end hold show the original artwork.
function glitch(final: string[], animation: Animation, index: number, progress: number) {
  if (progress >= 1) return final;
  const next = random(animation.seed * 7919 + index);
  const strength = animation.intensity / 5;
  const glyphs = [...new Set(final.join('').replace(/\s/g, ''))];
  return final.map(line => {
    let cells = Array.from(line);
    if (next() < strength * 0.35) {
      const shift = Math.round((next() * 2 - 1) * animation.intensity);
      cells = shift > 0 ? [...Array(shift).fill(' '), ...cells].slice(0, cells.length) : [...cells.slice(-shift), ...Array(-shift).fill(' ')];
    }
    return cells.map(cell => cell !== ' ' && glyphs.length && next() < strength * 0.08 ? glyphs[Math.floor(next() * glyphs.length)] : cell).join('');
  });
}
// Returns the frame for the given time as canvas rows joined by line breaks.
export function frameAt(model: FrameModel, animation: Animation, timeMs: number): string {
  const { columns, rows } = model;
  const final = toCanvas(model.text, columns, rows);
  const { index, progress } = progressAt(animation, timeMs);
  if (animation.effect === 'glitch') return glitch(final, animation, index, progress).join('\n');
  if (animation.effect === 'typewriter' && model.typewriter?.length) {
    const steps = model.typewriter.length - 1;
    return toCanvas(model.typewriter[Math.min(steps, Math.floor(progress * steps))], columns, rows).join('\n');
  }
  if (animation.effect !== 'reveal') return final.join('\n');
  const shownRows = Math.ceil(progress * rows), shownColumns = Math.ceil(progress * columns);
  const visible = (row: number, column: number) => animation.direction === 'down' ? row < shownRows
    : animation.direction === 'up' ? row >= rows - shownRows
      : animation.direction === 'right' ? column < shownColumns : column >= columns - shownColumns;
  return final.map((line, row) => Array.from(line, (cell, column) => visible(row, column) ? cell : ' ').join('')).join('\n');
}
// Slots whose colors palette cycle rotates: the font's own color slots, or, for a font with only a
// foreground, the foreground plus the design's shadow and highlight colors.
export function cycleSlots(slots: readonly Slot[]): Slot[] {
  const own = slots.filter(slot => slot !== 'background');
  return own.length > 1 ? own : ['foreground', 'shadow', 'highlight'];
}
export interface FrameData { text: string; colors: Colors; runs: ColorRun[] }
// Text plus per-cell color runs for one instant. Preview, still exports and GIF frames all use this.
export function frameDataAt(model: FrameModel, animation: Animation, timeMs: number, colors: Colors, font: Pick<FontVariant, 'colorMapping' | 'slots'>): FrameData {
  const text = frameAt(model, animation, timeMs);
  const { progress } = progressAt(animation, timeMs);
  let frameColors = colors;
  let runs = colorize(text, font);
  if (animation.effect === 'palette-cycle' && progress < 1) {
    const slots = cycleSlots(font.slots as Slot[]);
    const step = Math.floor(progress * slots.length);
    frameColors = { ...colors };
    // At most one full rotation per duration; progress 1 restores the original assignment.
    slots.forEach((slot, position) => { frameColors[slot] = colors[slots[(position + step) % slots.length]]; });
  }
  if (animation.effect === 'shimmer' && progress < 1) runs = shimmer(runs, animation, progress, model);
  return { text, colors: frameColors, runs };
}
// A highlight band of `intensity + 1` rows or columns crosses the artwork once per duration.
function shimmer(runs: ColorRun[], animation: Animation, progress: number, model: FrameModel): ColorRun[] {
  const horizontal = animation.direction === 'right' || animation.direction === 'left';
  const span = horizontal ? model.columns : model.rows;
  const width = animation.intensity + 1;
  const travel = span + width;
  let start = Math.floor(progress * travel) - width;
  if (animation.direction === 'left' || animation.direction === 'up') start = span - start - width;
  const inBand = (position: number) => position >= start && position < start + width;
  const result: ColorRun[] = [];
  let row = 0, column = 0;
  for (const run of runs) for (const cell of run.text) {
    const slot = run.slot && inBand(horizontal ? column : row) ? 'highlight' : run.slot;
    const last = result.at(-1);
    if (last && last.slot === slot) last.text += cell; else result.push({ slot, text: cell });
    if (cell === '\n') { row++; column = 0; } else column++;
  }
  return result;
}
