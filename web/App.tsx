import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { colorize } from '../shared/color.ts';
import { exportName, toAnsi, toCodeBlock } from '../shared/export.ts';
import { frameDataAt, frameTime } from '../shared/animation.ts';
import { decodeShare, encodeShare } from '../shared/share.ts';
import { MAX_INPUT, characterCount, parseRecipe } from '../shared/recipe.ts';
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
import { useAccount } from './useAccount.ts';
import { useAccountLibrary } from './useAccountLibrary.ts';
import { Import } from './Import.tsx';
import { WaitingChanges } from './WaitingChanges.tsx';
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
import { Icon } from './Icon.tsx';
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
  const [sharedSize, setSharedSize] = useState<{ columns: number; rows: number; key: string } | null>(null);
  const [opened, setOpened] = useState<{ recipe: string; snapshot: string } | null>(null);
  const [restart, setRestart] = useState(0);
  const worker = useRef<Worker | null>(null);
  const latestJob = useRef(0);
  // The render key each result was made from, so checks can tell a fresh result from the previous one.
  const jobKey = useRef('');
  const [resultKey, setResultKey] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const manualText = useRef<HTMLTextAreaElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const studio = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLElement>(null);
  const [chosenVariants, setChosenVariants] = useState<Record<string, string>>({});
  const { account, signedOut } = useAccount();
  const browserLibrary = useLibrary();
  // Offline, the account's copy in this browser stays usable and its changes wait to be sent.
  const hasAccount = account.status === 'signed-in' || account.status === 'offline';
  const accountLibrary = useAccountLibrary(hasAccount ? account.subject : null, account.email, account.status === 'signed-in', signedOut);
  // Signed in, the account library is shown unless the visitor picks this browser's library. Neither
  // is copied into the other.
  const [browserOnly, setBrowserOnly] = useState(false);
  const library = hasAccount && !browserOnly ? accountLibrary : browserLibrary;
  const waiting = accountLibrary.waiting === 1 ? '1 change' : `${accountLibrary.waiting} changes`;
  const syncText = accountLibrary.loading ? 'Loading your account library…'
    : accountLibrary.status === 'offline' ? (accountLibrary.waiting ? `Offline. ${waiting} kept in this browser and sent when your account can be reached.` : 'Offline. Showing the copy of your account library kept in this browser; changes are sent when your account can be reached.')
      : accountLibrary.waiting ? `Sending ${waiting} to your account. ${accountLibrary.waiting === 1 ? 'It is' : 'They are'} kept in this browser until then.`
        : 'All changes are saved to your account and available wherever you sign in. Work saved in this browser stays here and is not uploaded.';
  const inAccount = library.kind === 'account';
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // The library and the customize panels stay closed until asked for, so the page leads with type, browse, copy.
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const libraryToggle = useRef<HTMLButtonElement>(null);
  const libraryPanel = useRef<HTMLElement>(null);
  const libraryClose = useRef<HTMLButtonElement>(null);
  const footer = useRef<HTMLElement>(null);
  // The small Copy bar appears while the result's Copy text button is out of sight, including when it sits
  // under the sticky text field. The observer is rebuilt whenever the field changes height.
  const [copyInView, setCopyInView] = useState(true);
  useEffect(() => {
    const target = copyButton.current, field = editor.current;
    if (!target || !field || typeof IntersectionObserver === 'undefined') return;
    let observer: IntersectionObserver | null = null, top = -1;
    const watch = () => {
      const height = Math.round(field.getBoundingClientRect().height);
      if (height === top) return;
      top = height; observer?.disconnect();
      observer = new IntersectionObserver(([entry]) => setCopyInView(entry.isIntersecting), { rootMargin: `-${height}px 0px 0px 0px`, threshold: 1 });
      observer.observe(target);
    };
    watch();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(watch);
    resize?.observe(field);
    return () => { observer?.disconnect(); resize?.disconnect(); };
  }, []);
  const [panel, setPanel] = useState<'' | 'colors' | 'layout' | 'animation'>('colors');
  // The editor sticks to the top, so content behind it is not in view.
  const inset = useCallback(() => {
    const box = editor.current?.getBoundingClientRect();
    return box && box.top <= 1 ? box.bottom : 0;
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
      setError(''); setResult(event.data.result); setResultKey(jobKey.current);
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
    jobKey.current = renderKey;
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
  const inputLength = characterCount(recipe.input);
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
        setRecipe(() => shared); setSharedSize({ ...size, key: JSON.stringify([shared.input, shared.variantId, shared.layout.spacing, shared.layout.width, shared.layout.align, shared.animation.effect === 'typewriter']) });
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
    if (!sharedSize || !ready || resultKey !== sharedSize.key) return;
    if (sharedSize.columns !== result.columns || sharedSize.rows !== result.rows)
      setShareNotice(`Opened a shared design. This version renders it at ${result.columns} × ${result.rows} instead of ${sharedSize.columns} × ${sharedSize.rows}. Undo returns to your previous draft.`);
    setSharedSize(null);
  }, [sharedSize, ready, result, resultKey]);
  // Saves the recipe and text snapshot, plus any chosen image files rendered right now with the default
  // image settings. The files are stored as bytes and never regenerated.
  const savingDesign = useRef(false);
  async function saveDesign(keep: { png: boolean; svg: boolean }) {
    if (!result || pending || error || savingDesign.current) return '';
    savingDesign.current = true;
    try { return await saveDesignNow(keep, result); } finally { savingDesign.current = false; }
  }
  async function saveDesignNow(keep: { png: boolean; svg: boolean }, result: RenderResult) {
    const size = { columns: result.columns, rows: result.rows };
    const options = { ...DEFAULT_IMAGE, blocks: recipe.layout.blocks && font.blocks };
    let width = 0, height = 0, tooLarge = false;
    if (keep.png || keep.svg) try { ({ width, height } = imageSize(size.columns, size.rows, options)); } catch { tooLarge = true; }
    const provenance = { variantId: font.variantId, fontSha256: font.sha256, rendererVersion: recipe.rendererVersion };
    const files = [], missing: string[] = [];
    // Each format is made separately; one that cannot be drawn is reported and the design still saves.
    if (tooLarge) missing.push(...[keep.png && 'PNG', keep.svg && 'SVG'].filter((format): format is string => !!format));
    else if (keep.png) try { files.push({ mime: 'image/png' as const, bytes: new Uint8Array(await (await toPng(runs, recipe.colors, size, options)).arrayBuffer()), width, height, provenance }); } catch { missing.push('PNG'); }
    if (!tooLarge && keep.svg) try { files.push({ mime: 'image/svg+xml' as const, bytes: new TextEncoder().encode(toSvg(runs, recipe.colors, size, options)), width, height, provenance }); } catch { missing.push('SVG'); }
    const stored = await library.addDesign({ name: defaultName(recipe.input, font.name), recipe: { ...recipe, id: crypto.randomUUID() }, snapshot: { text: result.text, ...size } }, files);
    return stored || (missing.length ? `The design is saved, but its ${missing.join(' and ')} could not be made at this size.` : '');
  }
  // The GIF was encoded from this recipe; it is stored as-is with the design and its animation settings.
  async function saveDesignWithGif(gif: { bytes: Uint8Array; width: number; height: number }) {
    if (!result || pending || error) return 'The artwork changed; create the GIF again before saving.';
    return library.addDesign({ name: defaultName(recipe.input, font.name), recipe: { ...recipe, id: crypto.randomUUID() }, snapshot: { text: result.text, columns: result.columns, rows: result.rows } },
      [{ mime: 'image/gif', bytes: gif.bytes, width: gif.width, height: gif.height, provenance: { variantId: font.variantId, fontSha256: font.sha256, rendererVersion: recipe.rendererVersion } }]);
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
  // After a keyboard undo or redo in the text field the caret goes to the end of the change, as a native undo
  // would; after the Undo or Redo button empties its own history and hides, focus moves to the other one.
  const inputField = useRef<HTMLTextAreaElement>(null);
  const caretAfter = useRef<string | null>(null);
  const focusAfter = useRef<'undo' | 'redo' | null>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const redoButton = useRef<HTMLButtonElement>(null);
  function moveHistory(direction: 'undo' | 'redo', from: 'field' | 'button' | 'other' = 'other') {
    if (from === 'field') caretAfter.current = recipe.input;
    if (from === 'button') focusAfter.current = direction;
    if (direction === 'undo') undo(); else redo();
  }
  useLayoutEffect(() => {
    const before = caretAfter.current, field = inputField.current;
    caretAfter.current = null;
    if (before === null || !field || document.activeElement !== field) return;
    const after = recipe.input;
    let end = 0;
    while (end < before.length && end < after.length && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
    field.setSelectionRange(after.length - end, after.length - end);
  }, [recipe.input]);
  useLayoutEffect(() => {
    const direction = focusAfter.current;
    focusAfter.current = null;
    if (!direction) return;
    const used = direction === 'undo' ? undoButton.current : redoButton.current;
    const other = direction === 'undo' ? redoButton.current : undoButton.current;
    if (used && !used.disabled) used.focus();
    else if (other && !other.disabled) other.focus();
    else inputField.current?.focus();
  }, [canUndo, canRedo]);
  const historyState = useRef({ canUndo, canRedo, moveHistory });
  historyState.current = { canUndo, canRedo, moveHistory };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement;
      const textEntry = target instanceof HTMLTextAreaElement ? target.id !== 'input'
        : target instanceof HTMLInputElement ? !['radio', 'checkbox', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type)
          : target.isContentEditable;
      if (textEntry || target.closest?.('dialog[open]')) return;
      event.preventDefault();
      const { canUndo, canRedo, moveHistory } = historyState.current;
      if (event.shiftKey ? canRedo : canUndo) moveHistory(event.shiftKey ? 'redo' : 'undo', target.id === 'input' ? 'field' : 'other');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Menus (the Download menu and each card's "more" menu) and the Library close on Escape, on a click or tap
  // outside them, and when focus moves elsewhere. A menu also closes once one of its buttons is used.
  const libraryState = useRef(libraryOpen);
  libraryState.current = libraryOpen;
  // Focus goes back to the Library button once the page behind the drawer is usable again.
  const libraryReturn = useRef(false);
  const closeLibrary = useCallback((returnFocus: boolean) => {
    libraryReturn.current = returnFocus;
    setLibraryOpen(false);
  }, []);
  useEffect(() => {
    const openMenus = () => Array.from(document.querySelectorAll<HTMLDetailsElement>('details.menu[open]'));
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      const menus = openMenus();
      if (menus.length) {
        const holder = menus.find(menu => menu.contains(document.activeElement));
        menus.forEach(menu => { menu.open = false; });
        holder?.querySelector('summary')?.focus();
        event.preventDefault();
        return;
      }
      if (libraryState.current) { event.preventDefault(); closeLibrary(!!libraryPanel.current?.contains(document.activeElement) || document.activeElement === document.body); }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      openMenus().forEach(menu => { if (!menu.contains(target)) menu.open = false; });
      if (libraryState.current && !libraryPanel.current?.contains(target) && !libraryToggle.current?.contains(target)) closeLibrary(false);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      openMenus().forEach(menu => { if (!menu.contains(target)) menu.open = false; });
    };
    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest?.('.menu > .exports button');
      const menu = button?.closest('details.menu') as HTMLDetailsElement | null;
      if (menu?.open) { menu.open = false; if (menu.contains(document.activeElement)) menu.querySelector('summary')?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('focusin', onFocus); document.removeEventListener('click', onClick);
    };
  }, [closeLibrary]);
  // The Library takes focus when it opens. On a phone it covers the page, so the page behind it is inert.
  useEffect(() => {
    if (!libraryOpen) return;
    libraryClose.current?.focus();
    const narrow = matchMedia('(max-width: 760px)').matches;
    const behind = [studio.current, footer.current, document.querySelector('main > header')].filter(Boolean) as HTMLElement[];
    if (narrow) behind.forEach(element => { element.inert = true; });
    return () => {
      behind.forEach(element => { element.inert = false; });
      if (libraryReturn.current) { libraryReturn.current = false; libraryToggle.current?.focus(); }
    };
  }, [libraryOpen]);
  // Opening a saved item, a favorite or a collection entry closes the Library so the result is in view.
  const openFromLibrary = (open: () => string) => { const note = open(); if (!note) closeLibrary(false); return note; };
  return <main>
    <header>
      <h1><a href="/" aria-label="aski studio"><img src="/brand/lockup.svg" alt="aski" /></a></h1>
      <div className="header-actions">
        <button ref={libraryToggle} className="quiet" aria-expanded={libraryOpen} aria-controls="library" onClick={() => setLibraryOpen(value => !value)}>Library</button>
        <SignIn account={account} onSignedOut={signedOut} />
      </div>
    </header>
    <aside id="library" ref={libraryPanel} className="library" aria-labelledby="library-title" hidden={!libraryOpen}>
      <div className="library-heading"><h2 id="library-title">Library</h2><button ref={libraryClose} className="quiet" onClick={() => closeLibrary(true)}>Close</button></div>
      {hasAccount && <fieldset className="library-source">
        <legend>Library</legend>
        <label><input type="radio" name="library-source" checked={!browserOnly} onChange={() => setBrowserOnly(false)} />Account</label>
        <label><input type="radio" name="library-source" checked={browserOnly} onChange={() => setBrowserOnly(true)} />This browser</label>
        <small role="status" data-testid="sync-status">{inAccount ? syncText : 'Saved in this browser only. Nothing here is uploaded to your account.'}</small>
      </fieldset>}
      {account.status === 'signed-in' && inAccount && <Import subject={account.subject} local={browserLibrary.records} remote={accountLibrary.records}
        loading={accountLibrary.loading} send={accountLibrary.send} reload={accountLibrary.reload} />}
      {account.status !== 'checking' && <WaitingChanges current={hasAccount ? account.subject : ''} onCopied={browserLibrary.reread} />}
      <SavedWork account={inAccount} inputs={library.inputs} designs={library.designs} canSaveInput={!!recipe.input} canSaveDesign={ready && !!recipe.input}
        onSaveInput={() => library.add<InputPayload>('input', { text: recipe.input, name: defaultName(recipe.input) })}
        onSaveDesign={saveDesign} artifacts={library.artifacts} onDownloadArtifact={downloadArtifact}
        onOpen={record => openFromLibrary(() => openSaved(record))} onRename={library.rename} onDelete={library.remove} onCopy={copySaved} picker={picker} />
      <Favorites account={inAccount} favorites={library.favorites} warning={library.warning} activeVariantId={recipe.variantId}
        onApply={favorite => { applyFavorite(favorite); closeLibrary(false); }} onRemove={library.removeFavorite} picker={picker} />
      <Collections records={library.records} collections={library.collections}
        onCreate={name => library.add<CollectionPayload>('collection', { name: parseName(name) })} onRename={library.rename} onDelete={library.remove}
        onOpen={item => openFromLibrary(() => { if (item.type === 'design') return openSaved(item as LibraryRecord<DesignPayload>); applyFavorite(item.payload as FavoritePayload); return ''; })}
        onRemoveMember={(collectionId, item) => library.toggleMembership(collectionId, item)} />
    </aside>
    <div className="studio" ref={studio}>
      <section className="editor" ref={editor} aria-labelledby="input-title">
        <label id="input-title" htmlFor="input" className="visually-hidden">Text</label>
        <div className="input-wrap">
        <textarea ref={inputField} id="input" rows={2} value={recipe.input} spellCheck={false} aria-describedby="input-limit" placeholder="Type something"
          onChange={e => { setRecipe(previous => ({ ...previous, input: e.target.value })); }} />
        <div className="history-controls">
          <button ref={undoButton} onClick={() => moveHistory('undo', 'button')} disabled={!canUndo}>Undo</button>
          <button ref={redoButton} onClick={() => moveHistory('redo', 'button')} disabled={!canRedo}>Redo</button>
        </div>
        </div>
        {/* The limit is shown once the text nears it; screen readers always have it. */}
        <small id="input-limit" className={inputLength < MAX_INPUT * 0.9 ? 'visually-hidden' : undefined}>{inputLength} of {MAX_INPUT} characters</small>
        {warning && <div className="warning" data-testid="draft-warning"><p>{warning}</p><button onClick={saveCurrent}>Save this draft</button></div>}
      </section>
      <section className="artwork" data-anchor="detail" aria-labelledby="output-title" aria-busy={pending}>
        <div className="output-heading">
          <h2 id="output-title" className="visually-hidden">{font.name}</h2>
          <label htmlFor="font" className="visually-hidden">Style</label>
          <span className="select-wrap">
            <select id="font" value={recipe.variantId} onChange={e => chooseVariant(e.target.value)}>
              {Array.from(new Set(variants.map(item => item.familyId))).map(family => <optgroup key={family} label={family.replace('figlet/', '')}>
                {variants.filter(item => item.familyId === family).map(item => <option key={item.variantId} value={item.variantId}>{item.name}</option>)}
              </optgroup>)}
            </select>
            <Icon name="chevron" />
          </span>
          <div className="output-actions">
            <button ref={copyButton} className="primary" onClick={() => void copy()} disabled={pending || !!error || !result?.text}><Icon name="copy" />Copy text</button>
            <button className="secondary" aria-expanded={customizing} aria-controls="customize" onClick={() => setCustomizing(value => !value)}>Customize<Icon name="chevron" /></button>
            <details className="menu">
              <summary>Download<Icon name="chevron" /></summary>
              <div className="exports" role="group" aria-label="Export">
                <p className="hint" aria-label="Output dimensions">{result && !pending && !error ? `${result.columns} columns × ${result.rows} rows` : ''}</p>
                <button onClick={() => void copy('code')} disabled={!ready || !result.text}>Copy as code block</button>
                <button onClick={() => download('text')} disabled={!ready || !result.text}>Download text</button>
                <button onClick={() => download('ansi')} disabled={!ready || !result.text}>Download ANSI</button>
                <ImageExport columns={result?.columns || 0} rows={result?.rows || 0} blocks={recipe.layout.blocks && font.blocks} disabled={!ready || !result.text} onExport={exportImage}
                  frame={recipe.animation.effect === 'none' ? '' : `frame ${inspected + 1}`} />
                <p className="hint">Text and code blocks keep every space and line break but no colors. ANSI keeps colors for terminals with 24-bit color.</p>
                <button onClick={() => void share()} disabled={!ready || !result.text}>Share link</button>
              </div>
            </details>
          </div>
        </div>
        <pre tabIndex={0} role="img" aria-label={`Text art in ${font.name}`} data-testid="output" className="art" style={{ ...artColors, '--cols': result?.columns || 1 } as CSSProperties}>
          <span className="art-body">{runs.map((run, index) => run.slot && run.slot !== 'foreground' ? <span key={index} className={`slot-${run.slot}`}>{run.text}</span> : run.text)}</span>
        </pre>
        {font.blocks && recipe.layout.blocks && ready && <Seamless runs={runs} colors={recipe.colors} columns={result.columns} rows={result.rows} />}
        <div className="status" role="status">{error || (pending ? 'Rendering…' : copied ? 'Copied' : !recipe.input ? 'Type something.' : '')}</div>
        {error && !error.startsWith('Use ') && <button className="retry" onClick={() => setRestart(value => value + 1)}>Try again</button>}
        {unsupported && !pending && !error && <p className="warning" aria-live="polite">Unsupported: {unsupported}</p>}
        {shareLink && <div className="share-link"><label htmlFor="share-link">Share link ({shareLink.length} characters)</label>
          <input id="share-link" readOnly value={shareLink} onFocus={event => event.target.select()} />
          <small>Anyone with this link sees this design’s text and settings. The design travels inside the link; nothing is stored on a server.</small></div>}
        {shareNotice && <p className="warning" data-testid="share-notice" aria-live="polite">{shareNotice}</p>}
        {openedDiffers && <p className="warning" data-testid="snapshot-differs">This style now renders differently from the saved design. Copy saved text keeps the original.</p>}
        <div id="customize" className="customize" role="group" aria-label="Customize" hidden={!customizing}>
          {(['colors', 'layout', 'animation'] as const).map(name => <button key={name} aria-expanded={panel === name} aria-controls={`panel-${name}`}
            onClick={() => setPanel(name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}
        </div>
        <div id="panel-colors" className="panel" hidden={!customizing || panel !== 'colors'}>
          <Colors slots={font.slots as Slot[]} colors={recipe.colors} palettes={library.palettes}
            onChange={colors => setRecipe(previous => ({ ...previous, colors }))}
            onSavePalette={name => library.add<PalettePayload>('palette', { name, slots: { ...recipe.colors } })} onDeletePalette={library.remove} />
        </div>
        <div id="panel-layout" className="panel" hidden={!customizing || panel !== 'layout'}>
          <LayoutControls layout={recipe.layout} fontName={font.name} fontDefault={font.spacing.default} canSmush={font.spacing.smush}
            onChange={layout => setRecipe(previous => ({ ...previous, layout }))} />
          {font.blocks && <label className="toggle"><input type="checkbox" checked={recipe.layout.blocks}
            onChange={event => setRecipe(previous => ({ ...previous, layout: { ...previous.layout, blocks: event.target.checked } }))} />
            Seamless blocks <small>Draws block characters as solid shapes. Copied and downloaded text is unchanged.</small></label>}
        </div>
        <div id="panel-animation" className="panel" hidden={!customizing || panel !== 'animation'}>
          <AnimationPanel animation={recipe.animation} model={ready ? result : null} font={font} colors={recipe.colors} blocks={recipe.layout.blocks && font.blocks}
            fileName={exportName(`${font.name} ${recipe.input}`, 'gif')} onInspect={setInspected} onSaveGif={saveDesignWithGif}
            onChange={animation => setRecipe(previous => ({ ...previous, animation }))} />
        </div>
      </section>
      <Gallery input={recipe.input} activeFamilyId={recipe.familyId} variantFor={variantFor} expanded={expanded}
        onVariant={(family, variantId) => { setChosenVariants(previous => ({ ...previous, [family.familyId]: variantId })); if (family.familyId === recipe.familyId) chooseVariant(variantId); }}
        onUse={family => { if (family.familyId !== recipe.familyId) chooseVariant(variantFor(family)); }}
        pins={pins} onPin={variantId => setPins(previous => previous.includes(variantId) ? previous.filter(item => item !== variantId) : [...previous, variantId])}
        onUseVariant={chooseVariant}
        isFavorite={(familyId, variantId) => library.isFavorite({ familyId, variantId })}
        onFavorite={(familyId, variantId) => library.toggleFavorite({ familyId, variantId })}
        onToggle={family => setExpanded(previous => { const next = new Set(previous); if (!next.delete(family.familyId)) next.add(family.familyId); return next; })} />
      {/* Once the result scrolls away, a small bar keeps the chosen style and Copy within reach. */}
      <div className="copy-bar" hidden={copyInView} aria-hidden={copyInView}>
        <span>{font.name}</span>
        <button className="primary" onClick={() => void copy()} disabled={pending || !!error || !result?.text} tabIndex={copyInView ? -1 : undefined}><Icon name="copy" />{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
    <footer ref={footer}><a href={font.noticePath}>{font.name} license</a><a href="/about/">About and credits</a></footer>
    <dialog ref={dialog} aria-labelledby="copy-title" onClose={() => { setManual(false); copyButton.current?.focus(); }}>
      <h2 id="copy-title">Copy text</h2><p>Select and copy the text.</p>
      <textarea ref={manualText} aria-label="Text to copy" value={manualValue} readOnly />
      <button onClick={() => dialog.current?.close()}>Done</button>
    </dialog>
  </main>;
}
