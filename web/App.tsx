import { useEffect, useRef, useState } from 'react';
import { FONT, MAX_INPUT } from '../shared/recipe.ts';
import type { RecipeV1 } from '../shared/recipe.ts';
import type { RenderReply, RenderResult } from '../shared/render.ts';

export function App() {
  const [recipe, setRecipe] = useState<RecipeV1>(() => ({ schemaVersion: 1, id: crypto.randomUUID(), input: 'ASKI', familyId: FONT.familyId, variantId: FONT.variantId }));
  const [result, setResult] = useState<RenderResult | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [restart, setRestart] = useState(0);
  const worker = useRef<Worker | null>(null);
  const latestJob = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const manualText = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const current = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    worker.current = current;
    current.onmessage = (event: MessageEvent<RenderReply>) => {
      if (event.data.jobId !== latestJob.current) return;
      setPending(false);
      if ('error' in event.data) { setError(event.data.error); return; }
      setError(''); setResult(event.data.result);
    };
    current.onerror = () => {
      current.terminate(); worker.current = null; setPending(false); setError('Could not render. Try again.');
    };
    return () => { current.terminate(); if (worker.current === current) worker.current = null; };
  }, [restart]);

  useEffect(() => {
    setCopied(false);
    if (!worker.current) return;
    setPending(true); setError('');
    worker.current.postMessage({ jobId: ++latestJob.current, recipe });
  }, [recipe, restart]);

  useEffect(() => {
    if (manual) { dialog.current?.showModal(); manualText.current?.select(); }
  }, [manual]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    if (!result || pending || error) return;
    try { await navigator.clipboard.writeText(result.text); setCopied(true); }
    catch { setManual(true); }
  }
  const unsupported = result?.unsupported.map(c => `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`).join(', ');
  return <main>
    <header><h1>aski</h1><button onClick={() => void copy()} disabled={pending || !!error || !result?.text}>Copy text</button></header>
    <div className="studio">
      <section aria-labelledby="input-title">
        <label id="input-title" htmlFor="input">Text</label>
        <textarea id="input" value={recipe.input} spellCheck={false} aria-describedby="input-limit" onChange={e => { latestJob.current += 1; setPending(!!worker.current); setRecipe(previous => ({ ...previous, input: e.target.value })); }} />
        <small id="input-limit">Up to {MAX_INPUT} characters</small>
      </section>
      <section aria-labelledby="output-title" aria-busy={pending}>
        <div className="output-heading"><h2 id="output-title">{FONT.name}</h2><span aria-label="Output dimensions">{result && !pending && !error ? `${result.columns} columns / ${result.rows} rows` : ''}</span></div>
        <pre tabIndex={0} aria-label="Rendered text art" data-testid="output">{result?.text || ''}</pre>
        <div className="status" role="status">{error || (pending ? 'Rendering…' : copied ? 'Copied' : !recipe.input ? 'Type something.' : '')}</div>
        {error === 'Could not render. Try again.' && <button onClick={() => setRestart(value => value + 1)}>Try again</button>}
        {unsupported && !pending && !error && <p className="warning">Unsupported: {unsupported}</p>}
      </section>
    </div>
    <footer>ANSI Compact by Loic Cressot. <a href="/font-notice.txt">MIT license</a>.</footer>
    <dialog ref={dialog} aria-labelledby="copy-title" onClose={() => setManual(false)}>
      <h2 id="copy-title">Copy text</h2><p>Select and copy the text.</p>
      <textarea ref={manualText} aria-label="Text to copy" value={result?.text || ''} readOnly />
      <button onClick={() => dialog.current?.close()}>Done</button>
    </dialog>
  </main>;
}
