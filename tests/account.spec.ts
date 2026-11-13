import { test, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
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
  await expect(saved(one.page).getByRole('group',{name:'With a saved design, also keep'})).toHaveCount(0);
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
