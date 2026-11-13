import type { LibraryRecord } from '../shared/library.ts';
import type { Rejection } from '../shared/outbox.ts';
export type { Mutation } from '../shared/outbox.ts';
// Client for the account library protocol in docs/account-sync-contract.md. The session cookie identifies
// the owner; nothing here sends or stores an owner ID or a token.
export type WireRecord = Omit<LibraryRecord, 'namespace'>;
export class AccountLibraryError extends Error {
  status: number; details: Omit<Rejection, 'status' | 'message'>; retryAfter: number;
  constructor(status: number, message: string, details: Omit<Rejection, 'status' | 'message'> = {}, retryAfter = 0) {
    super(message); this.status = status; this.details = details; this.retryAfter = retryAfter;
  }
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
  if (!response.ok) throw new AccountLibraryError(response.status, typeof body.message === 'string' ? body.message : 'Your account library is unavailable.',
    { entityId: body.entityId, record: body.record, duplicate: body.duplicate }, Number(response.headers.get('retry-after')) || 0);
  return body as T;
}
export interface Page { changes: WireRecord[]; cursor: string; more: boolean; resync?: boolean }
export const readChanges = (cursor: string) => call<Page>('/api/library' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
export const requestBody = (mutations: unknown[]) => JSON.stringify({ protocolVersion: 1, deviceId: deviceId(), mutations });
// Sends a batch exactly as serialized, so a retry repeats the same bytes.
export const sendBody = (body: string) => call<{ changes: WireRecord[] }>('/api/library/mutations', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
