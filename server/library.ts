import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { parseRecord, RECORD_TYPES } from '../shared/library.ts';
import type { DesignPayload, MembershipPayload, RecordType } from '../shared/library.ts';
import type { AccountEnv } from './account.ts';
// The account library from docs/account-sync-contract.md: an owner-scoped change log and atomic mutation
// batches with server-issued revisions. The owner always comes from the session, never from the request.
export const MAX_JSON = 2 * 1024 * 1024;
export const PAGE = 100;
const UUID = /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/;
export interface WireRecord { id: string; type: RecordType; schemaVersion: 1; payload: unknown; revision: number; deletedAt: string | null; createdAt: string; updatedAt: string }
interface Mutation { requestId: string; entityId: string; baseRevision: number; delete?: true; type?: RecordType; schemaVersion?: 1; payload?: unknown }
export interface LibraryDeps {
  pool: Pool;
  owner: (c: Context<AccountEnv>) => Promise<{ userId: string; sessionId: string } | null>;
  limit: (kind: string, value: string, max: number, seconds: number) => Promise<number>;
  rejectWrite: (c: Context<AccountEnv>) => Response | null;
}
// A refusal names the record it is about, when known, so a client can resolve that one change.
class Refusal extends Error {
  status: 400 | 404 | 409; record?: WireRecord; entityId?: string; duplicate?: true;
  constructor(status: 400 | 404 | 409, message: string, details: { record?: WireRecord; entityId?: string; duplicate?: true } = {}) {
    super(message); this.status = status; Object.assign(this, details);
  }
}
interface Row { id: string; type: RecordType; schema_version: 1; payload: unknown; revision: number; deleted_at: Date | null; created_at: Date; updated_at: Date }
const wire = (row: Row): WireRecord => ({ id: row.id, type: row.type, schemaVersion: row.schema_version, payload: row.payload, revision: row.revision,
  deletedAt: row.deleted_at?.toISOString() ?? null, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
const COLUMNS = 'id, type, schema_version, payload, revision, deleted_at, created_at, updated_at';
export async function migrateLibrary(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS aski_library_owner (owner_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE, seq bigint NOT NULL DEFAULT 0)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS aski_library_record (
    owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, id uuid NOT NULL, type text NOT NULL, schema_version integer NOT NULL,
    payload jsonb, revision integer NOT NULL, deleted_at timestamptz, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, seq bigint NOT NULL,
    PRIMARY KEY (owner_id, id))`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS aski_library_record_seq ON aski_library_record (owner_id, seq)');
  // Favorites are unique by family/variant and memberships by collection/item, among live records of one owner.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS aski_library_favorite ON aski_library_record (owner_id, (payload->>'familyId'), (COALESCE(payload->>'variantId', '')))
    WHERE type = 'favorite' AND deleted_at IS NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS aski_library_membership ON aski_library_record (owner_id, (payload->>'collectionId'), (payload->>'itemId'))
    WHERE type = 'membership' AND deleted_at IS NULL`);
  await pool.query(`CREATE TABLE IF NOT EXISTS aski_library_request (owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, device_id uuid NOT NULL,
    request_id uuid NOT NULL, body_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW(), PRIMARY KEY (owner_id, device_id, request_id))`);
}
// The cursor is opaque to clients: the owner's change sequence number of the last change they applied.
const encodeCursor = (seq: string) => Buffer.from('v1:' + seq).toString('base64url');
function decodeCursor(value: string | undefined) {
  if (!value) return '0';
  const match = /^v1:(\d{1,18})$/.exec(Buffer.from(value, 'base64url').toString());
  return match ? match[1] : null;
}
function parseMutation(value: unknown): Mutation {
  const m = value as Partial<Mutation> | null;
  const invalid = () => new Refusal(400, 'Invalid library change.');
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw invalid();
  const keys = Object.keys(m).sort().join(',');
  if (typeof m.requestId !== 'string' || !UUID.test(m.requestId) || typeof m.entityId !== 'string' || !UUID.test(m.entityId)
    || !Number.isSafeInteger(m.baseRevision) || m.baseRevision! < 0) throw invalid();
  if (m.delete === true) { if (keys !== 'baseRevision,delete,entityId,requestId') throw invalid(); return m as Mutation; }
  if (keys !== 'baseRevision,entityId,payload,requestId,schemaVersion,type' || !RECORD_TYPES.includes(m.type!)) throw invalid();
  if (m.schemaVersion !== 1) throw new Refusal(400, 'This library record version is not supported.');
  const now = new Date().toISOString();
  try { m.payload = parseRecord({ namespace: 'account', id: m.entityId, type: m.type, schemaVersion: 1, payload: m.payload, revision: 0, deletedAt: null, createdAt: now, updatedAt: now }).payload; }
  catch (error) { throw new Refusal(400, (error as Error).message); }
  return m as Mutation;
}
export function mountLibrary(app: Hono<AccountEnv>, { pool, owner, limit, rejectWrite }: LibraryDeps) {
  const signedOut = (c: Context<AccountEnv>) => c.json({ message: 'Sign in to use your account library.' }, 401);
  const limited = (c: Context<AccountEnv>, retry: number) => { c.header('Retry-After', String(retry)); return c.json({ message: 'Too many requests. Try again later.' }, 429); };
  // Owner-scoped change log, oldest first, including tombstones. Writers hold the owner's sequence row
  // until they commit, so every committed change has a higher number than those visible before it.
  app.get('/api/library', async c => {
    const who = await owner(c); if (!who) return signedOut(c);
    const retry = await limit('read', who.sessionId, 300, 60); if (retry) return limited(c, retry);
    const after = decodeCursor(c.req.query('cursor'));
    const latest = (await pool.query('SELECT seq FROM aski_library_owner WHERE owner_id = $1', [who.userId])).rows[0]?.seq ?? '0';
    if (after === null || BigInt(after) > BigInt(latest)) return c.json({ resync: true, changes: [], cursor: encodeCursor('0'), more: false });
    const rows = (await pool.query(`SELECT ${COLUMNS}, seq FROM aski_library_record WHERE owner_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`, [who.userId, after, PAGE + 1])).rows;
    const page = rows.slice(0, PAGE);
    return c.json({ changes: page.map(wire), cursor: encodeCursor(page.at(-1)?.seq ?? after), more: rows.length > PAGE });
  });
  const limitBody = bodyLimit({ maxSize: MAX_JSON, onError: c => c.json({ message: 'Request is too large.' }, 413) });
  app.post('/api/library/mutations', limitBody, async c => {
    const rejected = rejectWrite(c); if (rejected) return rejected;
    const who = await owner(c); if (!who) return signedOut(c);
    const retry = await limit('write', who.userId, 120, 60); if (retry) return limited(c, retry);
    let body: { protocolVersion?: unknown; deviceId?: unknown; mutations?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ message: 'Invalid library change.' }, 400); }
    if (!body || typeof body !== 'object' || Object.keys(body).sort().join(',') !== 'deviceId,mutations,protocolVersion' || body.protocolVersion !== 1
      || typeof body.deviceId !== 'string' || !UUID.test(body.deviceId) || !Array.isArray(body.mutations) || !body.mutations.length || body.mutations.length > PAGE)
      return c.json({ message: 'Invalid library change.' }, 400);
    const deviceId = body.deviceId;
    // The idempotency key covers the operation exactly as sent, so a retry must repeat the same bytes.
    const operations = body.mutations.map(value => ({ hash: createHash('sha256').update(JSON.stringify(value)).digest('hex'), raw: value }));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO aski_library_owner (owner_id) VALUES ($1) ON CONFLICT DO NOTHING', [who.userId]);
      let seq = BigInt((await client.query('SELECT seq FROM aski_library_owner WHERE owner_id = $1 FOR UPDATE', [who.userId])).rows[0].seq);
      const results: unknown[] = []; const touched = new Set<string>();
      for (const { hash, raw } of operations) {
        const requestId = (raw as { requestId?: unknown } | null)?.requestId;
        const earlier = typeof requestId === 'string' && UUID.test(requestId) ? (await client.query('SELECT body_hash, result FROM aski_library_request WHERE owner_id = $1 AND device_id = $2 AND request_id = $3',
          [who.userId, deviceId, requestId])).rows[0] : undefined;
        if (earlier) {
          if (earlier.body_hash !== hash) throw new Refusal(409, 'This change ID was already used for a different change.', { entityId: earlier.result.entityId });
          results.push(earlier.result); touched.add(earlier.result.entityId); continue;
        }
        const rawId = (raw as { entityId?: unknown } | null)?.entityId;
        let m: Mutation;
        try { m = parseMutation(raw); }
        catch (error) { if (error instanceof Refusal && typeof rawId === 'string' && UUID.test(rawId)) error.entityId = rawId; throw error; }
        const current: Row | undefined = (await client.query(`SELECT ${COLUMNS} FROM aski_library_record WHERE owner_id = $1 AND id = $2 FOR UPDATE`, [who.userId, m.entityId])).rows[0];
        const missing = () => new Refusal(404, 'This item is not in your library.', { entityId: m.entityId });
        const stale = () => new Refusal(409, 'This item changed in another session.', { record: wire(current!), entityId: m.entityId });
        let revision: number;
        if (m.delete) {
          if (!current) throw missing();
          if (current.deleted_at || current.revision !== m.baseRevision) throw stale();
          revision = current.revision + 1;
          await client.query('UPDATE aski_library_record SET payload = NULL, deleted_at = NOW(), updated_at = NOW(), revision = $3, seq = $4 WHERE owner_id = $1 AND id = $2',
            [who.userId, m.entityId, revision, String(++seq)]);
          // Removing a collection, style or design removes the memberships that point at it, never the members.
          if (current.type !== 'membership') {
            const links = (await client.query(`SELECT id FROM aski_library_record WHERE owner_id = $1 AND type = 'membership' AND deleted_at IS NULL
              AND (payload->>'collectionId' = $2 OR payload->>'itemId' = $2) ORDER BY created_at FOR UPDATE`, [who.userId, m.entityId])).rows;
            for (const link of links) {
              await client.query('UPDATE aski_library_record SET payload = NULL, deleted_at = NOW(), updated_at = NOW(), revision = revision + 1, seq = $3 WHERE owner_id = $1 AND id = $2',
                [who.userId, link.id, String(++seq)]);
              touched.add(link.id);
            }
          }
        } else {
          if (m.baseRevision === 0 ? current : !current) throw m.baseRevision === 0 ? stale() : missing();
          if (current && (current.deleted_at || current.revision !== m.baseRevision)) throw stale();
          if (current && current.type !== m.type) throw new Refusal(400, 'An item cannot change its type.', { entityId: m.entityId });
          if (!current) await checkDuplicate(client, who.userId, m);
          await checkReferences(client, who.userId, m);
          revision = m.baseRevision + 1;
          if (current) await client.query('UPDATE aski_library_record SET payload = $3, updated_at = NOW(), revision = $4, seq = $5 WHERE owner_id = $1 AND id = $2',
            [who.userId, m.entityId, JSON.stringify(m.payload), revision, String(++seq)]);
          else await client.query(`INSERT INTO aski_library_record (owner_id, id, type, schema_version, payload, revision, created_at, updated_at, seq)
            VALUES ($1, $2, $3, 1, $4, 1, NOW(), NOW(), $5)`, [who.userId, m.entityId, m.type, JSON.stringify(m.payload), String(++seq)]);
        }
        const result = { requestId: m.requestId, entityId: m.entityId, revision };
        await client.query('INSERT INTO aski_library_request (owner_id, device_id, request_id, body_hash, result) VALUES ($1, $2, $3, $4, $5)',
          [who.userId, deviceId, m.requestId, hash, JSON.stringify(result)]);
        results.push(result); touched.add(m.entityId);
      }
      await client.query('UPDATE aski_library_owner SET seq = $2 WHERE owner_id = $1', [who.userId, String(seq)]);
      const changes = (await client.query(`SELECT ${COLUMNS} FROM aski_library_record WHERE owner_id = $1 AND id = ANY($2::uuid[]) ORDER BY seq`, [who.userId, [...touched]])).rows.map(wire);
      await client.query('COMMIT');
      return c.json({ results, changes });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Refusal) return c.json({ message: error.message, ...(error.entityId ? { entityId: error.entityId } : {}),
        ...(error.record ? { record: error.record } : {}), ...(error.duplicate ? { duplicate: true } : {}) }, error.status);
      if ((error as { code?: string }).code === '23505') return c.json({ message: 'This item is already in your library.' }, 409);
      throw error;
    } finally { client.release(); }
  });
}
// References must name live records of the same owner, checked inside the batch's transaction so an
// earlier operation in the batch counts and a foreign UUID looks exactly like a missing one.
async function checkReferences(client: PoolClient, ownerId: string, m: Mutation) {
  const owned = async (id: string, type: RecordType) => (await client.query(`SELECT 1 FROM aski_library_record WHERE owner_id = $1 AND id = $2 AND type = $3 AND deleted_at IS NULL FOR SHARE`,
    [ownerId, id, type])).rowCount === 1;
  if (m.type === 'membership') {
    const link = m.payload as MembershipPayload;
    if (!await owned(link.collectionId, 'collection') || !await owned(link.itemId, link.itemType)) throw new Refusal(400, 'This collection or item is not in your library.', { entityId: m.entityId });
  }
  // Image files are not stored in accounts yet; a design that lists them is refused rather than saved half-way.
  if (m.type === 'design' && (m.payload as DesignPayload).artifacts?.length) throw new Refusal(400, 'Image files cannot be saved to an account yet.', { entityId: m.entityId });
}
// A new favorite or collection entry equal to a live one is refused with the existing record, so the client
// can use that one instead. The unique indexes still guard against a race between two batches.
async function checkDuplicate(client: PoolClient, ownerId: string, m: Mutation) {
  const p = m.payload as Record<string, string | undefined>;
  const query = m.type === 'favorite' ? [`payload->>'familyId' = $2 AND COALESCE(payload->>'variantId', '') = $3`, p.familyId, p.variantId ?? '']
    : m.type === 'membership' ? [`payload->>'collectionId' = $2 AND payload->>'itemId' = $3`, p.collectionId, p.itemId] : null;
  if (!query) return;
  const existing: Row | undefined = (await client.query(`SELECT ${COLUMNS} FROM aski_library_record WHERE owner_id = $1 AND type = $4 AND deleted_at IS NULL AND ${query[0]}`,
    [ownerId, query[1], query[2], m.type])).rows[0];
  if (existing) throw new Refusal(409, 'This item is already in your library.', { record: wire(existing), entityId: m.entityId, duplicate: true });
}
