import { useState } from 'react';
import { getFamily, getVariant } from '../shared/catalog.ts';
import { MAX_NAME, membersOf } from '../shared/library.ts';
import type { CollectionPayload, DesignPayload, FavoritePayload, LibraryRecord } from '../shared/library.ts';
type Member = LibraryRecord<FavoritePayload | DesignPayload>;
export const memberName = (record: Member) => record.type === 'design' ? (record.payload as DesignPayload).name
  : (record.payload as FavoritePayload).variantId ? getVariant((record.payload as FavoritePayload).variantId!).name : getFamily((record.payload as FavoritePayload).familyId).name;
// Checkbox list for one style or design; each box is one membership.
export function CollectionPicker({ item, collections, isMember, onToggle }: {
  item: Member; collections: LibraryRecord<CollectionPayload>[]; isMember: (collectionId: string) => boolean; onToggle: (collectionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = collections.filter(collection => isMember(collection.id)).length;
  return <div className="picker">
    <button aria-expanded={open} aria-controls={`picker-${item.id}`} onClick={() => setOpen(value => !value)}>Collections{count ? ` (${count})` : ''}</button>
    {open && <fieldset id={`picker-${item.id}`}>
      <legend>Collections for {memberName(item)}</legend>
      {collections.length ? collections.map(collection => <label key={collection.id}>
        <input type="checkbox" checked={isMember(collection.id)} onChange={() => onToggle(collection.id)} /> {collection.payload.name}
      </label>) : <p className="hint">Create a collection first.</p>}
    </fieldset>}
  </div>;
}
interface CollectionsProps {
  records: LibraryRecord[]; collections: LibraryRecord<CollectionPayload>[];
  onCreate: (name: string) => void; onRename: (record: LibraryRecord<CollectionPayload>, name: string) => void;
  onDelete: (record: LibraryRecord<CollectionPayload>) => void; onOpen: (item: Member) => string; onRemoveMember: (collectionId: string, item: Member) => void;
}
export function Collections({ records, collections, onCreate, onRename, onDelete, onOpen, onRemoveMember }: CollectionsProps) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [renaming, setRenaming] = useState('');
  const [draftName, setDraftName] = useState('');
  const [deleting, setDeleting] = useState('');
  function attempt(action: () => void) { try { action(); setMessage(''); return true; } catch (error) { setMessage((error as Error).message); return false; } }
  return <section className="collections" aria-labelledby="collections-title">
    <h2 id="collections-title">Collections</h2>
    <form className="new-collection" onSubmit={event => { event.preventDefault(); if (attempt(() => onCreate(name))) setName(''); }}>
      <label htmlFor="collection-name">New collection</label>
      <input id="collection-name" value={name} maxLength={MAX_NAME} onChange={event => setName(event.target.value)} />
      <button type="submit">Create collection</button>
    </form>
    {message && <p className="item-note" data-testid="collection-note">{message}</p>}
    {!collections.length && <p className="hint">Group favorite styles and saved designs. Items can be in several collections.</p>}
    <ul className="saved-list" aria-label="Collections">
      {collections.map(collection => {
        const members = membersOf(records, collection.id);
        return <li key={collection.id} aria-label={`Collection ${collection.payload.name}`}>
          {renaming === collection.id
            ? <form onSubmit={event => { event.preventDefault(); if (attempt(() => onRename(collection, draftName))) setRenaming(''); }}>
              <label htmlFor={`rename-${collection.id}`}>Name</label>
              <input id={`rename-${collection.id}`} value={draftName} maxLength={MAX_NAME} autoFocus onChange={event => setDraftName(event.target.value)}
                onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setRenaming(''); } }} />
              <div className="item-actions"><button type="submit">Save name</button><button type="button" onClick={() => setRenaming('')}>Cancel</button></div>
            </form>
            : <h3>{collection.payload.name} <small>{members.length} {members.length === 1 ? 'item' : 'items'}</small></h3>}
          {members.length > 0 && <ul className="members" aria-label={`Items in ${collection.payload.name}`}>
            {members.map(item => <li key={item.id} data-kind={item.type}>
              <span className="kind">{item.type === 'design' ? 'Design' : 'Style'}</span>
              <button className="open" onClick={() => setMessage(onOpen(item))}>{memberName(item)}</button>
              <button className="remove" aria-label={`Remove ${memberName(item)} from ${collection.payload.name}`} onClick={() => onRemoveMember(collection.id, item)}>×</button>
            </li>)}
          </ul>}
          {renaming !== collection.id && (deleting === collection.id
            ? <div className="item-actions"><button onClick={() => { setDeleting(''); onDelete(collection); }}>Confirm delete</button><button onClick={() => setDeleting('')}>Cancel</button></div>
            : <div className="item-actions">
              <button onClick={() => { setRenaming(collection.id); setDraftName(collection.payload.name); setDeleting(''); }}>Rename</button>
              <button onClick={() => { setDeleting(collection.id); setRenaming(''); }}>Delete</button>
            </div>)}
          {deleting === collection.id && <p className="hint">Deleting a collection keeps its styles and designs.</p>}
        </li>;
      })}
    </ul>
  </section>;
}
