import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const multiline = readFileSync(new URL('../shared/fixtures/multiline.txt', import.meta.url), 'utf8');
const final = readFileSync(new URL('../shared/fixtures/final.txt', import.meta.url), 'utf8');
test('multiline editing and copy retain exact whitespace', async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  else await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('Permission denied')) } }));
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  const output = page.getByTestId('output');
  const copy = page.getByRole('button', { name: 'Copy text', exact: true });
  await input.fill(' A\nB');
  await expect(copy).toBeEnabled();
  await expect.poll(() => output.textContent()).toBe(multiline);
  const text = await output.textContent();
  expect(text?.startsWith(' ')).toBe(true); expect(text?.split('\n').length).toBeGreaterThan(6);
  await copy.click();
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
    await expect(page.getByRole('status')).toHaveText('Copied');
  } else {
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Text to copy')).toHaveValue(text!);
    await page.getByRole('button', { name: 'Done' }).click();
  }
  await input.fill('A🙂'); await expect(page.getByText('Unsupported: U+1F642')).toBeVisible();
  await input.fill('x'.repeat(2000));
  // Maximum-input rendering is CPU bound in WebKit; bound this functional check separately.
  try { await expect(copy).toBeEnabled({ timeout: 20_000 }); }
  catch (error) { console.error('Maximum-input render status:', await page.locator('.status').textContent()); throw error; }
  const maximum = await output.textContent();
  expect(maximum?.length).toBe(72005);
  expect(createHash('sha256').update(maximum!).digest('hex')).toBe('9d41bdecc193aa116618f8f870d762657815d5df207049f8bff7ed3b602aa268');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await input.fill('x'.repeat(2001)); await expect(page.getByRole('status')).toHaveText('Use 2000 characters or fewer.');
  await expect(copy).toBeDisabled();
  await input.fill(''); await expect(page.getByRole('status')).toHaveText('Type something.'); await expect(copy).toBeDisabled();
  await input.fill('LATEST'); await input.fill('FINAL'); await expect(copy).toBeEnabled();
  await expect.poll(() => output.textContent()).toBe(final);
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('clipboard feedback does not confirm an older input', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { finishCopy?: () => void; copiedText?: string };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: (text: string) => new Promise<void>(resolve => { state.copiedText = text; state.finishCopy = () => resolve(); }),
    } });
  });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  const copy = page.getByRole('button', { name: 'Copy text', exact: true });
  await input.fill(' A\nB'); await expect.poll(() => page.getByTestId('output').textContent()).toBe(multiline); await expect(copy).toBeEnabled();
  const before = await page.getByTestId('output').textContent();
  await copy.click();
  await input.fill('FINAL'); await expect.poll(() => page.getByTestId('output').textContent()).toBe(final); await expect(copy).toBeEnabled();
  expect(await page.evaluate(() => (window as typeof window & { copiedText: string }).copiedText)).toBe(before);
  await page.evaluate(() => (window as typeof window & { finishCopy: () => void }).finishCopy());
  // Let the pending clipboard continuation and its paint finish.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  // Do not retry until the normal Copied timer clears a stale message.
  expect(await page.getByRole('status').textContent()).toBe('');
});
