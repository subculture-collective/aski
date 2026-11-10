import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { colorize } from '../shared/color.ts';
import { exportName, toAnsi, toCodeBlock } from '../shared/export.ts';
import { frameDataAt, frameTime } from '../shared/animation.ts';
import { decodeShare, encodeShare } from '../shared/share.ts';
import { MAX_INPUT, parseRecipe } from '../shared/recipe.ts';
import type { Slot } from '../shared/recipe.ts';
import { defaultName, findMembership, parseName } from '../shared/library.ts';
import type { ArtifactMeta, CollectionPayload, DesignPayload, FavoritePayload, InputPayload, LibraryRecord, PalettePayload } from '../shared/library.ts';
import { variants, getFamily, getVariant } from '../shared/catalog.ts';
import type { FontFamily } from '../shared/catalog.ts';
import { useDraft } from './useDraft.ts';
import { SignIn } from './SignIn.tsx';
import { Gallery } from './Gallery.tsx';
import { useScrollAnchor } from './useScrollAnchor.ts';
import { useLibrary } from './useLibrary.ts';
import { Favorites } from './Favorites.tsx';
import { SavedWork } from './SavedWork.tsx';
import { Colors } from './Colors.tsx';
import { LayoutControls } from './LayoutControls.tsx';
import { AnimationPanel } from './AnimationPanel.tsx';
import { Seamless } from './Seamless.tsx';
import { ImageExport } from './ImageExport.tsx';
import { toPng } from './imageExport.ts';
import { DEFAULT_IMAGE, imageSize, toSvg } from '../shared/image.ts';
import type { ImageOptions } from '../shared/image.ts';
import { CollectionPicker, Collections } from './Collections.tsx';
import type { RenderReply, RenderResult } from '../shared/render.ts';

