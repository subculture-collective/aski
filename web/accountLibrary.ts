import type { LibraryRecord, RecordType } from '../shared/library.ts';
// Client for the account library protocol in docs/account-sync-contract.md. The session cookie identifies
// the owner; nothing here sends or stores an owner ID or a token.
export type WireRecord = Omit<LibraryRecord, 'namespace'>;
export type Mutation = { requestId: string; entityId: string; baseRevision: number }
  & ({ delete: true } | { type: RecordType; schemaVersion: 1; payload: unknown });
export class AccountLibraryError extends Error {
  status: number; record?: WireRecord;
  constructor(status: number, message: string, record?: WireRecord) { super(message); this.status = status; this.record = record; }
}
// A per-browser ID that scopes retry keys. It is not an identity and is never used for ownership.
export function deviceId() {
  try {
    let id = localStorage.getItem('aski:device');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('aski:device', id); }
    return id;
  } catch { return sessionDevice; }
}
const sessionDevice = crypto.randomUUID();
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...init, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new AccountLibraryError(0, 'Could not reach your account library.'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new AccountLibraryError(response.status, typeof body.message === 'string' ? body.message : 'Your account library is unavailable.', body.record);
  return body as T;
}
export interface Page { changes: WireRecord[]; cursor: string; more: boolean; resync?: boolean }
export const readChanges = (cursor: string) => call<Page>('/api/library' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
export const sendMutations = (mutations: Mutation[]) => call<{ changes: WireRecord[] }>('/api/library/mutations', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1, deviceId: deviceId(), mutations }),
});
