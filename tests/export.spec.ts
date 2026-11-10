import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const multiline = readFileSync(new URL('../shared/fixtures/multiline.txt', import.meta.url), 'utf8');
const exportGroup = (page: import('@playwright/test').Page) => page.getByRole('group', { name: 'Export' });

test('text and ANSI downloads keep exact whitespace; ANSI carries colors and resets', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill(' A\nB');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await expect(exportGroup(page)).toContainText('no colors or animation');
  const [text] = await Promise.all([page.waitForEvent('download'), exportGroup(page).getByRole('button', { name: 'Download text' }).click()]);
  expect(text.suggestedFilename()).toBe('aski-ansi-compact-a-b.txt');
  const bytes = readFileSync((await text.path())!);
  expect(bytes.toString('utf8')).toBe(multiline);
  expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
  await page.getByRole('region', { name: 'Colors' }).getByRole('button', { name: '#FF4D6D' }).click();
  const [ansi] = await Promise.all([page.waitForEvent('download'), exportGroup(page).getByRole('button', { name: 'Download ANSI' }).click()]);
  expect(ansi.suggestedFilename()).toBe('aski-ansi-compact-a-b.ans');
  const colored = readFileSync((await ansi.path())!, 'utf8');
  expect(colored.replace(/\u001b\[[\d;]*m/g, '')).toBe(multiline); // eslint-disable-line no-control-regex
  expect(colored).toContain('\u001b[38;2;255;77;109m');
  for (const line of colored.split('\n').filter(Boolean)) expect(line.endsWith('\u001b[0m')).toBe(true);
});

test('code block copy falls back to manual copy and can be retried', async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  else await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('Permission denied')) } }));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill(' A\nB');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  const block = '```text\n' + multiline + (multiline.endsWith('\n') ? '' : '\n') + '```\n';
  for (let attempt = 0; attempt < 2; attempt++) {
    await exportGroup(page).getByRole('button', { name: 'Copy as code block' }).click();
    if (browserName === 'chromium') {
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(block);
      await expect(page.getByRole('status')).toHaveText('Copied');
    } else {
      await expect(page.getByLabel('Text to copy')).toHaveValue(block);
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeFocused();
    }
  }
});
