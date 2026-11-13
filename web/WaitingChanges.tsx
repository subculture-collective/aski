import { useEffect, useState } from 'react';
import { copyWaitingToBrowser, discardWaiting, waitingChanges } from './libraryStore.ts';
import type { SyncState } from './libraryStore.ts';
// Unsent changes stay bound to the account that made them. While another account, or none, is signed in,
// they are listed here: they are sent when their account signs in again, or the visitor can copy them into
// this browser's library or discard them. They are never sent to a different account.
export function WaitingChanges({ current, onCopied }: { current: string; onCopied: () => void }) {
  const [states, setStates] = useState<SyncState[]>([]);
  const [confirming, setConfirming] = useState('');
  const [note, setNote] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    waitingChanges().then(found => { if (live) setStates(found.filter(state => state.subject !== current)); }, () => {});
    return () => { live = false; };
  }, [current, version]);
  if (!states.length && !note) return null;
  const count = (state: SyncState) => { const n = state.outbox.reduce((sum, entry) => sum + entry.mutations.length, 0); return n === 1 ? '1 unsent change' : `${n} unsent changes`; };
  return <section className="import" aria-labelledby="waiting-title">
    <h2 id="waiting-title">Unsent account changes</h2>
    {states.map(state => <div key={state.subject}>
      <p>{count(state)} for {state.email || 'another account'} {state.outbox.length === 1 && count(state).startsWith('1 ') ? 'is' : 'are'} kept in this browser. They are sent when that account signs in here again.</p>
      {confirming === state.subject
        ? <div className="item-actions"><button onClick={() => { void discardWaiting(state.subject).then(() => { setConfirming(''); setNote('Discarded the unsent changes.'); setVersion(value => value + 1); }); }}>Confirm discard</button>
          <button onClick={() => setConfirming('')}>Cancel</button></div>
        : <div className="item-actions">
          <button onClick={() => { void copyWaitingToBrowser(state.subject).then(copied => { setNote(`Copied ${copied} ${copied === 1 ? 'item' : 'items'} into this browser’s library.`); onCopied(); setVersion(value => value + 1); },
            () => setNote('Could not copy the changes into this browser. They are still kept.')); }}>Copy to this browser</button>
          <button onClick={() => setConfirming(state.subject)}>Discard</button>
        </div>}
    </div>)}
    {note && <p role="status">{note}</p>}
  </section>;
}
