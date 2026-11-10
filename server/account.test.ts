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
beforeEach(async () => { await pool.query('TRUNCATE "verification", "user", aski_request_limit CASCADE'); inbox.length = 0; });
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
