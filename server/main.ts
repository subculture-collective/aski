import { Pool } from 'pg';
import { createAccountService, migrateAccount } from './account.ts';
import { brevoMailer } from './mail.ts';
import { accountServer } from './http.ts';
const origin = process.env.PUBLIC_ORIGIN || '';
if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) throw new Error('Set DATABASE_URL, PUBLIC_ORIGIN and BETTER_AUTH_SECRET.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const mailer = process.env.BREVO_API_KEY && process.env.MAIL_FROM_EMAIL ? brevoMailer(process.env.BREVO_API_KEY,process.env.MAIL_FROM_EMAIL) : null;
const { app, auth } = createAccountService({ pool,origin,secret:process.env.BETTER_AUTH_SECRET,mailer,trustedProxyCIDRs:process.env.TRUSTED_PROXY_CIDRS?.split(',').map(value=>value.trim()) });
if (process.argv.includes('--migrate')) { await migrateAccount(auth,pool); await pool.end(); }
else {
  const server = accountServer(app, origin); server.listen(Number(process.env.ASKI_API_PORT || '4181'), '127.0.0.1');
  async function stop() { server.close(); await pool.end(); }
  process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
}
