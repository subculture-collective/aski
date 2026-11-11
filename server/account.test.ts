import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { createAccountService, migrateAccount } from './account.ts';
import { brevoMailer } from './mail.ts';
const pool = new Pool({ connectionString: process.env.ASKI_TEST_DATABASE_URL });
const inbox: { email: string; url: string }[] = [];
const options = { pool, origin: 'http://127.0.0.1:4179', secret: 'synthetic-account-test-secret-with-adequate-entropy-0123456789', mailer: { send: async (mail: { email: string; url: string }) => { inbox.push(mail); } } };
let service: ReturnType<typeof createAccountService>;
before(async () => { assert(process.env.ASKI_TEST_DATABASE_URL && process.env.ASKI_ACCOUNT_TEST === '1'); assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name,'aski_test'); service = createAccountService(options); await migrateAccount(service.auth, pool); });
beforeEach(async () => { await pool.query('TRUNCATE "verification", "session", "user", aski_request_limit CASCADE'); inbox.length = 0; });
after(async () => { await pool.end(); });
function request(email: string, ip = '192.0.2.1', app = service.app, extra: Record<string, unknown> = {}) {
  return app.fetch(new Request(options.origin + '/api/sign-in/request', { method: 'POST', headers: { origin: options.origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, ...extra }) }), { peerIP: ip });
}
test('new/existing addresses receive equivalent acknowledgements; only hashed expiring tokens persist', async () => {
  const first = await request('new@example.test'); assert.equal(first.status, 200);
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,NOW(),NOW())', ['test-user','Test','existing@example.test']);
  const second = await request('existing@example.test', '192.0.2.2');
  assert.equal(second.status, first.status); assert.deepEqual(await second.json(), await first.json());
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const rows = (await pool.query('SELECT * FROM verification')).rows;
  assert.equal(rows.length, 2);
  for (const mail of inbox) {
    const url = new URL(mail.url); assert.equal(url.pathname, '/auth/confirm'); assert.equal(url.search, '');
    const token = new URLSearchParams(url.hash.slice(1)).get('token')!; assert(token.length >= 32);
    assert.equal(JSON.stringify(rows).includes(token), false);
    assert(rows.every(row => String(row.identifier).startsWith('magic-link:')));
    assert(rows.every(row => row.expiresAt.getTime() - Date.now() > 590_000 && row.expiresAt.getTime() - Date.now() <= 600_000));
  }
  await pool.query(`UPDATE verification SET "expiresAt" = NOW() - INTERVAL '1 second'`);
  assert.equal((await request('another@example.test')).status,200);
  assert.equal((await pool.query('SELECT * FROM verification')).rowCount,1);
});
test('address limits are atomic, normalized and persist across service instances', async () => {
  const replies = await Promise.all(Array.from({ length: 6 }, () => request(' Same@Example.test ')));
  assert.equal(replies.filter(r => r.status === 200).length, 5);
  assert.equal(replies.filter(r => r.status === 429).length, 1);
  const another = createAccountService(options);
  const limited = await request('same@example.test', '192.0.2.44', another.app);
  assert.equal(limited.status, 429); assert(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(inbox.length, 5);
  const stored = (await pool.query('SELECT key FROM aski_request_limit')).rows;
  assert.equal(JSON.stringify(stored).includes('same@'), false);
  await pool.query("UPDATE aski_request_limit SET expires_at = NOW() - INTERVAL '1 second'");
  assert.equal((await request('same@example.test')).status, 200);
});
test('IP limit ignores forged forwarding headers and caps independent addresses', async () => {
  for (let i = 0; i < 20; i++) assert.equal((await request(`test${i}@example.test`)).status, 200);
  const response = await service.app.fetch(new Request(options.origin + '/api/sign-in/request', { method: 'POST', headers: { origin: options.origin, 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.99', 'x-real-ip': '192.0.2.99' }, body: JSON.stringify({ email: 'another@example.test' }) }), { peerIP: '192.0.2.1' });
  assert.equal(response.status, 429); assert.equal(inbox.length, 20);
});
test('origin, content type, body size, address and callback boundaries reject before mail', async () => {
  for (const headers of [{ origin: 'https://foreign.test', 'content-type': 'application/json' }, { 'content-type': 'application/json' }, { origin: options.origin, 'content-type': 'text/plain' }] as Record<string,string>[]) {
    const r = await service.app.fetch(new Request(options.origin + '/api/sign-in/request', { method: 'POST', headers, body: JSON.stringify({ email: 'new@example.test' }) }), { peerIP: '192.0.2.1' });
    assert([403,415].includes(r.status));
  }
  assert.equal((await request('bad')).status, 400);
  assert.equal((await request('new@example.test','192.0.2.1',service.app,{ callbackURL:'https://foreign.test' })).status, 400);
  assert.equal((await request('a'.repeat(5000))).status, 413);
  assert.equal((await service.app.fetch(new Request(options.origin + '/api/auth/magic-link/verify?token=synthetic'))).status, 404);
  assert.equal(inbox.length, 0);
});
test('mail configuration/delivery failures are safe and revoke the undelivered token', async () => {
  const unavailable = createAccountService({ ...options, mailer: null });
  assert.equal((await request('new@example.test', '192.0.2.1', unavailable.app)).status, 503);
  const failed = createAccountService({ ...options, mailer: { send: async () => { throw new Error('Private provider detail'); } } });
  const response = await request('new@example.test', '192.0.2.1', failed.app);
  assert.equal(response.status, 503); assert.equal((await response.text()).includes('Private'), false);
  assert.equal((await pool.query('SELECT * FROM verification')).rowCount, 0);
});
test('only configured ingress peers may supply a single validated client address', async () => {
  const proxied = createAccountService({ ...options, trustedProxyCIDRs: ['192.0.2.200/32'] });
  const call = (ip: string) => proxied.app.fetch(new Request(options.origin+'/api/sign-in/request', { method:'POST',headers:{origin:options.origin,'content-type':'application/json','x-real-ip':ip},body:JSON.stringify({email:'new@example.test'}) }),{peerIP:'192.0.2.200'});
  assert.equal((await call('198.51.100.1')).status,200);
  assert.equal((await call('198.51.100.1,198.51.100.2')).status,503);
  assert.throws(()=>createAccountService({...options,trustedProxyCIDRs:['not-an-address']}),/proxy/);
});
test('Brevo adapter submits transactional mail only and rejects provider failures', async () => {
  let called = false;
  const mailer = brevoMailer('synthetic-key', 'aski@example.test', async (url, init) => {
    called = true; assert.equal(String(url), 'https://api.brevo.com/v3/smtp/email');
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.to[0].email, 'new@example.test'); assert.equal(payload.subject, 'Your aski sign-in link');
    assert.equal(payload.textContent.includes('synthetic-link'), true); assert.equal(payload.listIds, undefined);
    return new Response('{}', { status: 201 });
  });
  await mailer.send({ email:'new@example.test',url:'https://aski.example.test/auth/confirm#token=synthetic-link' }); assert(called);
  await assert.rejects(brevoMailer('synthetic-key','aski@example.test',async()=>new Response('',{status:401})).send({email:'new@example.test',url:'synthetic'}), /Mail unavailable/);
});
// Session redemption. Tokens are read from the capture inbox only inside this isolated test process.
const tokenOf = (index = inbox.length - 1) => new URLSearchParams(new URL(inbox[index].url).hash.slice(1)).get('token')!;
function write(path: string, body: unknown, headers: Record<string, string> = {}, ip = '192.0.2.1', app = service.app) {
  return app.fetch(new Request(options.origin + path, { method: 'POST', headers: { origin: options.origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), { peerIP: ip });
}
const confirm = (token: string, ip?: string, app?: typeof service.app) => write('/api/sign-in/confirm', { token }, {}, ip, app);
const sessionCookie = (response: Response) => response.headers.getSetCookie().find(cookie => cookie.startsWith('__Secure-better-auth.session_token='))!;
const session = (cookie: string) => service.app.fetch(new Request(options.origin + '/api/session', { headers: { cookie: cookie.split(';')[0] } }), { peerIP: '192.0.2.1' });
const signOut = (cookie: string, headers: Record<string, string> = {}) => write('/api/sign-out', {}, { cookie: cookie.split(';')[0], ...headers });
const count = async (table: string) => Number((await pool.query(`SELECT COUNT(*) AS n FROM "${table}"`)).rows[0].n);
async function signedIn(email = 'reader@example.test') {
  assert.equal((await request(email)).status, 200);
  const response = await confirm(tokenOf()); assert.equal(response.status, 200);
  return sessionCookie(response);
}
test('a valid link mints one secure host-only session and never returns a token', async () => {
  assert.equal((await request('reader@example.test')).status, 200);
  const token = tokenOf(); const response = await confirm(token);
  assert.equal(response.status, 200);
  const text = await response.text(); assert.equal(text, JSON.stringify({ message: 'You are signed in.' }));
  const cookie = sessionCookie(response); const attributes = cookie.split(';').slice(1).map(part => part.trim().toLowerCase());
  for (const flag of ['secure', 'httponly', 'samesite=lax', 'path=/', 'max-age=604800']) assert(attributes.includes(flag), flag);
  assert(!attributes.some(part => part.startsWith('domain=')), 'host-only');
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('location'), null);
  const rows = (await pool.query('SELECT token, "expiresAt", "createdAt" FROM session')).rows;
  assert.equal(rows.length, 1); assert.equal(text.includes(rows[0].token), false); assert.equal(cookie.includes(token), false);
  assert.equal(rows[0].expiresAt.getTime() - rows[0].createdAt.getTime() >= 604_799_000, true);
  assert.equal(await count('verification'), 0);
  assert.deepEqual(await (await session(cookie)).json(), { signedIn: true, email: 'reader@example.test' });
});
test('replayed, expired, malformed and foreign links mint no session', async () => {
  const cookie = await signedIn(); assert(cookie);
  const replay = await confirm(tokenOf());
  assert.equal(replay.status, 400); assert.match((await replay.json()).message, /Request a new link/);
  assert.equal(replay.headers.getSetCookie().length, 0);
  assert.equal((await request('late@example.test', '192.0.2.2')).status, 200);
  await pool.query(`UPDATE verification SET "expiresAt" = NOW() - INTERVAL '1 second'`);
  assert.equal((await confirm(tokenOf(), '192.0.2.2')).status, 400);
  assert.equal((await confirm('a'.repeat(32), '192.0.2.3')).status, 400);
  assert.equal((await confirm('not a token', '192.0.2.3')).status, 400);
  assert.equal((await write('/api/sign-in/confirm', { token: tokenOf(), callbackURL: 'https://foreign.test' }, {}, '192.0.2.3')).status, 400);
  assert.equal(await count('session'), 1);
});
test('simultaneous redemptions across service instances mint exactly one session', async () => {
  assert.equal((await request('race@example.test')).status, 200);
  const token = tokenOf(); const other = createAccountService(options);
  const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => confirm(token, `198.51.100.${i + 1}`, i % 2 ? other.app : service.app)));
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 400, 400, 400, 400, 400, 400, 400]);
  assert.equal(replies.flatMap(r => r.headers.getSetCookie()).length, 1);
  assert.equal(await count('session'), 1);
});
test('confirmation rejects cross-origin, non-JSON and GET attempts without consuming the link', async () => {
  assert.equal((await request('csrf@example.test')).status, 200);
  const token = tokenOf();
  for (const headers of [{ origin: 'https://foreign.test' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }, { 'content-type': 'application/x-www-form-urlencoded' }] as Record<string, string>[])
    assert([403, 415].includes((await write('/api/sign-in/confirm', { token }, headers)).status));
  assert.equal((await service.app.fetch(new Request(options.origin + '/api/sign-in/confirm?token=' + token), { peerIP: '192.0.2.1' })).status, 404);
  assert.equal(await count('session'), 0);
  assert.equal((await confirm(token)).status, 200);
});
test('verification attempts are limited to 10 per IP per 10 minutes across instances', async () => {
  const other = createAccountService(options);
  for (let i = 0; i < 10; i++) assert.equal((await confirm('b'.repeat(32), '203.0.113.9', i % 2 ? other.app : service.app)).status, 400);
  const limited = await confirm('b'.repeat(32), '203.0.113.9');
  assert.equal(limited.status, 429); assert(Number(limited.headers.get('retry-after')) > 500);
  assert.equal((await confirm('b'.repeat(32), '203.0.113.10')).status, 400);
  assert.equal(JSON.stringify((await pool.query('SELECT key FROM aski_request_limit')).rows).includes('203.0.113'), false);
});
test('sign-out revokes the database session, clears the cookie and refuses cross-origin requests', async () => {
  const cookie = await signedIn();
  assert.equal((await signOut(cookie, { origin: 'https://foreign.test' })).status, 403);
  assert.equal((await signOut(cookie, { 'content-type': 'text/plain' })).status, 415);
  assert.equal(await count('session'), 1);
  const response = await signOut(cookie);
  assert.equal(response.status, 200);
  assert(response.headers.getSetCookie().some(value => value.startsWith('__Secure-better-auth.session_token=;') && /max-age=0/i.test(value)));
  assert.equal(await count('session'), 0);
  assert.deepEqual(await (await session(cookie)).json(), { signedIn: false });
  assert.equal((await signOut(cookie)).status, 200);
});
test('revoked sessions and unsigned cookies are rejected', async () => {
  const cookie = await signedIn();
  await pool.query('DELETE FROM session');
  const revoked = await session(cookie);
  assert.deepEqual(await revoked.json(), { signedIn: false });
  assert(revoked.headers.getSetCookie().some(value => /max-age=0/i.test(value)));
  const forged = cookie.split(';')[0].replace(/=([^.]+)\./, '=forged.');
  assert.deepEqual(await (await session(forged)).json(), { signedIn: false });
});
test('refresh happens after 24 hours but never extends the 7-day absolute lifetime', async () => {
  const cookie = await signedIn();
  assert.equal((await session(cookie)).headers.getSetCookie().length, 0);
  await pool.query(`UPDATE session SET "createdAt" = "createdAt" - INTERVAL '2 days', "updatedAt" = "updatedAt" - INTERVAL '2 days', "expiresAt" = "expiresAt" - INTERVAL '2 days'`);
  const refreshed = await session(cookie);
  assert.equal((await refreshed.json()).signedIn, true);
  const maxAge = Number(/max-age=(\d+)/i.exec(sessionCookie(refreshed))![1]);
  assert(maxAge <= 5 * 86400 && maxAge > 5 * 86400 - 60, String(maxAge));
  const row = (await pool.query('SELECT "createdAt", "updatedAt", "expiresAt" FROM session')).rows[0];
  assert.equal(row.expiresAt.getTime(), row.createdAt.getTime() + 7 * 86400_000);
  assert(Date.now() - row.updatedAt.getTime() < 60_000);
  await pool.query(`UPDATE session SET "createdAt" = "createdAt" - INTERVAL '5 days 1 minute', "updatedAt" = "updatedAt" - INTERVAL '2 days'`);
  const expired = await session(cookie);
  assert.deepEqual(await expired.json(), { signedIn: false });
  assert(expired.headers.getSetCookie().some(value => /max-age=0/i.test(value)));
  assert.equal(await count('session'), 0);
  const lapsed = await signedIn('lapsed@example.test');
  await pool.query(`UPDATE session SET "expiresAt" = NOW() - INTERVAL '1 second'`);
  assert.deepEqual(await (await session(lapsed)).json(), { signedIn: false });
  assert.equal(await count('session'), 0);
});
