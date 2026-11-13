import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { MAX_ARTIFACT, checkArtifact } from '../shared/artifact.ts';
import { ARTIFACT_TYPES } from '../shared/library.ts';
import type { AccountEnv } from './account.ts';
import type { LibraryDeps } from './library.ts';
// Private image files for account designs (docs/account-library.md). Bytes live under ARTIFACT_ROOT with a
// random storage key, never a name derived from the owner or the hash, and are served only through the
// owner-scoped handler below. A file becomes visible only after its bytes have been checked and written.
const UUID = /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/;
const HASH = /^[\da-f]{64}$/;
export const TEMPORARY_HOURS = 24;
export const RECOVERY_DAYS = 30;
interface Row { id: string; sha256: string; mime: string; byte_length: number; width: number; height: number; provenance: unknown; storage_key: string; created_at: Date }
const meta = (row: Row) => ({ id: row.id, sha256: row.sha256, mime: row.mime, byteLength: row.byte_length, width: row.width, height: row.height,
  provenance: row.provenance, createdAt: row.created_at.toISOString() });
const COLUMNS = 'id, sha256, mime, byte_length, width, height, provenance, storage_key, created_at';
export async function migrateArtifacts(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS aski_artifact (owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, id uuid NOT NULL,
    sha256 text NOT NULL, mime text NOT NULL, byte_length integer NOT NULL, width integer NOT NULL, height integer NOT NULL, provenance jsonb NOT NULL,
    storage_key uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT NOW(), deleted_at timestamptz, PRIMARY KEY (owner_id, id))`);
}
const objects = (root: string) => join(root, 'objects');
const temporary = (root: string) => join(root, 'tmp');
// Removes temporary uploads older than 24 hours, bytes of files deleted more than 30 days ago, and bytes
// with no metadata row (for example after account deletion) once they are older than 24 hours.
export async function sweepArtifacts(pool: Pool, root: string, now = Date.now()) {
  await mkdir(objects(root), { recursive: true }); await mkdir(temporary(root), { recursive: true });
  const old = async (path: string) => now - (await stat(path)).mtimeMs > TEMPORARY_HOURS * 3600_000;
  for (const name of await readdir(temporary(root))) if (await old(join(temporary(root), name))) await rm(join(temporary(root), name), { force: true });
  await pool.query(`DELETE FROM aski_artifact WHERE deleted_at < to_timestamp($1 / 1000.0) - make_interval(days => $2)`, [now, RECOVERY_DAYS]);
  const keys = new Set((await pool.query('SELECT storage_key FROM aski_artifact')).rows.map(row => row.storage_key));
  for (const name of await readdir(objects(root))) if (!keys.has(name) && await old(join(objects(root), name))) await rm(join(objects(root), name), { force: true });
}
export function mountArtifacts(app: Hono<AccountEnv>, { pool, owner, limit }: LibraryDeps, origin: string, root: string | null) {
  const signedOut = (c: Context<AccountEnv>) => c.json({ message: 'Sign in to use your account library.' }, 401);
  const missing = (c: Context<AccountEnv>) => c.json({ message: 'This file is not in your library.' }, 404);
  const unavailable = (c: Context<AccountEnv>) => c.json({ message: 'Image files cannot be saved to accounts here.' }, 503);
  const limited = (c: Context<AccountEnv>, retry: number) => { c.header('Retry-After', String(retry)); return c.json({ message: 'Too many requests. Try again later.' }, 429); };
  // Uploads and deletions come only from the studio itself. An image content type cannot be sent cross-origin
  // without a preflight this service never answers.
  const foreign = (c: Context<AccountEnv>) => c.req.header('origin') !== origin || c.req.header('sec-fetch-site') === 'cross-site';
  const ready = root ? Promise.all([mkdir(objects(root), { recursive: true }), mkdir(temporary(root), { recursive: true })]) : null;
  app.get('/api/artifacts', async c => {
    const who = await owner(c); if (!who) return signedOut(c);
    const retry = await limit('read', who.sessionId, 300, 60); if (retry) return limited(c, retry);
    const rows = (await pool.query(`SELECT ${COLUMNS} FROM aski_artifact WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY created_at`, [who.userId])).rows;
    return c.json({ artifacts: rows.map(meta) });
  });
  app.get('/api/artifacts/:id', async c => {
    const who = await owner(c); if (!who) return signedOut(c);
    if (!root) return unavailable(c);
    const retry = await limit('read', who.sessionId, 300, 60); if (retry) return limited(c, retry);
    const id = c.req.param('id'); if (!UUID.test(id)) return missing(c);
    const row: Row | undefined = (await pool.query(`SELECT ${COLUMNS} FROM aski_artifact WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL`, [who.userId, id])).rows[0];
    if (!row) return missing(c);
    const bytes = await readFile(join(objects(root), row.storage_key));
    // Stored bytes are checked on every read; damage is reported rather than served.
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) return c.json({ message: 'This saved file is damaged.' }, 500);
    const extension = row.mime === 'image/gif' ? 'gif' : row.mime === 'image/png' ? 'png' : 'svg';
    return c.body(new Uint8Array(bytes), 200, { 'Content-Type': row.mime, 'Content-Length': String(bytes.length), 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="aski-${row.id}.${extension}"`, 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff' });
  });
  const limitBody = bodyLimit({ maxSize: MAX_ARTIFACT, onError: c => c.json({ message: 'The file is too large.' }, 413) });
  app.put('/api/artifacts/:id', limitBody, async c => {
    if (foreign(c)) return c.json({ message: 'This request is not allowed.' }, 403);
    const who = await owner(c); if (!who) return signedOut(c);
    if (!root) return unavailable(c);
    const retry = await limit('write', who.userId, 120, 60); if (retry) return limited(c, retry);
    const id = c.req.param('id'); const mime = c.req.header('content-type') || '';
    if (!ARTIFACT_TYPES.includes(mime as typeof ARTIFACT_TYPES[number])) return c.json({ message: 'This file type is not supported.' }, 415);
    const q = c.req.query();
    const width = Number(q.width), height = Number(q.height);
    if (!UUID.test(id) || !HASH.test(q.sha256 || '') || !HASH.test(q.fontSha256 || '') || !q.variantId || q.variantId.length > 200 || !q.rendererVersion || q.rendererVersion.length > 64
      || Object.keys(q).sort().join(',') !== 'fontSha256,height,rendererVersion,sha256,variantId,width') return c.json({ message: 'Invalid file details.' }, 400);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== q.sha256) return c.json({ message: 'The file does not match its hash.' }, 400);
    try { checkArtifact(bytes, mime, width, height); } catch (error) { return c.json({ message: (error as Error).message }, 400); }
    const provenance = { variantId: q.variantId, fontSha256: q.fontSha256, rendererVersion: q.rendererVersion };
    const existing: Row | undefined = (await pool.query(`SELECT ${COLUMNS} FROM aski_artifact WHERE owner_id = $1 AND id = $2`, [who.userId, id])).rows[0];
    // The same upload repeated is acknowledged; different bytes under a used ID are refused.
    if (existing) return existing.sha256 === q.sha256 && existing.mime === mime ? c.json(meta(existing)) : c.json({ message: 'This file ID is already used.' }, 409);
    await ready;
    const key = randomUUID(); const pending = join(temporary(root), key);
    try {
      await writeFile(pending, bytes, { flag: 'wx' }); await rename(pending, join(objects(root), key));
      const row: Row = (await pool.query(`INSERT INTO aski_artifact (owner_id, id, sha256, mime, byte_length, width, height, provenance, storage_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (owner_id, id) DO NOTHING RETURNING ${COLUMNS}`,
      [who.userId, id, q.sha256, mime, bytes.length, width, height, JSON.stringify(provenance), key])).rows[0];
      if (!row) { await rm(join(objects(root), key), { force: true }); return c.json({ message: 'This file ID is already used.' }, 409); }
      return c.json(meta(row), 201);
    } catch (error) { await rm(pending, { force: true }); await rm(join(objects(root), key), { force: true }); throw error; }
  });
  // A file is removed only when no live design of the owner lists it. Its bytes stay recoverable for 30 days.
  app.delete('/api/artifacts/:id', async c => {
    if (foreign(c)) return c.json({ message: 'This request is not allowed.' }, 403);
    const who = await owner(c); if (!who) return signedOut(c);
    const retry = await limit('write', who.userId, 120, 60); if (retry) return limited(c, retry);
    const id = c.req.param('id'); if (!UUID.test(id)) return missing(c);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT 1 FROM aski_artifact WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE', [who.userId, id])).rowCount;
      if (!row) { await client.query('ROLLBACK'); return missing(c); }
      const used = (await client.query(`SELECT 1 FROM aski_library_record WHERE owner_id = $1 AND type = 'design' AND deleted_at IS NULL AND payload->'artifacts' ? $2 LIMIT 1`, [who.userId, id])).rowCount;
      if (used) { await client.query('ROLLBACK'); return c.json({ message: 'A saved design still uses this file.' }, 409); }
      await client.query('UPDATE aski_artifact SET deleted_at = NOW() WHERE owner_id = $1 AND id = $2', [who.userId, id]);
      await client.query('COMMIT');
      return c.json({ message: 'Removed.' });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
}
