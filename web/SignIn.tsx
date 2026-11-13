import { useEffect, useRef, useState } from 'react';
// Account state is optional. When the account service is down or signed out, every local workflow
// still works; signing out only ends the server session and leaves this browser's work alone.
export function SignIn() {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [account, setAccount] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/session', { signal: controller.signal }).then(response => response.ok ? response.json() : null)
      .then(body => { if (body?.signedIn && typeof body.email === 'string') setAccount(body.email); }, () => {});
    return () => controller.abort();
  }, []);
  async function signOut() {
    if (pending) return;
    setPending(true); setNotice('');
    try {
      const response = await fetch('/api/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error();
      setAccount(''); setNotice('Signed out. Your work in this browser is unchanged.');
    } catch { setNotice('Could not sign out. Try again.'); }
    finally { setPending(false); }
  }
  if (account) return <>
    <span className="account" title={account}>Signed in as <strong>{account}</strong></span>
    <button onClick={() => void signOut()} disabled={pending}>{pending ? 'Signing out…' : 'Sign out'}</button>
    <span className="account-notice" role="status">{notice}</span>
  </>;
  return <>
    <button ref={trigger} onClick={() => dialog.current?.showModal()}>Sign in</button>
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
