import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { createAccountService, migrateAccount } from './account.ts';
import { accountServer } from './http.ts';
if (process.env.ASKI_ACCOUNT_TEST !== '1' || !process.env.ASKI_TEST_DATABASE_URL || !process.send) throw new Error('Isolated account harness required');
const pool = new Pool({ connectionString: process.env.ASKI_TEST_DATABASE_URL });
const inbox: { email: string; url: string }[] = [];
const { app, auth } = createAccountService({ pool, origin: 'http://127.0.0.1:4179', secret: 'isolated-capture-server-test-secret-01234567890123456789', mailer: { send: async mail => { inbox.push(mail); } } });
await migrateAccount(auth,pool);
app.get('/__test/inbox', async c => {
  // Redeemed links leave no row, so only the newest link must still be stored, under its hash.
  let hashed = true; let fragmentOnly = true;
  const stored = JSON.stringify((await pool.query('SELECT identifier,value FROM verification')).rows);
  for (const [index, mail] of inbox.entries()) {
    const url = new URL(mail.url); const token = new URLSearchParams(url.hash.slice(1)).get('token') || '';
    fragmentOnly &&= url.pathname === '/auth/confirm' && url.search === '' && token.length >= 32;
    const identifier = 'magic-link:' + createHash('sha256').update(token).digest('base64url');
    hashed &&= !stored.includes(token) && (index < inbox.length - 1 || (await pool.query('SELECT 1 FROM verification WHERE identifier = $1', [identifier])).rowCount === 1);
  }
  return c.json({ messages: inbox.length, hashed, fragmentOnly });
});
// Hands the newest captured link for one address to the browser test, as the mail client would.
// This route exists only in the isolated loopback capture server.
app.get('/__test/inbox/link', c => {
  const mail = inbox.filter(item => item.email === c.req.query('email')).at(-1);
  if (!mail) return c.json({ message: 'No captured link.' }, 404);
  const url = new URL(mail.url); return c.json({ path: url.pathname + url.hash });
});
const server = accountServer(app,'http://127.0.0.1:4179');
server.listen(0,'127.0.0.1',() => { const address=server.address(); if(address && typeof address !== 'string') process.send!({port:address.port}); });
process.once('SIGTERM',()=>{server.close(async()=>{await pool.end();process.exit(0);});});
