import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ArtifactMeta, DesignPayload, InputPayload, LibraryRecord } from '../shared/library.ts';
import { MAX_NAME } from '../shared/library.ts';
type Item = LibraryRecord<InputPayload | DesignPayload>;
interface SavedWorkProps {
  inputs: LibraryRecord<InputPayload>[]; designs: LibraryRecord<DesignPayload>[]; canSaveInput: boolean; canSaveDesign: boolean;
  onSaveInput: () => void; onSaveDesign: (keep: { png: boolean; svg: boolean }) => Promise<string>;
  artifacts: ArtifactMeta[]; onDownloadArtifact: (meta: ArtifactMeta) => Promise<string>;
  onOpen: (record: Item) => string; onRename: (record: Item, name: string) => void;
  onDelete: (record: Item) => void; onCopy: (text: string) => Promise<boolean>;
  picker: (record: LibraryRecord<DesignPayload>) => ReactNode; account: boolean;
}
// Saved text is reusable with any style; a saved design reopens its own recipe and keeps the exact text
// it produced when saved.
export function SavedWork({ account, inputs, designs, canSaveInput, canSaveDesign, onSaveInput, onSaveDesign, onOpen, onRename, onDelete, onCopy, picker, artifacts, onDownloadArtifact }: SavedWorkProps) {
  const [renaming, setRenaming] = useState('');
  const [draftName, setDraftName] = useState('');
  const [deleting, setDeleting] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [keep, setKeep] = useState({ png: false, svg: false });
  const [saveNote, setSaveNote] = useState('');
  const note = (id: string, text: string) => setNotes(previous => ({ ...previous, [id]: text }));
  // Rename and Delete swap their buttons; focus follows to the button that takes the used one's place, and
  // to the section heading once an item is deleted.
  const [refocus, setRefocus] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  function item(record: Item, kind: string) {
    const design = record.type === 'design' ? record.payload as DesignPayload : null;
    return <li key={record.id} aria-label={`${kind} ${record.payload.name}`}>
      {renaming === record.id
        ? <form onSubmit={event => {
          event.preventDefault();
          try { onRename(record, draftName); setRenaming(''); setRefocus(`${record.id}:rename`); note(record.id, ''); } catch (error) { note(record.id, (error as Error).message); }
        }}>
          <label htmlFor={`name-${record.id}`}>Name</label>
          <input id={`name-${record.id}`} value={draftName} maxLength={MAX_NAME} autoFocus onChange={event => setDraftName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(''); setRefocus(`${record.id}:rename`); } }} />
          <div className="item-actions"><button type="submit">Save name</button><button type="button" onClick={() => { setRenaming(''); setRefocus(`${record.id}:rename`); }}>Cancel</button></div>
        </form>
        : <button className="open" onClick={() => note(record.id, onOpen(record))}>{record.payload.name}</button>}
      {design && <small>{design.snapshot.columns} columns / {design.snapshot.rows} rows</small>}
      {renaming !== record.id && (deleting === record.id
        ? <div className="item-actions"><button autoFocus onClick={() => { setDeleting(''); onDelete(record); heading.current?.focus(); }}>Confirm delete</button><button onClick={() => { setDeleting(''); setRefocus(`${record.id}:delete`); }}>Cancel</button></div>
        : <div className="item-actions">
          {design && <button onClick={() => void onCopy(design.snapshot.text).then(ok => note(record.id, ok ? 'Copied saved text' : ''))}>Copy saved text</button>}
          <button autoFocus={refocus === `${record.id}:rename`} onClick={() => { setRenaming(record.id); setDraftName(record.payload.name); setDeleting(''); }}>Rename</button>
          <button autoFocus={refocus === `${record.id}:delete`} onClick={() => { setDeleting(record.id); setRenaming(''); }}>Delete</button>
        </div>)}
      {design?.artifacts?.length ? <ul className="artifacts" aria-label={`Original files for ${record.payload.name}`}>
        {design.artifacts.map(id => artifacts.find(item => item.id === id)).filter(item => !!item).map(meta => <li key={meta.id}>
          <span>Original {meta.mime === 'image/gif' ? 'GIF' : meta.mime === 'image/png' ? 'PNG' : 'SVG'} · {meta.width} × {meta.height} · {(meta.byteLength / 1024).toFixed(1)} KB</span>
          <button onClick={() => void onDownloadArtifact(meta).then(message => note(record.id, message))}>Download original</button>
        </li>)}
      </ul> : null}
      {design && renaming !== record.id && picker(record as LibraryRecord<DesignPayload>)}
      {notes[record.id] && <p className="item-note" data-testid="saved-note">{notes[record.id]}</p>}
    </li>;
  }
  return <section className="saved-work" data-anchor="saved" aria-labelledby="saved-title">
    <h2 id="saved-title" ref={heading} tabIndex={-1}>Saved work</h2>
    <div className="item-actions">
      <button onClick={onSaveInput} disabled={!canSaveInput}>Save text</button>
      <button onClick={() => void onSaveDesign(keep).then(setSaveNote, () => setSaveNote('Could not save this design. Your draft is unchanged.'))} disabled={!canSaveDesign}>Save design</button>
    </div>
    <fieldset className="keep"><legend>With a saved design, also keep</legend>
      <label><input type="checkbox" checked={keep.png} onChange={event => setKeep({ ...keep, png: event.target.checked })} />PNG</label>
      <label><input type="checkbox" checked={keep.svg} onChange={event => setKeep({ ...keep, svg: event.target.checked })} />SVG</label>
    </fieldset>
    {saveNote && <p className="item-note" role="alert">{saveNote}</p>}
    <p className="hint">{account ? 'Text keeps your words for any style. A design keeps its style and the exact output, plus any image files you choose, exactly as exported. All of it is saved to your account.'
      : 'Text keeps your words for any style. A design keeps its style and the exact output, plus any image files you choose, exactly as exported. Everything stays in this browser.'}</p>
    <h3>Text</h3>
    {inputs.length ? <ul className="saved-list" aria-label="Saved text">{inputs.map(record => item(record, 'Text'))}</ul> : <p className="hint">No saved text yet.</p>}
    <h3>Designs</h3>
    {designs.length ? <ul className="saved-list" aria-label="Saved designs">{designs.map(record => item(record, 'Design'))}</ul> : <p className="hint">No saved designs yet.</p>}
  </section>;
}
