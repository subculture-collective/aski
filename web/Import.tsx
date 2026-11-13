import { useEffect, useMemo, useState } from 'react';
import type { LibraryRecord } from '../shared/library.ts';
import { importScope, planImport } from '../shared/sync.ts';
import type { ImportMap } from '../shared/sync.ts';
import type { Mutation } from './accountLibrary.ts';
import { loadImportMap, saveImportMap } from './libraryStore.ts';
interface ImportProps {
  subject: string; local: LibraryRecord[]; remote: LibraryRecord[]; loading: boolean;
  send: (mutations: Mutation[]) => Promise<unknown>; reload: () => Promise<LibraryRecord[]>;
}
// Offers to copy the browser library into the account. Nothing is written until the visitor confirms the
// scope, and nothing in this browser is changed or removed: the browser copies stay after the import.
export function Import({ subject, local, remote, loading, send, reload }: ImportProps) {
  const [map, setMap] = useState<ImportMap | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let current = true; setMap(null); setStatus(''); setDismissed(false); setReviewing(false);
    loadImportMap(subject).then(value => { if (current) setMap(value); }, () => {});
    return () => { current = false; };
  }, [subject]);
  // The preview plan only describes the scope; the import plans again from a fresh read of the account.
  const preview = useMemo(() => map && !loading ? planImport(local, remote, map) : null, [local, remote, map, loading]);
  async function run() {
    setBusy(true); setStatus('Importing…');
    const work = async () => {
      const plan = planImport(local, await reload(), await loadImportMap(subject));
      if (!plan.creates.length) return 'Everything from this browser is already in your account.';
      // The ID map is saved before anything is sent, so a retry reuses the same account IDs.
      await saveImportMap(subject, plan.map); setMap(plan.map);
      for (let start = 0; start < plan.creates.length; start += 100) await send(plan.creates.slice(start, start + 100).map(item => item.mutation));
      const present = new Set((await reload()).filter(record => !record.deletedAt).map(record => record.id));
      const missing = plan.creates.filter(item => !present.has(item.mutation.entityId)).length;
      if (missing) return `${missing} imported ${missing === 1 ? 'item was' : 'items were'} not found when reading your account back. Everything is still in this browser; import again to finish.`;
      return `Imported ${importScope(plan).join(', ')} and read ${plan.creates.length === 1 ? 'it' : 'them'} back from your account. The copies in this browser are kept.`
        + (plan.withoutFiles ? ` Image files stay with ${plan.withoutFiles === 1 ? 'one design' : `${plan.withoutFiles} designs`} in this browser.` : '');
    };
    try { setStatus(navigator.locks ? await navigator.locks.request(`aski-import:${subject}`, work) : await work()); }
    catch (error) { setStatus(`The import stopped: ${(error as Error).message} Everything is still in this browser; import again to continue without duplicates.`); }
    finally { setBusy(false); setReviewing(false); }
  }
  const scope = preview ? importScope(preview) : [];
  if (!status && (!scope.length || dismissed)) return null;
  return <section className="import" aria-labelledby="import-title">
    <h2 id="import-title">Import from this browser</h2>
    {scope.length > 0 && !dismissed && !busy && (reviewing
      ? <>
        <p>These will be added to your account:</p>
        <ul aria-label="Items to import">{scope.map(item => <li key={item}>{item}</li>)}</ul>
        <p className="hint">Your account keeps what it already has. Favorites and collection entries it already has are not added twice; collections with the same name stay separate.
          {preview!.withoutFiles ? ' Image files are not imported; they stay with the designs in this browser.' : ''} Nothing in this browser is changed.</p>
        <div className="item-actions"><button className="primary" onClick={() => void run()}>Import into account</button><button onClick={() => setReviewing(false)}>Cancel</button></div>
      </>
      : <>
        <p>This browser has {scope.join(', ')} that {scope.length === 1 && /^1 /.test(scope[0]) ? 'is' : 'are'} not in your account.</p>
        <div className="item-actions"><button onClick={() => setReviewing(true)}>Review import</button><button onClick={() => setDismissed(true)}>Not now</button></div>
      </>)}
    {status && <p role="status" data-testid="import-status">{status}</p>}
  </section>;
}
