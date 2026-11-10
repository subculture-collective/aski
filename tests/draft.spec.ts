import { test, expect } from '@playwright/test';
test('reload restores text/style; undo and redo include complete editing changes', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  const style = page.getByLabel('Style', { exact: true });
  await input.fill(' A\nB');
  await style.selectOption('figlet/future-thin');
  await page.reload();
  await expect(input).toHaveValue(' A\nB');
  await expect(style).toHaveValue('figlet/future-thin');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await input.fill('EXPERIMENT');
  await style.selectOption('figlet/circle');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(style).toHaveValue('figlet/future-thin');
  await input.focus(); await input.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(input).toHaveValue(' A\nB');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(input).toHaveValue('EXPERIMENT');
  await input.fill('A NEW BRANCH');
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  await page.reload(); await expect(input).toHaveValue('A NEW BRANCH');
});
test('corrupt or future drafts stay intact until explicit replacement', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('aski:draft', '{bad'); localStorage.setItem('unrelated', 'keep'); });
  await page.reload();
  await expect(page.getByTestId('draft-warning')).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('CURRENT');
  expect(await page.evaluate(() => localStorage.getItem('aski:draft'))).toBe('{bad');
  await page.getByRole('button', { name: 'Save this draft', exact: true }).click();
  await page.reload(); await expect(input).toHaveValue('CURRENT');
  expect(await page.evaluate(() => localStorage.getItem('unrelated'))).toBe('keep');
  await page.evaluate(() => localStorage.setItem('aski:draft', JSON.stringify({ schemaVersion: 99 })));
  await page.reload(); await expect(page.getByTestId('draft-warning')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('aski:draft'))).toBe('{"schemaVersion":99}');
});
test('quota failures leave editing/copy usable and retry can resume saving', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'aski:draft' && !(window as typeof window & { allowSaving?: boolean }).allowSaving) throw new Error('Quota');
      original.call(this, key, value);
    };
  });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('STILL HERE');
  await expect(page.getByTestId('draft-warning')).toContainText('Could not save');
  await expect(input).toHaveValue('STILL HERE');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as typeof window & { allowSaving: boolean }).allowSaving = true; });
  await page.getByRole('button', { name: 'Save this draft', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aski:draft')!).recipe.input)).toBe('STILL HERE');
});
