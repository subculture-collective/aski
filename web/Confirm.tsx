import { useRef, useState } from 'react';
// The link token lives only in this component's memory. main.tsx has already removed it from the URL,
// and only the deliberate Continue action sends it, in a same-origin JSON request.
export function Confirm({ token }: { token: string }) {
  const kept = useRef(token);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(token ? '' : 'This sign-in link is incomplete. Request a new link from the studio.');
  async function confirm() {
    if (pending || !kept.current) return;
    setPending(true); setMessage('');
    try {
      const response = await fetch('/api/sign-in/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: kept.current }), signal: AbortSignal.timeout(15_000) });
      if (response.ok) { kept.current = ''; location.replace('/'); return; }
      // An invalid, expired or used link never becomes valid, so drop it; other failures can be retried.
      if (response.status === 400) { kept.current = ''; setMessage('This sign-in link is invalid, expired or already used. Request a new link from the studio.'); }
      else setMessage(response.status === 429 ? 'Too many attempts. Try again later.' : 'Sign-in is unavailable. Try again later.');
    } catch { setMessage('Sign-in is unavailable. Try again later.'); }
    finally { setPending(false); }
  }
  return <main className="confirm">
    <header><h1><a href="/" aria-label="aski studio"><img src="/brand/lockup.svg" alt="aski" /></a></h1></header>
    <h2>Sign in to aski</h2>
    <p>Continue to sign in on this device. Your work in this browser stays as it is.</p>
    {kept.current && <button className="primary" onClick={() => void confirm()} disabled={pending}>{pending ? 'Signing in…' : 'Continue'}</button>}
    <p role="status">{message}</p>
    <a href="/">Return to the studio</a>
  </main>;
}
