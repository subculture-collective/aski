import { useRef, useState } from 'react';
export function SignIn() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  return <>
    <button onClick={() => dialog.current?.showModal()}>Sign in</button>
    <dialog ref={dialog} aria-labelledby="signin-title">
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
