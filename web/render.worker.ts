import { getVariant } from '../shared/catalog.ts';
import { parseRecipe } from '../shared/recipe.ts';
import { loadFont, renderRecipe } from '../shared/render.ts';
import type { RenderRequest, RenderReply } from '../shared/render.ts';
const loading = new Map<string, Promise<void>>();
async function ensureFont(id: string) {
  if (!loading.has(id)) {
    const font = getVariant(id);
    const task = (async () => {
      const response = await fetch(font.path);
      if (!response.ok) throw new Error('Could not load this font. Try again.');
      const bytes = await response.arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (digest !== font.sha256) throw new Error('This font version is not available.');
      loadFont(new TextDecoder().decode(bytes), id);
    })();
    loading.set(id, task);
    task.catch(() => loading.delete(id));
  }
  await loading.get(id);
}
self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const { jobId, recipe } = event.data;
  let reply: RenderReply;
  try { const parsed = parseRecipe(recipe); await ensureFont(parsed.variantId); reply = { jobId, result: renderRecipe(parsed) }; }
  catch (error) { reply = { jobId, error: error instanceof Error ? error.message : 'Could not render this text.' }; }
  self.postMessage(reply);
};
