import Dexie from 'dexie';
const db = new Dexie('aski-feasibility');
db.version(1).stores({ artifacts: 'id' });
window.storageProbe = {
  save: bytes => db.artifacts.put({ id: 'gif', bytes: Uint8Array.from(bytes), mime: 'image/gif' }),
  load: async () => [...(await db.artifacts.get('gif')).bytes],
  blobSupport: async bytes => {
    try {
      await db.artifacts.put({ id: 'blob-probe', blob: new Blob([Uint8Array.from(bytes)], { type: 'image/gif' }) });
      const stored = await db.artifacts.get('blob-probe');
      const restored = new Uint8Array(await stored.blob.arrayBuffer());
      if (restored.length !== bytes.length || restored.some((x, i) => x !== bytes[i])) throw new Error('Blob byte mismatch');
      await db.artifacts.delete('blob-probe');
      return { success: true };
    } catch (error) {
      return { success: false, name: error.name, message: error.message };
    }
  },
  rollback: async () => {
    try {
      await db.transaction('rw', db.artifacts, async () => {
        await db.artifacts.put({ id: 'rolled-back', bytes: new Uint8Array([1]) });
        throw new Error('intentional-rollback');
      });
    } catch (error) {
      if (error.message !== 'intentional-rollback') throw error;
    }
    return (await db.artifacts.get('rolled-back')) === undefined;
  },
};
