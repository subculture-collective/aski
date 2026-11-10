import { useEffect, useState } from 'react';
import { cascade, createRecord, findFavorite, findMembership, parseName } from '../shared/library.ts';
import type { PalettePayload, CollectionPayload, DesignPayload, FavoritePayload, InputPayload, LibraryRecord, MembershipPayload, RecordType } from '../shared/library.ts';
import { deleteRecords, loadLibrary, putRecord } from './libraryStore.ts';
const UNAVAILABLE = 'This browser cannot save your library. Saved items last until you close this page.';
export function useLibrary() {
  const [records, setRecords] = useState<LibraryRecord[]>([]);
  const [warning, setWarning] = useState('');
  useEffect(() => {
    let current = true;
    loadLibrary().then(({ records: loaded, unreadable }) => {
      if (!current) return;
      setRecords(previous => [...loaded, ...previous.filter(item => !loaded.some(record => record.id === item.id))]);
      if (unreadable) setWarning(`${unreadable} saved ${unreadable === 1 ? 'item' : 'items'} could not be read and ${unreadable === 1 ? 'was' : 'were'} kept unchanged.`);
    }, () => { if (current) setWarning(UNAVAILABLE); });
    return () => { current = false; };
  }, []);
  // The visible library changes first; a failed write keeps the change for this page and explains why.
  function save(record: LibraryRecord) {
    setRecords(previous => [...previous.filter(item => item.id !== record.id), record]);
    putRecord(record).catch(() => setWarning(UNAVAILABLE));
  }
  // Removing a favorite, design or collection also removes memberships that point at it.
  function remove(record: LibraryRecord) {
    const doomed = cascade(records, record);
    setRecords(previous => previous.filter(item => !doomed.some(gone => gone.id === item.id)));
    deleteRecords(doomed).catch(() => setWarning(UNAVAILABLE));
  }
  const ofType = <T,>(type: RecordType) => records.filter(record => record.type === type && !record.deletedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) as LibraryRecord<T>[];
  function rename(record: LibraryRecord<InputPayload | DesignPayload | CollectionPayload>, name: string) {
    save({ ...record, payload: { ...record.payload, name: parseName(name) }, updatedAt: new Date().toISOString() });
  }
  function toggleFavorite(favorite: FavoritePayload) {
    const existing = findFavorite(records, favorite);
    if (existing) remove(existing); else save(createRecord('favorite', favorite));
  }
  function toggleMembership(collectionId: string, item: LibraryRecord<FavoritePayload | DesignPayload>) {
    const existing = findMembership(records, collectionId, item.id);
    if (existing) remove(existing);
    else save(createRecord<MembershipPayload>('membership', { collectionId, itemType: item.type as MembershipPayload['itemType'], itemId: item.id }));
  }
  return { palettes: ofType<PalettePayload>('palette'), collections: ofType<CollectionPayload>('collection'), toggleMembership, records, favorites: ofType<FavoritePayload>('favorite'), inputs: ofType<InputPayload>('input'), designs: ofType<DesignPayload>('design'),
    warning, toggleFavorite, add: <T,>(type: RecordType, payload: T) => save(createRecord(type, payload)), rename, remove, isFavorite: (favorite: FavoritePayload) => !!findFavorite(records, favorite), removeFavorite: remove };
}
