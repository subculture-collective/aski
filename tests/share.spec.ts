import { test, expect } from '@playwright/test';
test('a share link restores every editable setting in a fresh browser profile', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('<img src=x onerror=alert(1)>\n🙂 ünï');
  await page.getByLabel('Style', { exact: true }).selectOption('figlet/future-thin');
  await page.getByRole('region', { name: 'Colors' }).getByRole('button', { name: '#FF4D6D' }).click();
  await page.getByRole('region', { name: 'Layout' }).getByRole('radio', { name: 'Right' }).check();
  await page.getByRole('region', { name: 'Animation' }).getByRole('radio', { name: 'Shimmer' }).check();
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  const output = await page.getByTestId('output').textContent();
  // Nothing is shared until the user asks.
  expect(page.url()).not.toContain('#');
  await page.getByRole('button', { name: 'Share link' }).click();
  const link = await page.getByLabel(/^Share link \(\d+ characters\)$/).inputValue();
  expect(link.startsWith(`${baseURL}/#share=1.`)).toBe(true);

  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  const dialogs: string[] = []; other.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await other.goto('/');
  await other.getByRole('textbox', { name: 'Text', exact: true }).fill('MY OWN DRAFT');
  await other.goto(link);
  await expect(other.getByTestId('share-notice')).toContainText('Opened a shared design');
  await expect(other.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('<img src=x onerror=alert(1)>\n🙂 ünï');
  await expect(other.getByLabel('Style', { exact: true })).toHaveValue('figlet/future-thin');
  await expect(other.getByRole('region', { name: 'Layout' }).getByRole('radio', { name: 'Right' })).toBeChecked();
  await expect(other.getByRole('region', { name: 'Animation' }).getByRole('radio', { name: 'Shimmer' })).toBeChecked();
  await expect(other.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await expect(other.getByTestId('output')).toHaveCSS('color', 'rgb(255, 77, 109)');
  expect(await other.getByTestId('output').textContent()).toBe(output);
  expect(new URL(other.url()).hash).toBe('');
  expect(dialogs).toEqual([]);
  await other.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(other.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('MY OWN DRAFT');
  await fresh.close();
});

test('damaged or future links explain the problem and keep the draft', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('KEEP');
  for (const [fragment, message] of [['#share=1.%%%', 'damaged'], ['#share=2.abc', 'newer version'], ['#share=1.' + 'A'.repeat(20000), 'too large']]) {
    await page.goto('/' + fragment);
    await expect(page.getByTestId('share-notice')).toContainText(message);
    await expect(page.getByTestId('share-notice')).toContainText('Your draft is unchanged.');
    await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('KEEP');
  }
});
