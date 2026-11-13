import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import { createHash, createHmac } from 'node:crypto';
import { isIP, BlockList } from 'node:net';
import type { Pool } from 'pg';
import type { Mailer } from './mail.ts';
import { migrateLibrary, mountLibrary } from './library.ts';
export interface AccountOptions { pool: Pool; origin: string; secret: string; mailer: Mailer | null; trustedProxyCIDRs?: string[] }
export type AccountEnv = { Bindings: { peerIP: string } };
const LIFETIME = 7 * 86400;
const REFRESH = 86400;
const normalizeIP = (ip: string) => ip.startsWith('::ffff:') ? ip.slice(7) : ip;
export function createAccountService(options: AccountOptions) {
  const { pool, origin, secret, mailer } = options;
  if (new URL(origin).origin !== origin || (new URL(origin).protocol !== 'https:' && !['127.0.0.1','localhost'].includes(new URL(origin).hostname)) || secret.length < 32) throw new Error('Invalid account configuration');
  const trusted = new BlockList();
  for (const value of options.trustedProxyCIDRs || []) {
    const [network, prefix] = value.split('/'); const version = isIP(network);
    if (!version) throw new Error('Invalid trusted proxy configuration');
    const type = version === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) trusted.addAddress(network,type);
    else { if (!/^\d+$/.test(prefix)) throw new Error('Invalid trusted proxy configuration'); trusted.addSubnet(network,Number(prefix),type); }
  }
  const auth = betterAuth({
    database: pool, baseURL: origin, secret, trustedOrigins: [origin],
    logger: { disabled: true }, verification: { storeIdentifier: 'plain' },
    session: { expiresIn: LIFETIME, updateAge: REFRESH },
    advanced: { useSecureCookies: true },
    // Public Better Auth routes are not mounted. The request wrapper enforces
    // atomic PostgreSQL limits before calling the server API, which bypasses
    // Better Auth's HTTP rate-limit middleware.
    plugins: [magicLink({ expiresIn: 600, storeToken: 'hashed', sendMagicLink: async ({ email, token }) => {
      try {
        if (!mailer) throw new Error('Mail unavailable');
        const link = new URL('/auth/confirm', origin); link.hash = new URLSearchParams({ token }).toString();
        await mailer.send({ email, url: link.toString() });
      } catch {
        const identifier = 'magic-link:' + createHash('sha256').update(token).digest('base64url');
        await pool.query('DELETE FROM verification WHERE identifier = $1', [identifier]);
        throw new Error('Mail unavailable');
      }
    } })],
  });
  // Atomic PostgreSQL counters, shared by every service instance. Rows hold HMAC keys, never raw addresses or IPs.
  async function reserve(limits: { kind: string; value: string; max: number }[], seconds: number): Promise<number> {
    const keys = limits.map(item => ({ key: item.kind + ':' + createHmac('sha256', secret).update(item.value).digest('hex'), max: item.max })).sort((a,b) => a.key.localeCompare(b.key));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM aski_request_limit WHERE expires_at <= NOW()');
      await client.query('DELETE FROM verification WHERE "expiresAt" <= NOW() AND identifier LIKE $1', ['magic-link:%']);
      let retry = 0;
      for (const item of keys) {
        const result = await client.query(`INSERT INTO aski_request_limit (key,count,expires_at) VALUES ($1,1,NOW()+make_interval(secs => $2))
          ON CONFLICT (key) DO UPDATE SET count=aski_request_limit.count+1
          RETURNING count, EXTRACT(EPOCH FROM expires_at-NOW()) AS remaining`, [item.key, seconds]);
        if (result.rows[0].count > item.max) retry = Math.max(retry, Math.ceil(Number(result.rows[0].remaining)));
      }
      await client.query(retry ? 'ROLLBACK' : 'COMMIT'); return retry;
    } catch { await client.query('ROLLBACK'); throw new Error('Account unavailable'); }
    finally { client.release(); }
  }
  // Same-origin JSON writes only: exact Origin, no cross-site fetch metadata and a JSON content type,
  // which a cross-origin form cannot send without a CORS preflight that this service never answers.
  function rejectWrite(c: Context<AccountEnv>) {
    if (c.req.header('origin') !== origin || c.req.header('sec-fetch-site') === 'cross-site') return c.json({ message: 'This request is not allowed.' }, 403);
    if (c.req.header('content-type')?.split(';')[0].trim() !== 'application/json') return c.json({ message: 'Use JSON.' }, 415);
    return null;
  }
  async function jsonBody(c: Context<AccountEnv>): Promise<Record<string, unknown> | null> {
    try { const body: unknown = await c.req.json(); return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null; } catch { return null; }
  }
  function clientIP(c: Context<AccountEnv>) {
    let ip = normalizeIP(c.env?.peerIP || '');
    if (isIP(ip) && trusted.check(ip,isIP(ip) === 4 ? 'ipv4' : 'ipv6')) ip = normalizeIP(c.req.header('x-real-ip') || '');
    return isIP(ip) ? ip : '';
  }
  const forwardCookies = (c: Context<AccountEnv>, headers: Headers) => { for (const cookie of headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true }); };
  const app = new Hono<AccountEnv>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control','no-store'); c.header('Referrer-Policy','no-referrer'); c.header('X-Content-Type-Options','nosniff');
    await next();
  });
  app.onError((_, c) => c.json({ message: 'Accounts are unavailable. Try again later.' }, 503));
  const limitBody = bodyLimit({ maxSize: 4096, onError: c => c.json({ message: 'Request is too large.' }, 413) });
  app.post('/api/sign-in/request', limitBody, async c => {
    const rejected = rejectWrite(c); if (rejected) return rejected;
    const body = await jsonBody(c);
    if (!body || Object.keys(body).length !== 1 || typeof body.email !== 'string') return c.json({ message: 'Enter a valid email address.' }, 400);
    const email = body.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ message: 'Enter a valid email address.' }, 400);
    const ip = clientIP(c);
    if (!ip) return c.json({ message: 'Sign-in is unavailable. Try again later.' }, 503);
    try {
      const retry = await reserve([{ kind: 'address', value: email, max: 5 }, { kind: 'ip', value: ip, max: 20 }], 3600);
      if (retry) { c.header('Retry-After', String(retry)); return c.json({ message: 'Too many requests. Try again later.' }, 429); }
      if (!mailer) return c.json({ message: 'Sign-in is unavailable. Try again later.' }, 503);
      await auth.api.signInMagicLink({ body: { email, callbackURL: '/' }, headers: new Headers({ origin }) });
      return c.json({ message: 'Check your inbox for a sign-in link.' });
    } catch { return c.json({ message: 'Sign-in is unavailable. Try again later.' }, 503); }
  });
  // Deliberate confirmation from /auth/confirm. Better Auth's consuming GET endpoint is never mounted;
  // its server API consumes the hashed token with one DELETE ... RETURNING, so concurrent or replayed
  // redemptions mint at most one session. The token is never echoed, logged or redirected.
  const invalidLink = 'This sign-in link is invalid, expired or already used. Request a new link from the studio.';
  app.post('/api/sign-in/confirm', limitBody, async c => {
    const rejected = rejectWrite(c); if (rejected) return rejected;
    const ip = clientIP(c);
    if (!ip) return c.json({ message: 'Sign-in is unavailable. Try again later.' }, 503);
    const retry = await reserve([{ kind: 'verify-ip', value: ip, max: 10 }], 600);
    if (retry) { c.header('Retry-After', String(retry)); return c.json({ message: 'Too many attempts. Try again later.' }, 429); }
    const body = await jsonBody(c);
    if (!body || Object.keys(body).length !== 1 || typeof body.token !== 'string' || !/^[A-Za-z0-9]{32,128}$/.test(body.token)) return c.json({ message: invalidLink }, 400);
    const response = await auth.api.magicLinkVerify({ query: { token: body.token }, headers: new Headers({ origin }), asResponse: true });
    // Better Auth answers every unusable token (unknown, expired, used) with an error redirect.
    if (response.status >= 300 && response.status < 400) return c.json({ message: invalidLink }, 400);
    if (response.status !== 200) return c.json({ message: 'Sign-in is unavailable. Try again later.' }, 503);
    forwardCookies(c, response.headers);
    return c.json({ message: 'You are signed in.' });
  });
  // Better Auth refreshes an active session by sliding its expiry forward. The contract sets a 7-day
  // absolute lifetime, so a refresh is clamped to the session's creation time plus 7 days, and an
  // older session is revoked. Better Auth decides when to refresh from the expiry, which the clamp
  // pins, so the session is read without refresh and refreshed only when updatedAt is 24 hours old.
  app.get('/api/session', async c => {
    const read = (disableRefresh: boolean) => auth.api.getSession({ headers: c.req.raw.headers, query: { disableRefresh }, returnHeaders: true });
    let { headers, response } = await read(true);
    if (!response) { forwardCookies(c, headers); return c.json({ signedIn: false }); }
    const end = response.session.createdAt.getTime() + LIFETIME * 1000;
    if (end <= Date.now()) {
      forwardCookies(c, (await auth.api.signOut({ headers: c.req.raw.headers, asResponse: true })).headers);
      return c.json({ signedIn: false });
    }
    if (response.session.updatedAt.getTime() + REFRESH * 1000 <= Date.now()) {
      ({ headers, response } = await read(false));
      if (!response) { forwardCookies(c, headers); return c.json({ signedIn: false }); }
    }
    if (response.session.expiresAt.getTime() > end) await pool.query('UPDATE session SET "expiresAt" = $2 WHERE id = $1', [response.session.id, new Date(end)]);
    const remaining = String(Math.floor((end - Date.now()) / 1000));
    const name = (await auth.$context).authCookies.sessionToken.name + '=';
    for (const cookie of headers.getSetCookie()) c.header('Set-Cookie', cookie.startsWith(name) ? cookie.replace(/; Max-Age=[1-9]\d*/i, '; Max-Age=' + remaining) : cookie, { append: true });
    return c.json({ signedIn: true, email: response.user.email, subject: response.user.id });
  });
  // Revokes the database session and clears the cookie. Local anonymous work is never touched.
  app.post('/api/sign-out', limitBody, async c => {
    const rejected = rejectWrite(c); if (rejected) return rejected;
    const body = await jsonBody(c);
    if (!body || Object.keys(body).length) return c.json({ message: 'Use an empty JSON object.' }, 400);
    forwardCookies(c, (await auth.api.signOut({ headers: c.req.raw.headers, asResponse: true })).headers);
    return c.json({ message: 'Signed out.' });
  });
  // The library derives its owner from the session alone. Reads never refresh the session; /api/session does.
  async function owner(c: Context<AccountEnv>) {
    const result = await auth.api.getSession({ headers: c.req.raw.headers, query: { disableRefresh: true } });
    if (!result || result.session.createdAt.getTime() + LIFETIME * 1000 <= Date.now()) return null;
    return { userId: result.user.id, sessionId: result.session.id };
  }
  mountLibrary(app, { pool, owner, rejectWrite, limit: (kind, value, max, seconds) => reserve([{ kind, value, max }], seconds) });
  return { app, auth };
}
export async function migrateAccount(auth: ReturnType<typeof createAccountService>['auth'], pool: Pool) {
  const migration = await getMigrations(auth.options); await migration.runMigrations();
  await pool.query('CREATE TABLE IF NOT EXISTS aski_request_limit (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL)');
  await pool.query('CREATE INDEX IF NOT EXISTS aski_request_limit_expiry ON aski_request_limit (expires_at)');
  await migrateLibrary(pool);
}
