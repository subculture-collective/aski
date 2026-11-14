import { useRef, useState } from 'react';
import type { AccountState } from './useAccount.ts';
// Account state is optional. When the account service is down or signed out, every local workflow
// still works; signing out only ends the server session and leaves this browser's work alone. A host
// without the account service answers 503, and then sign-in is not offered at all.
export function SignIn({ account, onSignedOut }: { account: AccountState; onSignedOut: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  async function signOut() {
    if (pending) return;
    setPending(true); setNotice('');
    try {
      const response = await fetch('/api/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error();
      onSignedOut(); setNotice('Signed out. Your work in this browser is unchanged.');
    } catch { setNotice('Could not sign out. Try again.'); }
    finally { setPending(false); }
  }
  if (account.status === 'signed-in' || account.status === 'offline') return <>
    <span className="account" title={account.email}>Signed in as <strong>{account.email}</strong>{account.status === 'offline' ? ' (offline)' : ''}</span>
    <button onClick={() => void signOut()} disabled={pending}>{pending ? 'Signing out…' : 'Sign out'}</button>
    <span className="account-notice" role="status">{notice}</span>
  </>;
  if (account.status === 'unavailable') return null;
  return <>
    <button ref={trigger} className="quiet" onClick={() => dialog.current?.showModal()}>Sign in</button>
    {notice && <span className="account-notice" role="status">{notice}</span>}
    <dialog ref={dialog} aria-labelledby="signin-title" onClose={() => trigger.current?.focus()}>
      <h2 id="signin-title">Sign in</h2>
      <form onSubmit={async e => {
        e.preventDefault(); if (pending) return;
        setPending(true); setMessage('');
        try {
          const response = await fetch('/api/sign-in/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }), signal: AbortSignal.timeout(15_000) });
          setMessage(response.ok ? 'Check your inbox for a sign-in link.' : response.status === 429 ? 'Too many requests. Try again later.' : response.status === 400 ? 'Enter a valid email address.' : 'Sign-in is unavailable. Keep creating and try later.');
        } catch { setMessage('Sign-in is unavailable. Keep creating and try later.'); }
        finally { setPending(false); }
      }}>
        <label htmlFor="signin-email">Email</label>
        <input id="signin-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} />
        <button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Email a link'}</button>
      </form>
      <p role="status">{message}</p>
      <button onClick={() => dialog.current?.close()}>Keep creating</button>
    </dialog>
  </>;
}
