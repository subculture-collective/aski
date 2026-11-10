import { useEffect, useState } from 'react';
import { cascade, createRecord, findFavorite, findMembership, orphanedArtifacts, parseName, sha256 } from '../shared/library.ts';
import type { Artifact, ArtifactMeta, PalettePayload, CollectionPayload, DesignPayload, FavoritePayload, InputPayload, LibraryRecord, MembershipPayload, RecordType } from '../shared/library.ts';
import { deleteRecords, loadArtifactMeta, loadLibrary, putArtifact, putRecord, readArtifact } from './libraryStore.ts';
const UNAVAILABLE = 'This browser cannot save your library. Saved items last until you close this page.';
export function useLibrary() {
  const [records, setRecords] = useState<LibraryRecord[]>([]);
  const [warning, setWarning] = useState('');
  const [artifacts, setArtifacts] = useState<ArtifactMeta[]>([]);
  useEffect(() => { loadArtifactMeta().then(setArtifacts, () => {}); }, []);
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
  // A design's files go with it unless another design still uses them.
  function remove(record: LibraryRecord) {
    const doomed = cascade(records, record);
    const files = record.type === 'design' ? orphanedArtifacts(records, record) : [];
    setRecords(previous => previous.filter(item => !doomed.some(gone => gone.id === item.id)));
    setArtifacts(previous => previous.filter(item => !files.includes(item.id)));
    deleteRecords(doomed, files).catch(() => setWarning(UNAVAILABLE));
  }
  // Saves the design first so a storage failure for its files never loses the recipe.
  async function addDesign(payload: DesignPayload, files: Omit<Artifact, 'namespace' | 'id' | 'sha256' | 'byteLength' | 'createdAt'>[]) {
    const design = createRecord<DesignPayload>('design', payload);
    save(design);
    if (!files.length) return '';
    const stored: Artifact[] = [];
    try {
      for (const file of files) {
        const artifact: Artifact = { ...file, namespace: design.namespace, id: crypto.randomUUID(), sha256: await sha256(file.bytes), byteLength: file.bytes.length, createdAt: design.createdAt };
        await putArtifact(artifact); stored.push(artifact);
      }
    } catch { /* reported below */ }
    if (stored.length) {
      save({ ...design, payload: { ...payload, artifacts: stored.map(file => file.id) } });
      setArtifacts(previous => [...previous, ...stored.map(({ bytes: _bytes, ...meta }) => { void _bytes; return meta; })]);
    }
    return stored.length === files.length ? '' : 'The design is saved, but this browser had no room to keep its exported files.';
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
  return { artifacts, addDesign, readArtifact, palettes: ofType<PalettePayload>('palette'), collections: ofType<CollectionPayload>('collection'), toggleMembership, records, favorites: ofType<FavoritePayload>('favorite'), inputs: ofType<InputPayload>('input'), designs: ofType<DesignPayload>('design'),
    warning, toggleFavorite, add: <T,>(type: RecordType, payload: T) => save(createRecord(type, payload)), rename, remove, isFavorite: (favorite: FavoritePayload) => !!findFavorite(records, favorite), removeFavorite: remove };
}
