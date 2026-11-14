import { Pool } from 'pg';
import { createAccountService, migrateAccount } from './account.ts';
import { brevoMailer } from './mail.ts';
import { accountServer } from './http.ts';
import { sweepArtifacts } from './artifacts.ts';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
const origin = process.env.PUBLIC_ORIGIN || '';
if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) throw new Error('Set DATABASE_URL, PUBLIC_ORIGIN and BETTER_AUTH_SECRET.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const mailer = process.env.BREVO_API_KEY && process.env.MAIL_FROM_EMAIL ? brevoMailer(process.env.BREVO_API_KEY,process.env.MAIL_FROM_EMAIL) : null;
const artifactRoot = process.env.ARTIFACT_ROOT || null;
const { app, auth } = createAccountService({ pool,origin,secret:process.env.BETTER_AUTH_SECRET,mailer,artifactRoot,trustedProxyCIDRs:process.env.TRUSTED_PROXY_CIDRS?.split(',').map(value=>value.trim()) });
// /api/healthz answers while the process runs; /api/readyz only when the database and the file root are usable.
app.get('/api/healthz', c => c.json({ status: 'ok' }));
app.get('/api/readyz', async c => {
  try {
    await pool.query('SELECT 1 FROM aski_library_owner LIMIT 1');
    if (artifactRoot) await access(join(artifactRoot, 'objects'), constants.W_OK);
    return c.json({ status: 'ready' });
  } catch { return c.json({ status: 'not ready' }, 503); }
});
if (process.argv.includes('--migrate')) { await migrateAccount(auth,pool); await pool.end(); }
else {
  // Migrations only add tables and indexes, so a release applies them before it accepts requests.
  if (process.env.ASKI_MIGRATE_ON_START === '1') await migrateAccount(auth, pool);
  // The release image listens on all interfaces of its private network; local runs stay on loopback.
  const server = accountServer(app, origin); server.listen(Number(process.env.ASKI_API_PORT || '4181'), process.env.ASKI_API_HOST || '127.0.0.1');
  // Expired temporary uploads and long-deleted image files are removed at start and then hourly.
  const sweep = () => { if (artifactRoot) void sweepArtifacts(pool, artifactRoot).catch(() => {}); };
  sweep(); const sweeper = setInterval(sweep, 3600_000);
  async function stop() { clearInterval(sweeper); server.close(); await pool.end(); }
  process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
}
