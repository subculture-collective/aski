import source from './fonts/ANSI-Compact.flf?raw';
import { loadFont, renderRecipe } from '../shared/render.ts';
import type { RenderRequest, RenderReply } from '../shared/render.ts';
loadFont(source);
self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const { jobId, recipe } = event.data;
  let reply: RenderReply;
  try { reply = { jobId, result: renderRecipe(recipe) }; }
  catch (error) { reply = { jobId, error: error instanceof Error ? error.message : 'Could not render this text.' }; }
  self.postMessage(reply);
};
