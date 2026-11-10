// One deterministic frame function serves the preview and (later) GIF export. Every frame has exactly the
// final artwork's rows and columns, so nothing shifts or crops between frames.
export const EFFECTS = ['none', 'typewriter', 'reveal'] as const;
export const DIRECTIONS = ['down', 'up', 'right', 'left'] as const;
export interface Animation {
  effect: typeof EFFECTS[number]; direction: typeof DIRECTIONS[number];
  durationMs: number; fps: number; loop: boolean; holdMs: number;
}
export const DEFAULT_ANIMATION: Animation = { effect: 'none', direction: 'down', durationMs: 2000, fps: 12, loop: true, holdMs: 1000 };
export const LIMITS = { durationMs: [500, 20_000], fps: [1, 30], holdMs: [0, 10_000] } as const;
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
  return { effect: a.effect!, direction: a.direction!, durationMs: integer(a.durationMs, LIMITS.durationMs, 'Duration'),
    fps: integer(a.fps, LIMITS.fps, 'Frame rate'), loop: a.loop, holdMs: integer(a.holdMs, LIMITS.holdMs, 'End hold') };
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
// Returns the frame for the given time as canvas rows joined by line breaks.
export function frameAt(model: FrameModel, animation: Animation, timeMs: number): string {
  const { columns, rows } = model;
  const final = toCanvas(model.text, columns, rows);
  const time = frameTime(animation, frameIndex(animation, timeMs));
  const progress = Math.min(1, time / animation.durationMs);
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
