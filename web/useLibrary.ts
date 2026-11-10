import { useEffect, useState } from 'react';
import { createRecord, findFavorite } from '../shared/library.ts';
import type { FavoritePayload, LibraryRecord } from '../shared/library.ts';
import { deleteRecord, loadLibrary, putRecord } from './libraryStore.ts';
const UNAVAILABLE = 'This browser cannot save your library. Favorites last until you close this page.';
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
  function remove(record: LibraryRecord) {
    setRecords(previous => previous.filter(item => item.id !== record.id));
    deleteRecord(record).catch(() => setWarning(UNAVAILABLE));
  }
  const favorites = records.filter(record => record.type === 'favorite' && !record.deletedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) as LibraryRecord<FavoritePayload>[];
  function toggleFavorite(favorite: FavoritePayload) {
    const existing = findFavorite(records, favorite);
    if (existing) remove(existing); else save(createRecord('favorite', favorite));
  }
  return { records, favorites, warning, toggleFavorite, isFavorite: (favorite: FavoritePayload) => !!findFavorite(records, favorite), removeFavorite: remove };
}
