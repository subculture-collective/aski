import { useEffect, useState } from 'react';
import { forgetAccountCache } from './libraryStore.ts';
// Account state is optional. A host without the account service answers 503, and then sign-in is not
// offered at all; any other failure leaves the visitor signed out with every local workflow intact.
// The last signed-in account (its user ID and address, never a token) is remembered so that, when the
// account service cannot be reached, its cached library and unsent changes stay usable offline.
export interface AccountState { status: 'checking' | 'unavailable' | 'signed-out' | 'signed-in' | 'offline'; email: string; subject: string }
const SIGNED_OUT: AccountState = { status: 'signed-out', email: '', subject: '' };
const KEY = 'aski:account';
function remembered(): { subject: string; email: string } | null {
  try { const value = JSON.parse(localStorage.getItem(KEY) || 'null'); return typeof value?.subject === 'string' && typeof value?.email === 'string' ? value : null; }
  catch { return null; }
}
function remember(value: { subject: string; email: string } | null) {
  try { if (value) localStorage.setItem(KEY, JSON.stringify(value)); else localStorage.removeItem(KEY); } catch { /* offline use is then unavailable */ }
}
export function useAccount() {
  const [account, setAccount] = useState<AccountState>({ ...SIGNED_OUT, status: 'checking' });
  const [check, setCheck] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const unreachable = (unavailable: boolean) => {
      const last = remembered();
      setAccount(last ? { status: 'offline', ...last } : unavailable ? { ...SIGNED_OUT, status: 'unavailable' } : SIGNED_OUT);
    };
    fetch('/api/session', { signal: controller.signal }).then(async response => {
      if (response.status === 503) { unreachable(true); return; }
      const body = response.ok ? await response.json() : null;
      if (!response.ok) { unreachable(false); return; }
      if (body?.signedIn && typeof body.email === 'string' && typeof body.subject === 'string') {
        const last = remembered();
        if (last && last.subject !== body.subject) void forgetAccountCache(last.subject).catch(() => {});
        remember({ subject: body.subject, email: body.email }); setAccount({ status: 'signed-in', email: body.email, subject: body.subject });
      } else { const last = remembered(); if (last) void forgetAccountCache(last.subject).catch(() => {}); remember(null); setAccount(SIGNED_OUT); }
    }).catch(() => { if (!controller.signal.aborted) unreachable(false); });
    return () => controller.abort();
  }, [check]);
  // While offline, check again when the browser reconnects and every 30 seconds.
  useEffect(() => {
    if (account.status !== 'offline') return;
    const again = () => setCheck(value => value + 1);
    const timer = setInterval(again, 30_000); addEventListener('online', again);
    return () => { clearInterval(timer); removeEventListener('online', again); };
  }, [account.status]);
  // Signing out or a lapsed session hides the account: its cached records are removed and its unsent
  // changes stay in this browser, bound to that account.
  function signedOut() {
    const last = remembered();
    if (last) void forgetAccountCache(last.subject).catch(() => {});
    remember(null); setAccount(SIGNED_OUT);
  }
  return { account, signedOut };
}
