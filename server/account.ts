import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import { createHash, createHmac } from 'node:crypto';
import { isIP, BlockList } from 'node:net';
import type { Pool } from 'pg';
import type { Mailer } from './mail.ts';
export interface AccountOptions { pool: Pool; origin: string; secret: string; mailer: Mailer | null; trustedProxyCIDRs?: string[] }
export type AccountEnv = { Bindings: { peerIP: string } };
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
    session: { expiresIn: 7 * 86400, updateAge: 86400 },
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
  async function reserve(email: string, ip: string): Promise<number> {
    const hash = (value: string) => createHmac('sha256', secret).update(value).digest('hex');
    const keys = [{ key: 'address:' + hash(email), max: 5 }, { key: 'ip:' + hash(ip), max: 20 }].sort((a,b) => a.key.localeCompare(b.key));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM aski_request_limit WHERE expires_at <= NOW()');
      await client.query('DELETE FROM verification WHERE "expiresAt" <= NOW() AND identifier LIKE $1', ['magic-link:%']);
      let retry = 0;
      for (const item of keys) {
        const result = await client.query(`INSERT INTO aski_request_limit (key,count,expires_at) VALUES ($1,1,NOW()+INTERVAL '1 hour')
          ON CONFLICT (key) DO UPDATE SET count=aski_request_limit.count+1
          RETURNING count, EXTRACT(EPOCH FROM expires_at-NOW()) AS remaining`, [item.key]);
        if (result.rows[0].count > item.max) retry = Math.max(retry, Math.ceil(Number(result.rows[0].remaining)));
      }
      await client.query(retry ? 'ROLLBACK' : 'COMMIT'); return retry;
    } catch { await client.query('ROLLBACK'); throw new Error('Account unavailable'); }
    finally { client.release(); }
  }
  const app = new Hono<AccountEnv>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control','no-store'); c.header('Referrer-Policy','no-referrer'); c.header('X-Content-Type-Options','nosniff');
    await next();
  });
  app.onError((_, c) => c.json({ message: 'Sign-in is unavailable. Try again later.' }, 503));
  app.post('/api/sign-in/request', bodyLimit({ maxSize: 4096, onError: c => c.json({ message: 'Request is too large.' }, 413) }), async c => {
    if (c.req.header('origin') !== origin || c.req.header('sec-fetch-site') === 'cross-site') return c.json({ message: 'This request is not allowed.' }, 403);
    if (c.req.header('content-type')?.split(';')[0].trim() !== 'application/json') return c.json({ message: 'Use JSON.' }, 415);
    let body: unknown; try { body = await c.req.json(); } catch { return c.json({ message: 'Enter a valid email address.' }, 400); }
    if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || !('email' in body) || typeof body.email !== 'string') return c.json({ message: 'Enter a valid email address.' }, 400);
    const email = body.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ message: 'Enter a valid email address.' }, 400);
    let ip = normalizeIP(c.env?.peerIP || '');
    if (isIP(ip) && trusted.check(ip,isIP(ip) === 4 ? 'ipv4' : 'ipv6')) ip = normalizeIP(c.req.header('x-real-ip') || '');
    if (!isIP(ip)) return c.json({ message: 'Sign-in is unavailable. Try again later.' }, 503);
    try {
      const retry = await reserve(email, ip);
      if (retry) { c.header('Retry-After', String(retry)); return c.json({ message: 'Too many requests. Try again later.' }, 429); }
      if (!mailer) return c.json({ message: 'Sign-in is unavailable. Try again later.' }, 503);
      await auth.api.signInMagicLink({ body: { email, callbackURL: '/' }, headers: new Headers({ origin }) });
      return c.json({ message: 'Check your inbox for a sign-in link.' });
    } catch { return c.json({ message: 'Sign-in is unavailable. Try again later.' }, 503); }
  });
  return { app, auth };
}
export async function migrateAccount(auth: ReturnType<typeof createAccountService>['auth'], pool: Pool) {
  const migration = await getMigrations(auth.options); await migration.runMigrations();
  await pool.query('CREATE TABLE IF NOT EXISTS aski_request_limit (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL)');
  await pool.query('CREATE INDEX IF NOT EXISTS aski_request_limit_expiry ON aski_request_limit (expires_at)');
}
