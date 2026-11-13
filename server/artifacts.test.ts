import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createAccountService, migrateAccount } from './account.ts';
import { sweepArtifacts } from './artifacts.ts';
import { DEFAULT_ANIMATION } from '../shared/animation.ts';
import { DEFAULT_COLORS, DEFAULT_LAYOUT, FONT } from '../shared/recipe.ts';
// Private image files: owner-scoped upload, download, references and deletion against an isolated
// database and a temporary artifact root.
const pool = new Pool({ connectionString: process.env.ASKI_TEST_DATABASE_URL });
const inbox: { email: string; url: string }[] = [];
const origin = 'http://127.0.0.1:4179';
let root = '';
let service: ReturnType<typeof createAccountService>;
before(async () => {
  assert(process.env.ASKI_TEST_DATABASE_URL && process.env.ASKI_ACCOUNT_TEST === '1');
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'aski_test');
  root = await mkdtemp(join(tmpdir(), 'aski-artifacts-'));
  service = createAccountService({ pool, origin, artifactRoot: root, secret: 'synthetic-artifact-test-secret-with-adequate-entropy-0123456789', mailer: { send: async mail => { inbox.push(mail); } } });
  await migrateAccount(service.auth, pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE "verification", "session", "user", aski_request_limit CASCADE'); inbox.length = 0;
  for (const dir of ['objects', 'tmp']) for (const name of await readdir(join(root, dir)).catch(() => [])) await rm(join(root, dir, name), { force: true });
});
after(async () => { await pool.end(); await rm(root, { recursive: true, force: true }); });
let ip = 0;
async function signIn(email: string) {
  const peerIP = `198.51.100.${++ip}`;
  const send = (path: string, body: unknown) => service.app.fetch(new Request(origin + path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), { peerIP });
  assert.equal((await send('/api/sign-in/request', { email })).status, 200);
  const response = await send('/api/sign-in/confirm', { token: new URLSearchParams(new URL(inbox.at(-1)!.url).hash.slice(1)).get('token') });
  return response.headers.getSetCookie().find(cookie => cookie.startsWith('__Secure-better-auth.session_token='))!.split(';')[0];
}
const call = (method: string, path: string, cookie: string, body?: BodyInit, headers: Record<string, string> = {}, app = service.app) =>
  app.fetch(new Request(origin + path, { method, headers: { origin, cookie, ...headers }, body }), { peerIP: '192.0.2.1' });
function png(width: number, height: number, extra = 0) {
  const bytes = new Uint8Array(33 + extra); bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height); bytes[30] = extra % 256; return bytes;
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const query = (bytes: Uint8Array, width: number, height: number, sha256 = hash(bytes)) => new URLSearchParams({ sha256, width: String(width), height: String(height),
  variantId: FONT.variantId, fontSha256: FONT.sha256, rendererVersion: FONT.rendererVersion }).toString();
const upload = (cookie: string, id: string, bytes: Uint8Array, mime = 'image/png', width = 3, height = 2, extra: Record<string, string> = {}, search = query(bytes, width, height), app = service.app) =>
  call('PUT', `/api/artifacts/${id}?${search}`, cookie, bytes as BodyInit, { 'content-type': mime, ...extra }, app);
const design = (artifacts: string[]) => ({ name: 'With files', artifacts, recipe: { schemaVersion: 4, id: randomUUID(), input: 'HI', familyId: FONT.familyId, variantId: FONT.variantId,
  fontSha256: FONT.sha256, rendererVersion: FONT.rendererVersion, colors: DEFAULT_COLORS, layout: DEFAULT_LAYOUT, animation: DEFAULT_ANIMATION }, snapshot: { text: 'HI', columns: 2, rows: 1 } });
