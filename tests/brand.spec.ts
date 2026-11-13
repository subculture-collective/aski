import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
test('Lilac typography and controls stay usable with keyboard, touch and wide art', async ({ page }, info) => {
  await page.goto('/');
  await page.evaluate(async () => { await document.fonts.load('700 28px Fraunces'); await document.fonts.load('400 16px "Atkinson Hyperlegible Next"'); await document.fonts.ready; });
  expect(await page.evaluate(() => document.fonts.check('700 28px Fraunces') && document.fonts.check('400 16px "Atkinson Hyperlegible Next"'))).toBe(true);
  await expect(page.getByRole('heading', { level: 2, name: 'ANSI Compact', exact: true })).toHaveCSS('font-family', /Fraunces/);
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.focus(); await expect(input).toHaveCSS('outline-width','3px');
  for (const control of await page.locator('button:visible,select:visible').all()) expect(Math.round((await control.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  await input.fill('A'.repeat(300));
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  expect(await page.getByTestId('output').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await input.fill('ASKI');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toHaveCSS('background-color','rgb(212, 255, 96)');
  if (process.env.ASKI_CAPTURE_DIR) {
    mkdirSync(process.env.ASKI_CAPTURE_DIR,{recursive:true});
    await page.screenshot({path:join(process.env.ASKI_CAPTURE_DIR,info.project.name+'.png'),fullPage:true});
  }
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByLabel('Email',{exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeFocused();
  await expect(input).toHaveValue('ASKI');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.getByRole('button',{name:'Copy text',exact:true})).toHaveCSS('transition-duration','0s');
});
test('the confirmation route clears its fragment and waits for Continue before redeeming', async ({ page }) => {
  const requests: string[]=[]; page.on('request',request=>requests.push(request.url()));
  await page.goto('/auth/confirm#token=SyntheticTestValue0123456789abcdef');
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  // Opening the link, as a mail scanner would, must not send the token anywhere.
  expect(requests.some(url=>new URL(url).pathname.startsWith('/api/') || url.includes('SyntheticTestValue'))).toBe(false);
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('SyntheticTestValue'))).toBe(false);
});
test('sign-in is not offered when the host has no account service', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Accounts are not available yet."}' }));
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
});
