import { useEffect, useRef, useState } from 'react';
import { MAX_INPUT } from '../shared/recipe.ts';
import { variants, getVariant } from '../shared/catalog.ts';
import { useDraft } from './useDraft.ts';
import { SignIn } from './SignIn.tsx';
import type { RenderReply, RenderResult } from '../shared/render.ts';

export function App() {
  const { recipe, setRecipe, undo, redo, canUndo, canRedo, warning, saveCurrent } = useDraft();
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
  const copyButton = useRef<HTMLButtonElement>(null);

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
    const copiedJob = latestJob.current;
    try { await navigator.clipboard.writeText(result.text); if (copiedJob === latestJob.current) setCopied(true); }
    catch { if (copiedJob === latestJob.current) setManual(true); }
  }
  const unsupported = result?.unsupported.map(c => `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`).join(', ');
  const font = getVariant(recipe.variantId);
  function moveHistory(direction: 'undo' | 'redo') {
    latestJob.current += 1; setPending(!!worker.current);
    if (direction === 'undo') undo(); else redo();
  }
  return <main onKeyDown={e => {
    if (e.target instanceof HTMLInputElement || (e.target instanceof HTMLTextAreaElement && e.target.id !== 'input')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault(); if (e.shiftKey ? canRedo : canUndo) moveHistory(e.shiftKey ? 'redo' : 'undo');
    }
  }}>
    <header><h1><a href="/" aria-label="aski studio"><img src="/brand/lockup.svg" alt="aski" /></a></h1><div className="header-actions"><SignIn /><button ref={copyButton} className="primary" onClick={() => void copy()} disabled={pending || !!error || !result?.text}>Copy text</button></div></header>
    <div className="studio">
      <section className="editor" aria-labelledby="input-title">
        <label id="input-title" htmlFor="input">Text</label>
        <textarea id="input" value={recipe.input} spellCheck={false} aria-describedby="input-limit" onChange={e => { latestJob.current += 1; setPending(!!worker.current); setRecipe(previous => ({ ...previous, input: e.target.value })); }} />
        <small id="input-limit">Up to {MAX_INPUT} characters</small>
        <div className="history-controls">
          <button onClick={() => moveHistory('undo')} disabled={!canUndo}>Undo</button>
          <button onClick={() => moveHistory('redo')} disabled={!canRedo}>Redo</button>
        </div>
        {warning && <div className="warning" data-testid="draft-warning"><p>{warning}</p><button onClick={saveCurrent}>Save this draft</button></div>}
        <label htmlFor="font">Style</label>
        <select id="font" value={recipe.variantId} onChange={e => {
          const next = getVariant(e.target.value); latestJob.current += 1; setPending(!!worker.current);
          setRecipe(previous => ({ ...previous, familyId: next.familyId, variantId: next.variantId, fontSha256: next.sha256 }));
        }}>
          {Array.from(new Set(variants.map(item => item.familyId))).map(family => <optgroup key={family} label={family.replace('figlet/', '')}>
            {variants.filter(item => item.familyId === family).map(item => <option key={item.variantId} value={item.variantId}>{item.name}</option>)}
          </optgroup>)}
        </select>
      </section>
      <section className="artwork" aria-labelledby="output-title" aria-busy={pending}>
        <div className="output-heading"><h2 id="output-title">{font.name}</h2><span aria-label="Output dimensions">{result && !pending && !error ? `${result.columns} columns / ${result.rows} rows` : ''}</span></div>
        <pre tabIndex={0} aria-label="Rendered text art" data-testid="output">{result?.text || ''}</pre>
        <div className="status" role="status">{error || (pending ? 'Rendering…' : copied ? 'Copied' : !recipe.input ? 'Type something.' : '')}</div>
        {error && !error.startsWith('Use ') && <button onClick={() => setRestart(value => value + 1)}>Try again</button>}
        {unsupported && !pending && !error && <p className="warning">Unsupported: {unsupported}</p>}
      </section>
    </div>
    <footer><a href={font.noticePath}>{font.name} · {font.license} notice</a><span>Type: <a href="/brand/fonts/fraunces-OFL.txt">Fraunces</a> · <a href="/brand/fonts/atkinsonhyperlegiblenext-OFL.txt">Atkinson</a></span></footer>
    <dialog ref={dialog} aria-labelledby="copy-title" onClose={() => { setManual(false); copyButton.current?.focus(); }}>
      <h2 id="copy-title">Copy text</h2><p>Select and copy the text.</p>
      <textarea ref={manualText} aria-label="Text to copy" value={result?.text || ''} readOnly />
      <button onClick={() => dialog.current?.close()}>Done</button>
    </dialog>
  </main>;
}
