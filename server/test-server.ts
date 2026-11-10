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
  let hashed = true; let fragmentOnly = true;
  for (const mail of inbox) {
    const url = new URL(mail.url); const token = new URLSearchParams(url.hash.slice(1)).get('token') || '';
    fragmentOnly &&= url.pathname === '/auth/confirm' && url.search === '' && token.length >= 32;
    const identifier = 'magic-link:' + createHash('sha256').update(token).digest('base64url');
    const rows = (await pool.query('SELECT identifier,value FROM verification WHERE identifier = $1', [identifier])).rows;
    hashed &&= rows.length === 1 && !JSON.stringify(rows).includes(token);
  }
  return c.json({ messages: inbox.length, hashed, fragmentOnly });
});
const server = accountServer(app,'http://127.0.0.1:4179');
server.listen(0,'127.0.0.1',() => { const address=server.address(); if(address && typeof address !== 'string') process.send!({port:address.port}); });
process.once('SIGTERM',()=>{server.close(async()=>{await pool.end();process.exit(0);});});
