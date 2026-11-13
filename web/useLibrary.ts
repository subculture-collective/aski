import { useEffect, useState } from 'react';
import { cascade, createRecord, findFavorite, findMembership, orphanedArtifacts, parseName, sha256 } from '../shared/library.ts';
import type { Artifact, ArtifactMeta, PalettePayload, CollectionPayload, DesignPayload, FavoritePayload, InputPayload, LibraryRecord, MembershipPayload, RecordType } from '../shared/library.ts';
import { deleteRecords, loadArtifactMeta, loadLibrary, putDesignWithArtifacts, putRecord, readArtifact } from './libraryStore.ts';
const UNAVAILABLE = 'This browser cannot save your library. Saved items last until you close this page.';
export function useLibrary() {
  const [records, setRecords] = useState<LibraryRecord[]>([]);
  const [warning, setWarning] = useState('');
  const [artifacts, setArtifacts] = useState<ArtifactMeta[]>([]);
  useEffect(() => { loadArtifactMeta().then(setArtifacts, () => {}); }, []);
  // Bumped to read the library again after records were added from outside this page's actions.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    loadLibrary().then(({ records: loaded, unreadable }) => {
      if (!current) return;
      setRecords(previous => [...loaded, ...previous.filter(item => !loaded.some(record => record.id === item.id))]);
      if (unreadable) setWarning(`${unreadable} saved ${unreadable === 1 ? 'item' : 'items'} could not be read and ${unreadable === 1 ? 'was' : 'were'} kept unchanged.`);
    }, error => { if (current) setWarning((error as Error).message === 'blocked' ? 'Another aski tab is using an older library. Close it and reload to see your saved items.' : UNAVAILABLE); });
    return () => { current = false; };
  }, [version]);
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
  // Saves the design and its files together. If the files do not fit, the design is saved without them,
  // so a storage failure never loses the recipe.
  async function addDesign(payload: DesignPayload, files: Omit<Artifact, 'namespace' | 'id' | 'sha256' | 'byteLength' | 'createdAt'>[]) {
    const plain = createRecord<DesignPayload>('design', payload);
    if (!files.length) { save(plain); return ''; }
    const stored: Artifact[] = [];
    for (const file of files) stored.push({ ...file, namespace: plain.namespace, id: crypto.randomUUID(), sha256: await sha256(file.bytes), byteLength: file.bytes.length, createdAt: plain.createdAt });
    const design = { ...plain, payload: { ...payload, artifacts: stored.map(file => file.id) } };
    try {
      await putDesignWithArtifacts(design, stored);
      setRecords(previous => [...previous, design]);
      setArtifacts(previous => [...previous, ...stored.map(({ bytes: _bytes, ...meta }) => { void _bytes; return meta; })]);
      return '';
    } catch {
      save(plain);
      return 'The design is saved, but this browser had no room to keep its exported files.';
    }
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
  return { kind: 'browser' as const, loading: false, reread: () => setVersion(value => value + 1), artifacts, addDesign, readArtifact, palettes: ofType<PalettePayload>('palette'), collections: ofType<CollectionPayload>('collection'), toggleMembership, records, favorites: ofType<FavoritePayload>('favorite'), inputs: ofType<InputPayload>('input'), designs: ofType<DesignPayload>('design'),
    warning, toggleFavorite, add: <T,>(type: RecordType, payload: T) => save(createRecord(type, payload)), rename, remove, isFavorite: (favorite: FavoritePayload) => !!findFavorite(records, favorite), removeFavorite: remove };
}
