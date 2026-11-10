import { getVariant } from '../shared/catalog.ts';
import { frameDataAt, frameTime } from '../shared/animation.ts';
import type { Animation, FrameModel } from '../shared/animation.ts';
import { imageSize } from '../shared/image.ts';
import type { ImageOptions } from '../shared/image.ts';
import { createGif, gifSchedule, validateGif } from '../shared/gif.ts';
import type { Colors } from '../shared/recipe.ts';
import { drawCells } from './draw.ts';
export interface GifJob { jobId: number; model: FrameModel; animation: Animation; colors: Colors; variantId: string; options: ImageOptions }
export type GifReply = { jobId: number; type: 'progress'; done: number; total: number }
  | { jobId: number; type: 'done'; bytes: Uint8Array; frames: number } | { jobId: number; type: 'error'; message: string };
// Encodes the preview's frames. Cancellation terminates this worker; a new job uses a fresh one.
self.onmessage = (event: MessageEvent<GifJob>) => {
  const { jobId, model, animation, colors, variantId, options } = event.data;
  const post = (reply: GifReply, transfer: Transferable[] = []) => self.postMessage(reply, { transfer });
  try {
    const { width, height } = imageSize(model.columns, model.rows, options);
    const schedule = gifSchedule(animation);
    const problem = validateGif(width, height, schedule.length);
    if (problem) throw new Error(problem);
    const font = getVariant(variantId);
    const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser cannot draw GIF frames.');
    const gif = createGif({ width, height, transparent: options.transparent, loop: animation.loop });
    for (const { index, delayCs } of schedule) {
      const frame = frameDataAt(model, animation, frameTime(animation, index), colors, font);
      drawCells(context, frame.runs, frame.colors, width, height, options);
      gif.add(context.getImageData(0, 0, width, height).data, delayCs);
      post({ jobId, type: 'progress', done: index + 1, total: schedule.length });
    }
    const { bytes, frames } = gif.finish();
    post({ jobId, type: 'done', bytes, frames }, [bytes.buffer]);
  } catch (error) {
    post({ jobId, type: 'error', message: error instanceof Error ? error.message : 'Could not encode the GIF.' });
  }
};