const mutate = (cookie: string, mutations: unknown[]) => call('POST', '/api/library/mutations', cookie, JSON.stringify({ protocolVersion: 1, deviceId: randomUUID(), mutations }), { 'content-type': 'application/json' });
const createDesign = (artifacts: string[], entityId = randomUUID()) => ({ requestId: randomUUID(), entityId, baseRevision: 0, type: 'design', schemaVersion: 1, payload: design(artifacts) });
test('an owner uploads, lists and downloads exact bytes; another account cannot read, reference or detect them', async () => {
  const a = await signIn('a@example.test'); const b = await signIn('b@example.test');
  const id = randomUUID(); const bytes = png(3, 2);
  const created = await upload(a, id, bytes); assert.equal(created.status, 201);
  const body = await created.json();
  assert.deepEqual({ ...body, createdAt: '' }, { id, sha256: hash(bytes), mime: 'image/png', byteLength: bytes.length, width: 3, height: 2, createdAt: '',
    provenance: { variantId: FONT.variantId, fontSha256: FONT.sha256, rendererVersion: FONT.rendererVersion } });
  assert.deepEqual((await (await call('GET', '/api/artifacts', a)).json()).artifacts.map((item: { id: string }) => item.id), [id]);
  const download = await call('GET', `/api/artifacts/${id}`, a);
  assert.equal(download.status, 200); assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
  for (const [name, value] of [['content-type', 'image/png'], ['cache-control', 'private, no-store'], ['x-content-type-options', 'nosniff']]) assert.equal(download.headers.get(name), value);
  assert.match(download.headers.get('content-disposition')!, /^attachment; filename="aski-[\da-f-]+\.png"$/); assert.match(download.headers.get('content-security-policy')!, /sandbox/);
  // B sees the same answer for A's file and an unused ID, and cannot list or reference A's file.
  const [foreign, unknown] = [await call('GET', `/api/artifacts/${id}`, b), await call('GET', `/api/artifacts/${randomUUID()}`, b)];
  assert.equal(foreign.status, 404); assert.deepEqual(await foreign.json(), await unknown.json());
  assert.deepEqual((await (await call('GET', '/api/artifacts', b)).json()).artifacts, []);
  const refused = await mutate(b, [createDesign([id])]); assert.equal(refused.status, 400); assert.equal((await refused.json()).code, 'artifact');
  assert.equal((await call('DELETE', `/api/artifacts/${id}`, b)).status, 404);
  // A's design can list it.
  assert.equal((await mutate(a, [createDesign([id])])).status, 200);
  // B may use the same ID for its own different file without affecting A's.
  assert.equal((await upload(b, id, png(4, 4), 'image/png', 4, 4)).status, 201);
  assert.deepEqual(new Uint8Array(await (await call('GET', `/api/artifacts/${id}`, a)).arrayBuffer()), bytes);
});
test('uploads must match their hash, type, size and the restricted SVG subset', async () => {
  const a = await signIn('a@example.test');
  const bytes = png(3, 2);
  assert.equal((await upload(a, randomUUID(), bytes, 'image/png', 3, 2, {}, query(bytes, 3, 2, 'f'.repeat(64)))).status, 400);
  assert.equal((await upload(a, randomUUID(), bytes, 'image/png', 3, 3)).status, 400);
  assert.equal((await upload(a, randomUUID(), bytes, 'image/gif')).status, 400);
  assert.equal((await upload(a, randomUUID(), bytes, 'text/html')).status, 415);
  const script = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2" viewBox="0 0 3 2"><script>alert(1)</script></svg>');
  const svg = await upload(a, randomUUID(), script, 'image/svg+xml'); assert.equal(svg.status, 400); assert.match((await svg.json()).message, /script/);
  assert.equal((await upload(a, randomUUID(), bytes, 'image/png', 3, 2, {}, query(bytes, 3, 2) + '&ownerId=someone')).status, 400);
  assert.equal((await upload(a, 'not-a-uuid', bytes)).status, 400);
  assert.equal((await upload(a, randomUUID(), png(3, 2, 32 * 1024 * 1024))).status, 413);
  assert.equal((await upload(a, randomUUID(), bytes, 'image/png', 3, 2, { origin: 'https://foreign.test' })).status, 403);
  assert.equal((await upload(a, randomUUID(), bytes, 'image/png', 3, 2, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await upload('', randomUUID(), bytes)).status, 401);
  assert.equal((await (await call('GET', '/api/artifacts', a)).json()).artifacts.length, 0);
  // Nothing refused was left on disk.
  assert.deepEqual(await readdir(join(root, 'objects')), []); assert.deepEqual(await readdir(join(root, 'tmp')), []);
});
test('a repeated upload is acknowledged once; different bytes under a used ID are refused', async () => {
  const a = await signIn('a@example.test'); const id = randomUUID();
  assert.equal((await upload(a, id, png(3, 2))).status, 201);
  const again = await upload(a, id, png(3, 2)); assert.equal(again.status, 200); assert.equal((await again.json()).id, id);
  assert.equal((await upload(a, id, png(3, 2, 1))).status, 409);
  assert.equal((await readdir(join(root, 'objects'))).length, 1);
});
test('a file is deleted only when no live design uses it, and stops being readable or referable', async () => {
  const a = await signIn('a@example.test'); const id = randomUUID(); const designId = randomUUID();
  await upload(a, id, png(3, 2));
  assert.equal((await mutate(a, [createDesign([id], designId), createDesign([id])])).status, 200);
  const library = (await (await call('GET', '/api/library', a)).json()).changes as { id: string; revision: number }[];
  assert.equal((await call('DELETE', `/api/artifacts/${id}`, a)).status, 409);
  assert.equal((await call('DELETE', `/api/artifacts/${id}`, a, undefined, { origin: 'https://foreign.test' })).status, 403);
  for (const record of library) assert.equal((await mutate(a, [{ requestId: randomUUID(), entityId: record.id, baseRevision: record.revision, delete: true }])).status, 200);
  assert.equal((await call('DELETE', `/api/artifacts/${id}`, a)).status, 200);
  assert.equal((await call('GET', `/api/artifacts/${id}`, a)).status, 404);
  assert.equal((await mutate(a, [createDesign([id])])).status, 400);
  assert.equal((await call('DELETE', `/api/artifacts/${id}`, a)).status, 404);
});
test('damaged bytes are reported, not served; services without an artifact root refuse files', async () => {
  const a = await signIn('a@example.test'); const id = randomUUID();
  await upload(a, id, png(3, 2));
  const [key] = await readdir(join(root, 'objects'));
  await writeFile(join(root, 'objects', key), png(3, 2, 9));
  const damaged = await call('GET', `/api/artifacts/${id}`, a); assert.equal(damaged.status, 500); assert.match((await damaged.json()).message, /damaged/);
  const plain = createAccountService({ pool, origin, secret: 'synthetic-artifact-test-secret-with-adequate-entropy-0123456789', mailer: null });
  assert.equal((await upload(a, randomUUID(), png(3, 2), 'image/png', 3, 2, {}, undefined, plain.app)).status, 503);
});
test('the sweep removes old temporary uploads, long-deleted files and unowned bytes, and keeps everything recent', async () => {
  const a = await signIn('a@example.test'); const kept = randomUUID(); const gone = randomUUID();
  await upload(a, kept, png(3, 2)); await upload(a, gone, png(3, 2, 1));
  await call('DELETE', `/api/artifacts/${gone}`, a);
  const goneKey = (await pool.query('SELECT storage_key FROM aski_artifact WHERE id = $1', [gone])).rows[0].storage_key;
  const keptKey = (await pool.query('SELECT storage_key FROM aski_artifact WHERE id = $1', [kept])).rows[0].storage_key;
  const day = 86400;
  const old = new Date(Date.now() - 2 * day * 1000);
  for (const name of ['stale-upload', 'fresh-upload']) await writeFile(join(root, 'tmp', name), 'x');
  for (const name of ['orphan-old', 'orphan-new']) await writeFile(join(root, 'objects', name), 'x');
  await utimes(join(root, 'tmp', 'stale-upload'), old, old); await utimes(join(root, 'objects', 'orphan-old'), old, old);
  await sweepArtifacts(pool, root);
  assert.deepEqual((await readdir(join(root, 'tmp'))).sort(), ['fresh-upload']);
  assert((await readdir(join(root, 'objects'))).includes(goneKey), 'a recently deleted file stays recoverable');
  await pool.query(`UPDATE aski_artifact SET deleted_at = NOW() - INTERVAL '31 days' WHERE id = $1`, [gone]);
  for (const name of [goneKey]) await utimes(join(root, 'objects', name), old, old);
  await sweepArtifacts(pool, root);
  assert.deepEqual((await readdir(join(root, 'objects'))).sort(), [keptKey, 'orphan-new'].sort());
  assert.equal((await pool.query('SELECT 1 FROM aski_artifact WHERE id = $1', [gone])).rowCount, 0);
  await rm(join(root, 'objects', 'orphan-new')); await rm(join(root, 'tmp', 'fresh-upload'));
});
