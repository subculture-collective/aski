import { test, expect } from '@playwright/test';
test('a font change preserves multiline input and reports actual coverage', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('A\t🙂\nB');
  await page.getByLabel('Style', { exact: true }).selectOption('figlet/circle');
  await expect(page.getByRole('heading', { level: 2, name: 'Circle', exact: true })).toBeVisible();
  await expect(page.getByText('Unsupported: U+9, U+1F642')).toBeVisible();
  await expect(input).toHaveValue('A\t🙂\nB');
  const before = await page.getByTestId('output').textContent();
  await page.getByLabel('Style', { exact: true }).selectOption('figlet/future-thin');
  await expect(page.getByRole('heading', { level: 2, name: 'Future Thin', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await expect(page.getByTestId('output')).not.toHaveText(before!);
  await expect(input).toHaveValue('A\t🙂\nB');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('an unavailable font is recoverable without losing input', async ({ page }) => {
  await page.route('**/fonts/circle.flf', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('KEEP ME');
  await page.getByLabel('Style', { exact: true }).selectOption('figlet/circle');
  await expect(page.getByRole('status')).toHaveText('Could not load this font. Try again.');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeDisabled();
  await page.unroute('**/fonts/circle.flf');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('KEEP ME');
});
