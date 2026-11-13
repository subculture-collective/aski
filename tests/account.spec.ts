import { test, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
test.skip(process.env.ASKI_ACCOUNT_TEST !== '1', 'Run make test-account-ui for an isolated database and capture transport.');
// The capture server trusts the preview proxy's forwarded address; each context acts as its own visitor.
const projects = ['chromium', 'firefox', 'phone'];
let visitors = 0;
const visitorIP = (project: string) => `203.0.113.${projects.indexOf(project) * 40 + 20 + ++visitors}`;
test.use({ extraHTTPHeaders: { 'x-real-ip': '198.51.100.10' } });
async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByRole('button',{name:'Email a link',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Check your inbox for a sign-in link.');
  const { path }=await (await fetch(process.env.ASKI_API_URL+'/__test/inbox/link?email='+encodeURIComponent(email))).json();
  await page.goto(path); await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.waitForURL('/'); await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
}
async function visitor(browser: Browser, project: string) {
  const context = await browser.newContext({ ...(project === 'phone' ? { viewport: { width: 390, height: 844 } } : {}), baseURL: 'http://127.0.0.1:4179', extraHTTPHeaders: { 'x-real-ip': visitorIP(project) } });
  return { context, page: await context.newPage() };
}
test('the real sign-in form delivers to the capture inbox without changing the draft', async ({ page }) => {
  const before=await (await fetch(process.env.ASKI_API_URL+'/__test/inbox')).json();
  await page.goto('/'); const input=page.getByRole('textbox',{name:'Text',exact:true}); await input.fill('MY LOCAL WORK');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill('browser@example.test');
  await page.getByRole('button',{name:'Email a link',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Check your inbox for a sign-in link.');
  const inbox=await (await fetch(process.env.ASKI_API_URL+'/__test/inbox')).json();
  expect(inbox.messages).toBe(before.messages+1); expect(inbox.hashed).toBe(true); expect(inbox.fragmentOnly).toBe(true);
  expect(await page.evaluate(()=>JSON.stringify(localStorage).includes('browser@example.test'))).toBe(false);
  await page.getByRole('button',{name:'Keep creating',exact:true}).click();
  await expect(input).toHaveValue('MY LOCAL WORK');
  await expect(page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled();
});
test('mail outage and rate limiting preserve anonymous editing', async ({ page }) => {
  await page.goto('/'); const input=page.getByRole('textbox',{name:'Text',exact:true}); await input.fill('KEEP CREATING');
  await page.route('**/api/sign-in/request',route=>route.fulfill({status:503,body:'{}'}));
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill('browser@example.test');
  await page.getByRole('button',{name:'Email a link',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Sign-in is unavailable');
  await page.unroute('**/api/sign-in/request');
  await page.route('**/api/sign-in/request',route=>route.fulfill({status:429,body:'{}'}));
  await page.getByRole('button',{name:'Email a link',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Too many requests. Try again later.');
  await page.getByRole('button',{name:'Keep creating',exact:true}).click();
  await expect(input).toHaveValue('KEEP CREATING'); await input.fill('STILL EDITING');
  await expect(page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled();
});
test('a captured link signs in through the confirm page, and signing out keeps local work', async ({ page, context }, testInfo) => {
  const email=`${testInfo.project.name}-session@example.test`;
  const favorites=page.getByRole('region',{name:'Favorites'}); const collections=page.getByRole('region',{name:'Collections'});
  const records=()=>page.evaluate(()=>new Promise<number>(resolve=>{const open=indexedDB.open('aski-library');open.onsuccess=()=>{const all=open.result.transaction('records').objectStore('records').count();all.onsuccess=()=>{open.result.close();resolve(all.result);};};}));
  await page.goto('/');
  await page.locator('article.family-card').filter({has:page.getByRole('heading',{name:'Pagga',exact:true,level:3})}).getByRole('button',{name:'Favorite Pagga'}).click();
  await collections.getByLabel('New collection').fill('Keep'); await collections.getByLabel('New collection').press('Enter');
  await expect(favorites.getByRole('listitem')).toHaveCount(1); await expect.poll(records).toBe(2);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByRole('button',{name:'Email a link',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Check your inbox for a sign-in link.');
  const { path }=await (await fetch(process.env.ASKI_API_URL+'/__test/inbox/link?email='+encodeURIComponent(email))).json();
  expect(path).toMatch(/^\/auth\/confirm#token=/);
  // Opening the link captures the token, clears it from the address bar and contacts only this origin.
  const requested: string[]=[]; page.on('request',r=>requested.push(new URL(r.url()).origin));
  await page.goto(path);
  await expect(page.getByRole('heading',{name:'Sign in to aski'})).toBeVisible();
  expect(new URL(page.url()).hash).toBe(''); expect(new URL(page.url()).pathname).toBe('/auth/confirm');
  await expect(page.locator('meta[name=referrer]')).toHaveAttribute('content','no-referrer');
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('token'))).toBe(false);
  expect((await context.cookies()).some(c=>c.name.includes('session_token'))).toBe(false);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.waitForURL('/');
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  expect(requested.every(origin=>origin===new URL(page.url()).origin)).toBe(true);
  const cookie=(await context.cookies()).find(c=>c.name==='__Secure-better-auth.session_token')!;
  expect(cookie).toMatchObject({httpOnly:true,secure:true,sameSite:'Lax',path:'/',domain:'127.0.0.1'});
  expect(await page.evaluate(()=>document.cookie)).toBe('');
  // The same link cannot be used again; the page offers a way back to request a new one.
  await page.goto(path); await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Request a new link from the studio.');
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'Return to the studio'}).click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Signed out.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  expect((await context.cookies()).some(c=>c.name.includes('session_token'))).toBe(false);
  await page.reload();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await expect(favorites.getByRole('listitem')).toHaveCount(1);
  await expect(collections.getByRole('listitem',{name:'Collection Keep',exact:true})).toBeVisible();
  expect(await records()).toBe(2);
});
test('a signed-in visitor saves to the account library, reopens it in another session, and other accounts cannot see it', async ({ browser }, testInfo) => {
  const project = testInfo.project.name; const owner = `${project}-library@example.test`;
  const one = await visitor(browser, project);
  const saved = (page: Page) => page.getByRole('region',{name:'Saved work'});
  const designs = (page: Page) => saved(page).getByRole('list',{name:'Saved designs'}).getByRole('listitem');
  // Work saved before sign-in stays in this browser and is not uploaded.
  await one.page.goto('/'); await one.page.getByRole('textbox',{name:'Text',exact:true}).fill('LOCAL ONLY');
  await saved(one.page).getByRole('button',{name:'Save text',exact:true}).click();
  await expect(saved(one.page).getByRole('listitem',{name:'Text LOCAL ONLY'})).toBeVisible();
  await signIn(one.page, owner);
  await expect(one.page.getByRole('radio',{name:'Account'})).toBeChecked();
  await expect(saved(one.page).getByText('No saved text yet.')).toBeVisible();
  await one.page.getByRole('textbox',{name:'Text',exact:true}).fill('ACCOUNT ART');
  await expect(one.page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled();
  await saved(one.page).getByRole('button',{name:'Save design',exact:true}).click();
  await expect(designs(one.page)).toHaveCount(1);
  await designs(one.page).getByRole('button',{name:'Rename'}).click();
  await saved(one.page).getByLabel('Name',{exact:true}).fill('Account design');
  await saved(one.page).getByRole('button',{name:'Save name'}).click();
  await expect(saved(one.page).getByRole('listitem',{name:'Design Account design'})).toBeVisible();
  // Another signed-in session for the same account lists and reopens it.
  const two = await visitor(browser, project);
  await signIn(two.page, owner);
  await expect(saved(two.page).getByRole('listitem',{name:'Design Account design'})).toBeVisible();
  await expect(saved(two.page).getByText('LOCAL ONLY')).toHaveCount(0);
  await saved(two.page).getByRole('button',{name:'Account design',exact:true}).click();
  await expect(two.page.getByRole('textbox',{name:'Text',exact:true})).toHaveValue('ACCOUNT ART');
  // A different account sees nothing, through the interface or the API.
  const other = await visitor(browser, project);
  await signIn(other.page, `${project}-other@example.test`);
  await expect(saved(other.page).getByText('No saved designs yet.')).toBeVisible();
  expect((await (await other.page.request.get('/api/library')).json()).changes).toEqual([]);
  // Deleting in one session removes it for the account; the local item is still in the first browser.
  const item = saved(two.page).getByRole('listitem',{name:'Design Account design'});
  await item.getByRole('button',{name:'Delete'}).click(); await item.getByRole('button',{name:'Confirm delete'}).click();
  await expect(designs(two.page)).toHaveCount(0);
  await one.page.reload();
  await expect(saved(one.page).getByText('No saved designs yet.')).toBeVisible();
  await one.page.getByRole('radio',{name:'This browser'}).check();
  await expect(saved(one.page).getByRole('listitem',{name:'Text LOCAL ONLY'})).toBeVisible();
  for (const session of [one, two, other]) await session.context.close();
});
// Puts a collection holding a favorite style and an exact design into this browser's library.
const seedLocal = (page: Page) => page.evaluate(() => new Promise<void>((resolve, reject) => {
  const now = '2026-11-01T00:00:00.000Z';
  const id = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
  const record = (n: number, type: string, payload: unknown) => ({ namespace: 'anonymous', id: id(n), type, schemaVersion: 1, payload, revision: 0, deletedAt: null, createdAt: now.replace('00.000', `0${n}.000`), updatedAt: now });
  const records = [
    record(1, 'favorite', { familyId: 'figlet/future' }),
    record(2, 'design', { name: 'Imported design', snapshot: { text: 'IMPORTED', columns: 8, rows: 1 }, recipe: { schemaVersion: 1, id: id(9), input: 'IMPORTED',
      familyId: 'ansi-compact', variantId: 'ansi-compact.regular', fontSha256: '7725d789f12f20f854a2d0fb6f23df3080fefd0753e94055f2078b3853afe30f', rendererVersion: 'figlet@1.12.0' } }),
    record(3, 'collection', { name: 'Keep' }),
    record(4, 'membership', { collectionId: id(3), itemType: 'favorite', itemId: id(1) }),
    record(5, 'membership', { collectionId: id(3), itemType: 'design', itemId: id(2) }),
  ];
  const open = indexedDB.open('aski-library');
  open.onsuccess = () => {
    const transaction = open.result.transaction('records', 'readwrite');
    for (const item of records) transaction.objectStore('records').put(item);
    transaction.oncomplete = () => { open.result.close(); resolve(); }; transaction.onerror = () => reject(transaction.error);
  };
}));
test('signing in offers an explicit import that survives a lost reply and reaches another session', async ({ browser }, testInfo) => {
  const project = testInfo.project.name; const owner = `${project}-import@example.test`;
  const collections = (page: Page) => page.getByRole('region',{name:'Collections'});
  const live = async (page: Page) => ((await (await page.request.get('/api/library')).json()).changes as { type: string; deletedAt: string | null }[]).filter(r => !r.deletedAt).map(r => r.type).sort();
  const one = await visitor(browser, project);
  await one.page.goto('/'); await expect(one.page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled();
  await seedLocal(one.page); await one.page.reload();
  await expect(collections(one.page).getByRole('listitem',{name:'Collection Keep'})).toBeVisible();
  await signIn(one.page, owner);
  const panel = one.page.getByRole('region',{name:'Import from this browser'});
  await expect(panel).toContainText('This browser has 1 favorite, 1 design, 1 collection, 2 collection entries that are not in your account.');
  await panel.getByRole('button',{name:'Review import'}).click();
  await expect(panel.getByRole('list',{name:'Items to import'}).getByRole('listitem')).toHaveCount(4);
  // Nothing is written before the visitor confirms.
  expect(await live(one.page)).toEqual([]);
  // The account commits the import, but the reply never reaches the page.
  await one.page.route('**/api/library/mutations', async route => { await route.fetch(); await route.abort(); }, { times: 1 });
  await panel.getByRole('button',{name:'Import into account'}).click();
  await expect(panel.getByRole('status')).toContainText('The import stopped');
  await panel.getByRole('button',{name:'Review import'}).click();
  await panel.getByRole('button',{name:'Import into account'}).click();
  await expect(panel.getByRole('status')).toContainText('already in your account');
  expect(await live(one.page)).toEqual(['collection', 'design', 'favorite', 'membership', 'membership']);
  // The browser copies are kept.
  await one.page.getByRole('radio',{name:'This browser'}).check();
  await expect(collections(one.page).getByRole('list',{name:'Items in Keep'}).getByRole('listitem')).toHaveCount(2);
  // Another signed-in session reads the collection and reopens the style and the exact design.
  const two = await visitor(browser, project);
  await signIn(two.page, owner);
  await expect(two.page.getByRole('region',{name:'Import from this browser'})).toHaveCount(0);
  const keep = collections(two.page).getByRole('listitem',{name:'Collection Keep'});
  await expect(keep.getByRole('list',{name:'Items in Keep'}).getByRole('listitem')).toHaveCount(2);
  await keep.getByRole('button',{name:'Imported design',exact:true}).click();
  await expect(two.page.getByRole('textbox',{name:'Text',exact:true})).toHaveValue('IMPORTED');
  await keep.getByRole('button',{name:'Future',exact:true}).click();
  await expect(two.page.getByLabel('Style',{exact:true})).toHaveValue('figlet/future');
  await expect(two.page.getByRole('textbox',{name:'Text',exact:true})).toHaveValue('IMPORTED');
  // A fresh import from the first browser finds nothing left to add.
  await one.page.getByRole('radio',{name:'Account'}).check(); await one.page.reload();
  await expect(one.page.getByText(`Signed in as ${owner}`)).toBeVisible();
  await expect(one.page.getByRole('region',{name:'Import from this browser'})).toHaveCount(0);
  for (const session of [one, two]) await session.context.close();
});
const savedText = (page: Page) => page.getByRole('region',{name:'Saved work'}).getByRole('list',{name:'Saved text'});
const liveRecords = async (page: Page) => ((await (await page.request.get('/api/library')).json()).changes as { type: string; deletedAt: string | null; payload: { name?: string } }[]).filter(r => !r.deletedAt);
async function saveText(page: Page, text: string) {
  await page.getByRole('textbox',{name:'Text',exact:true}).fill(text);
  await page.getByRole('region',{name:'Saved work'}).getByRole('button',{name:'Save text',exact:true}).click();
}
async function renameText(page: Page, from: string, to: string) {
  const item = savedText(page).getByRole('listitem',{name:`Text ${from}`});
  await item.getByRole('button',{name:'Rename'}).click(); await item.getByLabel('Name',{exact:true}).fill(to); await item.getByRole('button',{name:'Save name'}).click();
}
test('changes made while the account service is down survive a reload and are sent when it returns', async ({ browser }, testInfo) => {
  const project = testInfo.project.name; const owner = `${project}-outage@example.test`;
  const one = await visitor(browser, project);
  await signIn(one.page, owner);
  await expect(one.page.getByTestId('sync-status')).toContainText('All changes are saved');
  await one.page.route('**/api/**', route => route.abort());
  await saveText(one.page, 'WHILE DOWN');
  await expect(one.page.getByTestId('sync-status')).toContainText('Offline. 1 change kept in this browser');
  // A reload while the service is down shows the account's copy and the waiting change.
  await one.page.reload();
  await expect(one.page.getByText(`Signed in as ${owner} (offline)`)).toBeVisible();
  await expect(savedText(one.page).getByRole('listitem',{name:'Text WHILE DOWN'})).toBeVisible();
  await expect(one.page.getByTestId('sync-status')).toContainText('1 change kept in this browser');
  // Local drafting keeps working.
  await one.page.getByRole('textbox',{name:'Text',exact:true}).fill('STILL DRAFTING');
  await expect(one.page.getByRole('button',{name:'Copy text',exact:true})).toBeEnabled();
  await one.page.unroute('**/api/**');
  await one.page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(one.page.getByText(`Signed in as ${owner} (offline)`)).toHaveCount(0);
  await expect(one.page.getByText(`Signed in as ${owner}`)).toBeVisible();
  await expect(one.page.getByTestId('sync-status')).toContainText('All changes are saved');
  expect((await liveRecords(one.page)).map(r => r.payload.name)).toEqual(['WHILE DOWN']);
  await one.context.close();
});
test('edits made in two sessions are both kept, and an edit to an item deleted elsewhere comes back as a new item', async ({ browser }, testInfo) => {
  const project = testInfo.project.name; const owner = `${project}-conflict@example.test`;
  const one = await visitor(browser, project); const two = await visitor(browser, project);
  await signIn(one.page, owner);
  await saveText(one.page, 'SHARED'); await saveText(one.page, 'DOOMED');
  await expect(one.page.getByTestId('sync-status')).toContainText('All changes are saved');
  await signIn(two.page, owner);
  await expect(savedText(two.page).getByRole('listitem')).toHaveCount(2);
  // The second session cannot reach the account while it edits.
  await two.page.route('**/api/library/mutations', route => route.abort());
  await renameText(two.page, 'SHARED', 'From two'); await renameText(two.page, 'DOOMED', 'Saved by two');
  await expect(two.page.getByTestId('sync-status')).toContainText('2 changes kept in this browser');
  // Meanwhile the first session renames one and deletes the other.
  await renameText(one.page, 'SHARED', 'From one');
  const doomed = savedText(one.page).getByRole('listitem',{name:'Text DOOMED'});
  await doomed.getByRole('button',{name:'Delete'}).click(); await doomed.getByRole('button',{name:'Confirm delete'}).click();
  await expect(one.page.getByTestId('sync-status')).toContainText('All changes are saved');
  await two.page.unroute('**/api/library/mutations');
  await two.page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(two.page.getByTestId('sync-status')).toContainText('All changes are saved', { timeout: 15_000 });
  await expect(savedText(two.page).getByRole('listitem')).toHaveCount(3);
  for (const name of ['From one', 'From two (conflicting copy)', 'Saved by two (recovered)']) await expect(savedText(two.page).getByRole('listitem',{name:`Text ${name}`})).toBeVisible();
  await one.page.reload();
  await expect(savedText(one.page).getByRole('listitem')).toHaveCount(3);
  expect((await liveRecords(one.page)).map(r => r.payload.name).sort()).toEqual(['From one', 'From two (conflicting copy)', 'Saved by two (recovered)']);
  for (const session of [one, two]) await session.context.close();
});
test('unsent changes stay bound to their account after the session ends and can be copied into this browser', async ({ browser }, testInfo) => {
  const project = testInfo.project.name; const owner = `${project}-expired@example.test`;
  const one = await visitor(browser, project);
  await signIn(one.page, owner);
  await one.page.route('**/api/library/mutations', route => route.abort());
  await saveText(one.page, 'NOT YET SENT');
  await expect(one.page.getByTestId('sync-status')).toContainText('1 change kept in this browser');
  // The session ends elsewhere; the next attempt is refused and the page signs out.
  expect((await one.page.request.post('/api/sign-out', { headers: { origin: 'http://127.0.0.1:4179', 'content-type': 'application/json' }, data: {} })).status()).toBe(200);
  await one.page.unroute('**/api/library/mutations');
  await one.page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(one.page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible({ timeout: 15_000 });
  const waiting = one.page.getByRole('region',{name:'Unsent account changes'});
  await expect(waiting).toContainText(`1 unsent change for ${owner} is kept in this browser.`);
  // A different account never receives them.
  await signIn(one.page, `${project}-someone-else@example.test`);
  await expect(waiting).toBeVisible();
  expect(await liveRecords(one.page)).toEqual([]);
  await one.page.getByRole('radio',{name:'This browser'}).check();
  await waiting.getByRole('button',{name:'Copy to this browser'}).click();
  await expect(waiting.getByRole('status')).toHaveText('Copied 1 item into this browser’s library.');
  await expect(savedText(one.page).getByRole('listitem',{name:'Text NOT YET SENT'})).toBeVisible();
  await one.context.close();
});
test('a saved animated design and its GIF reach another session byte for byte, and its file stays private to the account', async ({ browser }, testInfo) => {
  const project = testInfo.project.name; const owner = `${project}-files@example.test`;
  const animation = (page: Page) => page.getByRole('region',{name:'Animation'}); const gif = (page: Page) => page.getByRole('group',{name:'GIF export'});
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const one = await visitor(browser, project);
  await one.page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(one.page, owner);
  await one.page.getByRole('textbox',{name:'Text',exact:true}).fill('MOVE');
  await animation(one.page).getByRole('radio',{name:'Glitch'}).check();
  await animation(one.page).getByLabel('Frame rate').selectOption('10');
  await animation(one.page).getByLabel('Duration (seconds)').fill('1'); await animation(one.page).getByLabel('Duration (seconds)').press('Enter');
  await gif(one.page).getByRole('button',{name:'Create GIF'}).click();
  await expect(one.page.getByTestId('gif-result')).toBeVisible({ timeout: 20_000 });
  const [made] = await Promise.all([one.page.waitForEvent('download'), gif(one.page).getByRole('link',{name:'Download GIF'}).click()]);
  const original = readFileSync((await made.path())!);
  await gif(one.page).getByRole('button',{name:'Save design with this GIF'}).click();
  await expect(one.page.getByTestId('gif-save-note')).toHaveText('Saved with this GIF in Saved work.');
  await expect(one.page.getByTestId('sync-status')).toContainText('All changes are saved', { timeout: 15_000 });
  const [file] = (await (await one.page.request.get('/api/artifacts')).json()).artifacts;
  expect(file).toMatchObject({ mime: 'image/gif', sha256: sha(original), byteLength: original.length });
  // Another session for the account reopens the design and downloads the identical GIF.
  const two = await visitor(browser, project);
  await signIn(two.page, owner);
  const design = two.page.getByRole('region',{name:'Saved work'}).getByRole('listitem',{name:'Design ANSI Compact: MOVE',exact:true});
  await expect(design.getByText(/^Original GIF/)).toBeVisible();
  await design.getByRole('button',{name:'ANSI Compact: MOVE',exact:true}).click();
  await expect(animation(two.page).getByRole('radio',{name:'Glitch'})).toBeChecked();
  const [download] = await Promise.all([two.page.waitForEvent('download'), design.getByRole('button',{name:'Download original'}).click()]);
  expect(download.suggestedFilename()).toMatch(/\.gif$/);
  expect(sha(readFileSync((await download.path())!))).toBe(sha(original));
  // Another account gets the same answer as for a file that does not exist.
  const other = await visitor(browser, project);
  await signIn(other.page, `${project}-not-the-owner@example.test`);
  const [guessed, unknown] = [await other.page.request.get(`/api/artifacts/${file.id}`), await other.page.request.get('/api/artifacts/00000000-0000-4000-8000-000000000000')];
  expect(guessed.status()).toBe(404); expect(await guessed.json()).toEqual(await unknown.json());
  // Deleting the design removes its file from the account once no design uses it.
  await design.getByRole('button',{name:'Delete'}).click(); await design.getByRole('button',{name:'Confirm delete'}).click();
  await expect(two.page.getByTestId('sync-status')).toContainText('All changes are saved', { timeout: 15_000 });
  expect((await (await two.page.request.get('/api/artifacts')).json()).artifacts).toEqual([]);
  for (const session of [one, two, other]) await session.context.close();
});
