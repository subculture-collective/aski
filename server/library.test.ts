import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createAccountService, migrateAccount } from './account.ts';
import { DEFAULT_ANIMATION } from '../shared/animation.ts';
import { DEFAULT_COLORS, DEFAULT_LAYOUT, FONT } from '../shared/recipe.ts';
// Account library ownership, revisions, retries and rollback, against an isolated database with two accounts.
const pool = new Pool({ connectionString: process.env.ASKI_TEST_DATABASE_URL });
const inbox: { email: string; url: string }[] = [];
const origin = 'http://127.0.0.1:4179';
let service: ReturnType<typeof createAccountService>;
before(async () => {
  assert(process.env.ASKI_TEST_DATABASE_URL && process.env.ASKI_ACCOUNT_TEST === '1');
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'aski_test');
  service = createAccountService({ pool, origin, secret: 'synthetic-library-test-secret-with-adequate-entropy-0123456789', mailer: { send: async mail => { inbox.push(mail); } } });
  await migrateAccount(service.auth, pool);
});
beforeEach(async () => { await pool.query('TRUNCATE "verification", "session", "user", aski_request_limit CASCADE'); inbox.length = 0; });
after(async () => { await pool.end(); });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => service.app.fetch(new Request(origin + path,
  { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), { peerIP: '192.0.2.1' });
let ip = 0;
async function signIn(email: string) {
  // Each sign-in uses its own address so the verification limit never interferes.
  const peerIP = `198.51.100.${++ip}`;
  const send = (path: string, body: unknown) => service.app.fetch(new Request(origin + path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), { peerIP });
  assert.equal((await send('/api/sign-in/request', { email })).status, 200);
  const token = new URLSearchParams(new URL(inbox.at(-1)!.url).hash.slice(1)).get('token');
  const response = await send('/api/sign-in/confirm', { token }); assert.equal(response.status, 200);
  return response.headers.getSetCookie().find(cookie => cookie.startsWith('__Secure-better-auth.session_token='))!.split(';')[0];
}
const device = randomUUID();
const mutate = (cookie: string, mutations: unknown[], headers: Record<string, string> = {}) => post('/api/library/mutations', { protocolVersion: 1, deviceId: device, mutations }, { cookie, ...headers });
const read = (cookie: string, cursor = '') => service.app.fetch(new Request(origin + '/api/library' + (cursor ? '?cursor=' + cursor : ''), { headers: { cookie } }), { peerIP: '192.0.2.1' });
const create = (type: string, payload: unknown, entityId = randomUUID()) => ({ requestId: randomUUID(), entityId, baseRevision: 0, type, schemaVersion: 1, payload });
const update = (record: { id: string; type: string; revision: number }, payload: unknown) => ({ requestId: randomUUID(), entityId: record.id, baseRevision: record.revision, type: record.type, schemaVersion: 1, payload });
const remove = (record: { id: string; revision: number }) => ({ requestId: randomUUID(), entityId: record.id, baseRevision: record.revision, delete: true });
const design = (name: string) => ({ name, recipe: { schemaVersion: 4, id: randomUUID(), input: 'HI', familyId: FONT.familyId, variantId: FONT.variantId, fontSha256: FONT.sha256,
  rendererVersion: FONT.rendererVersion, colors: DEFAULT_COLORS, layout: DEFAULT_LAYOUT, animation: DEFAULT_ANIMATION }, snapshot: { text: 'HI', columns: 2, rows: 1 } });
async function all(cookie: string) {
  const changes = []; let cursor = '';
  for (;;) { const body = await (await read(cookie, cursor)).json(); changes.push(...body.changes); cursor = body.cursor; if (!body.more) return { changes, cursor }; }
}
const count = async () => Number((await pool.query('SELECT COUNT(*) AS n FROM aski_library_record')).rows[0].n);
test('an owner saves, lists, renames and deletes records; deleting a collection removes only its memberships', async () => {
  const a = await signIn('a@example.test');
  const collection = create('collection', { name: 'Keep' }); const item = create('design', design('Hello'));
  const favorite = create('favorite', { familyId: FONT.familyId });
  const link = create('membership', { collectionId: collection.entityId, itemType: 'design', itemId: item.entityId });
  const saved = await mutate(a, [collection, item, favorite, link, create('input', { text: 'words', name: 'Words' }), create('palette', { name: 'Ink', slots: DEFAULT_COLORS })]);
  assert.equal(saved.status, 200); assert.equal(saved.headers.get('cache-control'), 'no-store');
  const body = await saved.json();
  assert.deepEqual(body.results.map((r: { revision: number }) => r.revision), [1, 1, 1, 1, 1, 1]);
  const { changes, cursor } = await all(a);
  assert.equal(changes.length, 6); assert(changes.every((r: { revision: number; deletedAt: null }) => r.revision === 1 && r.deletedAt === null));
  assert.equal(changes.find((r: { id: string }) => r.id === item.entityId).payload.snapshot.text, 'HI');
  const stored = changes.find((r: { id: string }) => r.id === collection.entityId);
  const renamed = await (await mutate(a, [update(stored, { name: 'Renamed' })])).json();
  assert.equal(renamed.changes[0].payload.name, 'Renamed'); assert.equal(renamed.changes[0].revision, 2);
  // Only the change since the cursor comes back.
  const since = await (await read(a, cursor)).json();
  assert.deepEqual(since.changes.map((r: { id: string }) => r.id), [collection.entityId]);
  const deleted = await (await mutate(a, [remove(renamed.changes[0])])).json();
  assert.deepEqual(new Set(deleted.changes.map((r: { id: string }) => r.id)), new Set([collection.entityId, link.entityId]));
  assert(deleted.changes.every((r: { deletedAt: string | null; payload: unknown }) => r.deletedAt && r.payload === null));
  const after = (await all(a)).changes;
  assert.equal(after.filter((r: { deletedAt: string | null }) => !r.deletedAt).length, 4);
  assert(after.find((r: { id: string }) => r.id === item.entityId).deletedAt === null);
  // A tombstone is never edited or recreated under the same ID.
  const tombstone = after.find((r: { id: string }) => r.id === collection.entityId);
  for (const change of [update(tombstone, { name: 'Back' }), remove(tombstone), create('collection', { name: 'Back' }, collection.entityId)]) {
    const refused = await mutate(a, [change]); assert.equal(refused.status, 409); assert.equal((await refused.json()).record.deletedAt, tombstone.deletedAt);
  }
});
test('another account cannot read, change, delete or reference records, and missing and foreign IDs look the same', async () => {
  const a = await signIn('a@example.test'); const b = await signIn('b@example.test');
  const collection = create('collection', { name: 'Private' }); const item = create('design', design('Secret'));
  assert.equal((await mutate(a, [collection, item])).status, 200);
  assert.deepEqual((await all(b)).changes, []);
  const foreign = { id: collection.entityId, type: 'collection', revision: 1 }; const unknown = { id: randomUUID(), type: 'collection', revision: 1 };
  for (const [one, other] of [[update(foreign, { name: 'Taken' }), update(unknown, { name: 'Taken' })], [remove(foreign), remove(unknown)]]) {
    const [x, y] = [await mutate(b, [one]), await mutate(b, [other])];
    assert.equal(x.status, 404); assert.equal(y.status, 404); assert.deepEqual(await x.json(), await y.json());
  }
  // A batch that references another account's records fails as a whole: B's own collection is not kept.
  const own = create('collection', { name: 'Mine' });
  const refused = await mutate(b, [own, create('membership', { collectionId: own.entityId, itemType: 'design', itemId: item.entityId })]);
  assert.equal(refused.status, 400);
  const into = await mutate(b, [create('collection', { name: 'x' }), create('membership', { collectionId: collection.entityId, itemType: 'design', itemId: item.entityId })]);
  assert.equal(into.status, 400);
  assert.deepEqual((await all(b)).changes, []);
  // B can use the same UUID for its own record without learning anything about A's.
  assert.equal((await mutate(b, [create('collection', { name: 'Same ID' }, collection.entityId)])).status, 200);
  assert.equal((await all(a)).changes.find((r: { id: string }) => r.id === collection.entityId).payload.name, 'Private');
  // A client-supplied owner is not accepted.
  const owned = await post('/api/library/mutations', { protocolVersion: 1, deviceId: device, ownerId: 'someone', mutations: [create('collection', { name: 'x' })] }, { cookie: b });
  assert.equal(owned.status, 400);
  assert.equal((await mutate(b, [{ ...create('collection', { name: 'x' }), ownerId: 'someone' }])).status, 400);
});
test('a stale revision returns 409 with the current record and keeps no part of the batch', async () => {
  const a = await signIn('a@example.test');
  const item = create('input', { text: 'one', name: 'One' }); await mutate(a, [item]);
  const first = { id: item.entityId, type: 'input', revision: 1 };
  assert.equal((await mutate(a, [update(first, { text: 'one', name: 'Device A' })])).status, 200);
  const before = await count();
  const stale = await mutate(a, [create('collection', { name: 'Extra' }), update(first, { text: 'one', name: 'Device B' })]);
  assert.equal(stale.status, 409);
  const body = await stale.json(); assert.equal(body.record.revision, 2); assert.equal(body.record.payload.name, 'Device A');
  assert.equal(await count(), before);
});
test('a retry with the same bytes returns the original result; changed bytes under the same ID are refused', async () => {
  const a = await signIn('a@example.test');
  const item = create('collection', { name: 'Once' });
  const first = await (await mutate(a, [item])).json();
  const again = await mutate(a, [item]); assert.equal(again.status, 200);
  assert.deepEqual((await again.json()).results, first.results);
  assert.equal(await count(), 1); assert.equal((await all(a)).changes.length, 1);
  const changed = await mutate(a, [{ ...item, payload: { name: 'Twice' } }]);
  assert.equal(changed.status, 409); assert.match((await changed.json()).message, /already used/);
  assert.equal((await all(a)).changes[0].payload.name, 'Once');
});
test('payloads, references and envelopes are validated before anything is written', async () => {
  const a = await signIn('a@example.test');
  const refusals: [unknown[], RegExp][] = [
    [[create('favorite', { familyId: 'no-such-font' })], /not available/],
    [[create('collection', { name: '' })], /name/],
    [[create('collection', { name: 'x'.repeat(121) })], /name/],
    [[create('palette', { name: 'Bad', slots: { foreground: 'red' } })], /#RRGGBB/],
    [[create('design', { ...design('Files'), artifacts: [randomUUID()] })], /Image files/],
    [[{ ...create('collection', { name: 'x' }), schemaVersion: 2 }], /version/],
    [[{ ...create('collection', { name: 'x' }), type: 'artifact' }], /Invalid/],
    [[{ ...create('collection', { name: 'x' }), entityId: 'not-a-uuid' }], /Invalid/],
    [[{ ...create('collection', { name: 'x' }), baseRevision: -1 }], /Invalid/],
  ];
  for (const [mutations, message] of refusals) {
    const response = await mutate(a, mutations); assert.equal(response.status, 400, String(message)); assert.match((await response.json()).message, message);
  }
  assert.equal((await post('/api/library/mutations', { protocolVersion: 2, deviceId: device, mutations: [create('collection', { name: 'x' })] }, { cookie: a })).status, 400);
  assert.equal((await mutate(a, [])).status, 400);
  assert.equal((await mutate(a, Array.from({ length: 101 }, () => create('collection', { name: 'x' })))).status, 400);
  // Favorites are unique by family and variant within one owner.
  assert.equal((await mutate(a, [create('favorite', { familyId: FONT.familyId })])).status, 200);
  assert.equal((await mutate(a, [create('favorite', { familyId: FONT.familyId })])).status, 409);
  assert.equal(await count(), 1);
});
test('the library requires a session, same-origin JSON writes and bounded bodies', async () => {
  const a = await signIn('a@example.test');
  assert.equal((await read('')).status, 401);
  assert.equal((await mutate('', [create('collection', { name: 'x' })])).status, 401);
  assert.equal((await mutate(a, [create('collection', { name: 'x' })], { origin: 'https://foreign.test' })).status, 403);
  assert.equal((await mutate(a, [create('collection', { name: 'x' })], { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await mutate(a, [create('input', { text: 'x'.repeat(2.1 * 1024 * 1024), name: 'Big' })])).status, 413);
  // Signing out ends library access at once.
  assert.equal((await post('/api/sign-out', {}, { cookie: a })).status, 200);
  assert.equal((await read(a)).status, 401);
  assert.equal(await count(), 0);
});
test('reads page through the change log; unknown or future cursors ask for a full resync', async () => {
  const a = await signIn('a@example.test');
  await mutate(a, Array.from({ length: 100 }, (_, i) => create('collection', { name: `C${i}` })));
  await mutate(a, Array.from({ length: 5 }, (_, i) => create('collection', { name: `D${i}` })));
  const first = await (await read(a)).json(); assert.equal(first.changes.length, 100); assert.equal(first.more, true);
  const second = await (await read(a, first.cursor)).json(); assert.equal(second.changes.length, 5); assert.equal(second.more, false);
  assert.equal(new Set([...first.changes, ...second.changes].map(r => r.id)).size, 105);
  for (const cursor of ['garbage', Buffer.from('v1:999999').toString('base64url')]) assert.equal((await (await read(a, cursor)).json()).resync, true);
});
test('writes are limited to 120 per owner per minute with Retry-After', async () => {
  const a = await signIn('a@example.test');
  for (let i = 0; i < 120; i++) assert.equal((await mutate(a, [create('collection', { name: `C${i}` })])).status, 200);
  const limited = await mutate(a, [create('collection', { name: 'over' })]);
  assert.equal(limited.status, 429); assert(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(await count(), 120);
});
