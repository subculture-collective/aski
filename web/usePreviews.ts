import { useEffect, useRef, useState } from 'react';
import { getVariant } from '../shared/catalog.ts';
import { FONT } from '../shared/recipe.ts';
import type { RenderReply, RenderResult } from '../shared/render.ts';
export const PREVIEW_LIMIT = 160;
const PREVIEW_ID = '00000000-0000-4000-8000-000000000000';
export function previewInput(input: string) {
  const characters = Array.from(input.replace(/\r\n?/g, '\n'));
  return characters.length > PREVIEW_LIMIT ? characters.slice(0, PREVIEW_LIMIT).join('') : characters.join('');
}
export interface Preview { input: string; result?: RenderResult; error?: string }
// Renders gallery previews one at a time in a separate worker so the selected design is never queued
// behind them. A result for older text stays visible until the current text has been rendered.
export function usePreviews(input: string, wanted: string[]) {
  const text = previewInput(input);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const worker = useRef<Worker | null>(null);
  const inFlight = useRef<{ jobId: number; variantId: string; input: string } | null>(null);
  const jobs = useRef(0);
  const latest = useRef({ text, wanted, previews });
  useEffect(() => { latest.current = { text, wanted, previews }; });
  function pump() {
    const { text, wanted, previews } = latest.current;
    if (inFlight.current || !worker.current) return;
    const next = wanted.find(id => previews[id]?.input !== text);
    if (!next) return;
    const font = getVariant(next);
    inFlight.current = { jobId: ++jobs.current, variantId: next, input: text };
    worker.current.postMessage({ jobId: inFlight.current.jobId, recipe: { schemaVersion: 1, id: PREVIEW_ID, input: text,
      familyId: font.familyId, variantId: next, fontSha256: font.sha256, rendererVersion: FONT.rendererVersion } });
  }
  useEffect(() => {
    const current = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    worker.current = current;
    const finish = (value: Omit<Preview, 'input'>) => {
      const job = inFlight.current; if (!job) return;
      inFlight.current = null;
      setPreviews(previous => ({ ...previous, [job.variantId]: { input: job.input, ...value } }));
    };
    current.onmessage = (event: MessageEvent<RenderReply>) => {
      if (event.data.jobId !== inFlight.current?.jobId) return;
      finish('error' in event.data ? { error: event.data.error } : { result: event.data.result });
    };
    current.onerror = () => finish({ error: 'Preview unavailable.' });
    return () => { current.terminate(); if (worker.current === current) worker.current = null; inFlight.current = null; };
  }, []);
  useEffect(pump);
  return { previews, text, truncated: text !== input.replace(/\r\n?/g, '\n') };
}
