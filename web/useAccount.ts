import { useEffect, useState } from 'react';
// Account state is optional. A host without the account service answers 503, and then sign-in is not
// offered at all; any other failure leaves the visitor signed out with every local workflow intact.
export interface AccountState { status: 'checking' | 'unavailable' | 'signed-out' | 'signed-in'; email: string; subject: string }
const SIGNED_OUT: AccountState = { status: 'signed-out', email: '', subject: '' };
export function useAccount() {
  const [account, setAccount] = useState<AccountState>({ ...SIGNED_OUT, status: 'checking' });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/session', { signal: controller.signal }).then(async response => {
      if (response.status === 503) { setAccount({ ...SIGNED_OUT, status: 'unavailable' }); return; }
      const body = response.ok ? await response.json() : null;
      setAccount(body?.signedIn && typeof body.email === 'string' && typeof body.subject === 'string'
        ? { status: 'signed-in', email: body.email, subject: body.subject } : SIGNED_OUT);
    }).catch(() => { if (!controller.signal.aborted) setAccount(SIGNED_OUT); });
    return () => controller.abort();
  }, []);
  return { account, signedOut: () => setAccount(SIGNED_OUT) };
}