export function App() {
  const { recipe, setRecipe, undo, redo, canUndo, canRedo, warning, saveCurrent } = useDraft();
  const [result, setResult] = useState<RenderResult | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [inspected, setInspected] = useState(0);
  const [pins, setPins] = useState<string[]>([]);
  const [shareNotice, setShareNotice] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [sharedSize, setSharedSize] = useState<{ columns: number; rows: number } | null>(null);
  const [opened, setOpened] = useState<{ recipe: string; snapshot: string } | null>(null);
  const [restart, setRestart] = useState(0);
  const worker = useRef<Worker | null>(null);
  const latestJob = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const manualText = useRef<HTMLTextAreaElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const studio = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLElement>(null);
  const [chosenVariants, setChosenVariants] = useState<Record<string, string>>({});
  const library = useLibrary();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // On phones the editor sticks to the top, so content behind it is not in view.
  const inset = useCallback(() => {
    const box = editor.current?.getBoundingClientRect();
    return box && matchMedia('(max-width: 760px)').matches && box.top <= 1 ? box.bottom : 0;
  }, []);
  useScrollAnchor(studio, inset);

  // Created in a layout effect so it exists before the first render request below.
  useLayoutEffect(() => {
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

  // Only text and font change the rendered text; colors are applied to the existing result.
  const renderKey = JSON.stringify([recipe.input, recipe.variantId, recipe.layout.spacing, recipe.layout.width, recipe.layout.align, recipe.animation.effect === 'typewriter']);
  // A layout effect marks the result pending in the same commit as the edit, so a stale result never looks current.
  useLayoutEffect(() => {
    setCopied(false);
    if (!worker.current) return;
    setPending(true); setError('');
    worker.current.postMessage({ jobId: ++latestJob.current, recipe });
  }, [renderKey, restart]);

  useEffect(() => {
    if (manual) { dialog.current?.showModal(); manualText.current?.select(); }
  }, [manual]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy(format: 'text' | 'code' = 'text') {
    if (!result || pending || error) return;
    const copiedJob = latestJob.current;
    const value = format === 'code' ? toCodeBlock(result.text) : result.text;
    try { await navigator.clipboard.writeText(value); if (copiedJob === latestJob.current) setCopied(true); }
    catch { if (copiedJob === latestJob.current) { setManualValue(value); setManual(true); } }
  }
  // Downloads are built from the same result that is displayed; UTF-8 without a byte-order mark.
  function save(blob: Blob, extension: string) {
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: exportName(`${font.name} ${recipe.input}`, extension) });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function download(format: 'text' | 'ansi') {
    if (!result || pending || error) return;
    save(new Blob([format === 'ansi' ? toAnsi(runs, recipe.colors) : result.text], { type: 'text/plain;charset=utf-8' }), format === 'ansi' ? 'ans' : 'txt');
  }
  async function exportImage(format: 'png' | 'svg', options: ImageOptions, useFrame: boolean) {
    if (!result || pending || error) throw new Error('The artwork is not ready.');
    const size = { columns: result.columns, rows: result.rows };
    // The inspected frame comes from the same frame function as the preview and GIF.
    const frame = useFrame ? frameDataAt(result, recipe.animation, frameTime(recipe.animation, inspected), recipe.colors, font) : { runs, colors: recipe.colors };
    save(format === 'svg' ? new Blob([toSvg(frame.runs, frame.colors, size, options)], { type: 'image/svg+xml' }) : await toPng(frame.runs, frame.colors, size, options), format);
  }
  async function copySaved(text: string) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { setManualValue(text); setManual(true); return false; }
  }
  function openSaved(record: LibraryRecord<InputPayload | DesignPayload>) {
    if (record.type === 'input') {
      const { text } = record.payload as InputPayload;
      setRecipe(previous => ({ ...previous, input: text }));
      return '';
    }
    const design = record.payload as DesignPayload;
    let saved;
    try { saved = parseRecipe(design.recipe); }
    catch { return 'This design needs a font or renderer this version does not have. Its saved text is still available.'; }
    setRecipe(() => saved);
    setOpened({ recipe: JSON.stringify(saved), snapshot: design.snapshot.text });
    return '';
  }
  const font = getVariant(recipe.variantId);
  const ready = !!result && !pending && !error;
  const runs = useMemo(() => colorize(result?.text || '', font), [result, font]);
  const artColors = Object.fromEntries(Object.entries(recipe.colors).map(([slot, color]) => [`--slot-${slot}`, color])) as CSSProperties;
  const picker = (item: LibraryRecord<FavoritePayload | DesignPayload>) => <CollectionPicker item={item} collections={library.collections}
    isMember={collectionId => !!findMembership(library.records, collectionId, item.id)} onToggle={collectionId => library.toggleMembership(collectionId, item)} />;
  const applyFavorite = (favorite: FavoritePayload) => chooseVariant(favorite.variantId ?? variantFor(getFamily(favorite.familyId)));
  // A reopened design re-renders with this build; say so if that no longer matches its saved text.
  const openedDiffers = ready && opened?.recipe === JSON.stringify(recipe) && opened.snapshot !== result.text;
  const unsupported = result?.unsupported.map(c => `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`).join(', ');
  // Opening a share link applies its design as one undoable edit, then removes the fragment so a reload
  // does not apply it again. Invalid links leave the draft unchanged.
  useEffect(() => {
    const open = () => {
      const fragment = location.hash;
      if (!fragment.startsWith('#share=')) return;
      history.replaceState(null, '', location.pathname + location.search);
      decodeShare(fragment, crypto.randomUUID()).then(({ recipe: shared, size }) => {
        setRecipe(() => shared); setSharedSize(size);
        setShareNotice('Opened a shared design. Undo returns to your previous draft.');
      }, error => setShareNotice(`${(error as Error).message} Your draft is unchanged.`));
    };
    open();
    addEventListener('hashchange', open);
    return () => removeEventListener('hashchange', open);
    // setRecipe always applies to the latest draft.
  }, []);
  // Compare the first render of a shared design with the size recorded in the link, once.
  useEffect(() => {
    if (!sharedSize || !ready) return;
    if (sharedSize.columns !== result.columns || sharedSize.rows !== result.rows)
      setShareNotice(`Opened a shared design. This version renders it at ${result.columns} × ${result.rows} instead of ${sharedSize.columns} × ${sharedSize.rows}. Undo returns to your previous draft.`);
    setSharedSize(null);
  }, [sharedSize, ready, result]);
  // Saves the recipe and text snapshot, plus any chosen image files rendered right now with the default
  // image settings. The files are stored as bytes and never regenerated.
  async function saveDesign(keep: { png: boolean; svg: boolean }) {
    if (!result || pending || error) return '';
    const size = { columns: result.columns, rows: result.rows };
    const options = { ...DEFAULT_IMAGE, blocks: recipe.layout.blocks && font.blocks };
    const { width, height } = imageSize(size.columns, size.rows, options);
    const provenance = { variantId: font.variantId, fontSha256: font.sha256, rendererVersion: recipe.rendererVersion };
    const files = [];
    try {
      if (keep.png) files.push({ mime: 'image/png' as const, bytes: new Uint8Array(await (await toPng(runs, recipe.colors, size, options)).arrayBuffer()), width, height, provenance });
      if (keep.svg) files.push({ mime: 'image/svg+xml' as const, bytes: new TextEncoder().encode(toSvg(runs, recipe.colors, size, options)), width, height, provenance });
    } catch { /* an image that cannot be drawn is skipped; the design still saves */ }
    return library.addDesign({ name: defaultName(recipe.input, font.name), recipe: { ...recipe, id: crypto.randomUUID() }, snapshot: { text: result.text, ...size } }, files);
  }
  async function downloadArtifact(meta: ArtifactMeta) {
    try {
      const artifact = await library.readArtifact(meta.id);
      save(new Blob([artifact.bytes as BlobPart], { type: artifact.mime }), artifact.mime === 'image/gif' ? 'gif' : artifact.mime === 'image/png' ? 'png' : 'svg');
      return '';
    } catch (failure) { return (failure as Error).message; }
  }
  async function share() {
    if (!result || pending || error) return;
    try {
      const link = location.origin + location.pathname + await encodeShare(recipe, { columns: result.columns, rows: result.rows });
      setShareLink(link);
      try { await navigator.clipboard.writeText(link); setShareNotice('Share link copied.'); }
      catch { setShareNotice('Select the link below and copy it.'); }
    } catch (failure) { setShareLink(''); setShareNotice((failure as Error).message); }
  }
  // Remember the active family's variant so switching to another family and back keeps it.
  useEffect(() => setChosenVariants(previous => previous[recipe.familyId] === recipe.variantId ? previous
    : { ...previous, [recipe.familyId]: recipe.variantId }), [recipe.familyId, recipe.variantId]);
  const variantFor = (family: FontFamily) => family.familyId === recipe.familyId ? recipe.variantId
    : chosenVariants[family.familyId] || family.defaultVariantId;
  function chooseVariant(variantId: string) {
    const next = getVariant(variantId);
    // Keep the layout unless the new font cannot smush.
    setRecipe(previous => ({ ...previous, familyId: next.familyId, variantId: next.variantId, fontSha256: next.sha256,
      layout: previous.layout.spacing === 'smush' && !next.spacing.smush ? { ...previous.layout, spacing: 'default' } : previous.layout }));
  }
  function moveHistory(direction: 'undo' | 'redo') {
    if (direction === 'undo') undo(); else redo();
  }
  return <main onKeyDown={e => {
    if (e.target instanceof HTMLInputElement || (e.target instanceof HTMLTextAreaElement && e.target.id !== 'input')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault(); if (e.shiftKey ? canRedo : canUndo) moveHistory(e.shiftKey ? 'redo' : 'undo');
    }
  }}>
    <header><h1><a href="/" aria-label="aski studio"><img src="/brand/lockup.svg" alt="aski" /></a></h1><div className="header-actions"><SignIn /><button ref={copyButton} className="primary" onClick={() => void copy()} disabled={pending || !!error || !result?.text}>Copy text</button></div></header>
    <div className="studio" ref={studio}>
      <div className="controls">
        <section className="editor" ref={editor} aria-labelledby="input-title">
          <label id="input-title" htmlFor="input">Text</label>
          <div className="history-controls">
            <button onClick={() => moveHistory('undo')} disabled={!canUndo}>Undo</button>
            <button onClick={() => moveHistory('redo')} disabled={!canRedo}>Redo</button>
          </div>
          <textarea id="input" value={recipe.input} spellCheck={false} aria-describedby="input-limit" onChange={e => { setRecipe(previous => ({ ...previous, input: e.target.value })); }} />
          <small id="input-limit">Up to {MAX_INPUT} characters</small>
        </section>
        <div className="style-controls">
          {warning && <div className="warning" data-testid="draft-warning"><p>{warning}</p><button onClick={saveCurrent}>Save this draft</button></div>}
          <label htmlFor="font">Style</label>
          <select id="font" value={recipe.variantId} onChange={e => chooseVariant(e.target.value)}>
            {Array.from(new Set(variants.map(item => item.familyId))).map(family => <optgroup key={family} label={family.replace('figlet/', '')}>
              {variants.filter(item => item.familyId === family).map(item => <option key={item.variantId} value={item.variantId}>{item.name}</option>)}
            </optgroup>)}
          </select>
        </div>
        <SavedWork inputs={library.inputs} designs={library.designs} canSaveDesign={ready && !!recipe.input}
          onSaveInput={() => library.add<InputPayload>('input', { text: recipe.input, name: defaultName(recipe.input) })}
          onSaveDesign={saveDesign} artifacts={library.artifacts} onDownloadArtifact={downloadArtifact}
          onOpen={openSaved} onRename={library.rename} onDelete={library.remove} onCopy={copySaved} picker={picker} />
        <Favorites favorites={library.favorites} warning={library.warning} activeVariantId={recipe.variantId}
          onApply={applyFavorite} onRemove={library.removeFavorite} picker={picker} />
        <Collections records={library.records} collections={library.collections}
          onCreate={name => library.add<CollectionPayload>('collection', { name: parseName(name) })} onRename={library.rename} onDelete={library.remove}
          onOpen={item => { if (item.type === 'design') return openSaved(item as LibraryRecord<DesignPayload>); applyFavorite(item.payload as FavoritePayload); return ''; }}
          onRemoveMember={(collectionId, item) => library.toggleMembership(collectionId, item)} />
      </div>
      <div className="workspace">
        <section className="artwork" data-anchor="detail" aria-labelledby="output-title" aria-busy={pending}>
          <div className="output-heading"><h2 id="output-title">{font.name}</h2><span aria-label="Output dimensions">{result && !pending && !error ? `${result.columns} columns / ${result.rows} rows` : ''}</span></div>
          <pre tabIndex={0} aria-label="Rendered text art" data-testid="output" className="art" style={artColors}>
            {runs.map((run, index) => run.slot && run.slot !== 'foreground' ? <span key={index} className={`slot-${run.slot}`}>{run.text}</span> : run.text)}
          </pre>
          {font.blocks && <label className="toggle"><input type="checkbox" checked={recipe.layout.blocks}
            onChange={event => setRecipe(previous => ({ ...previous, layout: { ...previous.layout, blocks: event.target.checked } }))} />
            Seamless blocks <small>Draws block characters as solid shapes. Copied and downloaded text is unchanged.</small></label>}
          {font.blocks && recipe.layout.blocks && ready && <Seamless runs={runs} colors={recipe.colors} columns={result.columns} rows={result.rows} />}
          <div className="status" role="status">{error || (pending ? 'Rendering…' : copied ? 'Copied' : !recipe.input ? 'Type something.' : '')}</div>
          {error && !error.startsWith('Use ') && <button onClick={() => setRestart(value => value + 1)}>Try again</button>}
          {unsupported && !pending && !error && <p className="warning">Unsupported: {unsupported}</p>}
          <div className="exports" role="group" aria-label="Export">
            <button onClick={() => void copy('code')} disabled={!ready || !result.text}>Copy as code block</button>
            <button onClick={() => download('text')} disabled={!ready || !result.text}>Download text</button>
            <button onClick={() => download('ansi')} disabled={!ready || !result.text}>Download ANSI</button>
            <button onClick={() => void share()} disabled={!ready || !result.text}>Share link</button>
            {shareLink && <div className="share-link"><label htmlFor="share-link">Share link ({shareLink.length} characters)</label>
              <input id="share-link" readOnly value={shareLink} onFocus={event => event.target.select()} />
              <small>Anyone with this link sees this design’s text and settings. The design travels inside the link; nothing is stored on a server.</small></div>}
            <ImageExport columns={result?.columns || 0} rows={result?.rows || 0} blocks={recipe.layout.blocks && font.blocks} disabled={!ready || !result.text} onExport={exportImage}
              frame={recipe.animation.effect === 'none' ? '' : `frame ${inspected + 1}`} />
            <p className="hint">Plain text and code blocks keep every space and line break but no colors or animation. ANSI keeps colors for terminals that support 24-bit color.</p>
          </div>
          {shareNotice && <p className="warning" data-testid="share-notice">{shareNotice}</p>}
          {openedDiffers && <p className="warning" data-testid="snapshot-differs">This style now renders differently from the saved design. Copy saved text keeps the original.</p>}
        </section>
        <Colors slots={font.slots as Slot[]} colors={recipe.colors} palettes={library.palettes}
          onChange={colors => setRecipe(previous => ({ ...previous, colors }))}
          onSavePalette={name => library.add<PalettePayload>('palette', { name, slots: { ...recipe.colors } })} onDeletePalette={library.remove} />
        <LayoutControls layout={recipe.layout} fontName={font.name} fontDefault={font.spacing.default} canSmush={font.spacing.smush}
          onChange={layout => setRecipe(previous => ({ ...previous, layout }))} />
        <AnimationPanel animation={recipe.animation} model={ready ? result : null} font={font} colors={recipe.colors} blocks={recipe.layout.blocks && font.blocks}
          fileName={exportName(`${font.name} ${recipe.input}`, 'gif')} onInspect={setInspected}
          onChange={animation => setRecipe(previous => ({ ...previous, animation }))} />
        <Gallery input={recipe.input} activeFamilyId={recipe.familyId} variantFor={variantFor} expanded={expanded}
          onVariant={(family, variantId) => { setChosenVariants(previous => ({ ...previous, [family.familyId]: variantId })); if (family.familyId === recipe.familyId) chooseVariant(variantId); }}
          onUse={family => { if (family.familyId !== recipe.familyId) chooseVariant(variantFor(family)); }}
          pins={pins} onPin={variantId => setPins(previous => previous.includes(variantId) ? previous.filter(item => item !== variantId) : [...previous, variantId])}
          onUseVariant={chooseVariant}
          isFavorite={(familyId, variantId) => library.isFavorite({ familyId, variantId })}
          onFavorite={(familyId, variantId) => library.toggleFavorite({ familyId, variantId })}
          onToggle={family => setExpanded(previous => { const next = new Set(previous); if (!next.delete(family.familyId)) next.add(family.familyId); return next; })} />
      </div>
    </div>
    <footer><a href={font.noticePath}>{font.name} · {font.license} notice</a><span>Type: <a href="/brand/fonts/fraunces-OFL.txt">Fraunces</a> · <a href="/brand/fonts/atkinsonhyperlegiblenext-OFL.txt">Atkinson</a></span></footer>
    <dialog ref={dialog} aria-labelledby="copy-title" onClose={() => { setManual(false); copyButton.current?.focus(); }}>
      <h2 id="copy-title">Copy text</h2><p>Select and copy the text.</p>
      <textarea ref={manualText} aria-label="Text to copy" value={manualValue} readOnly />
      <button onClick={() => dialog.current?.close()}>Done</button>
    </dialog>
  </main>;
}
