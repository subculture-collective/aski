import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const card = (page: Page, name: string) => page.locator('article.family-card').filter({ has: page.getByRole('heading', { name, exact: true, level: 3 }) });
// Firefox's page process crashed on a regex-named role query here, so locate the tray by class.
const compare = (page: Page) => page.locator('section.compare');
const settled = (page: Page) => expect(page.locator('.preview[aria-busy=true]')).toHaveCount(0);
const topOf = async (page: Page, name: string) => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)))); return (await card(page, name).boundingBox())!.y; };

test('pinned variants follow the live text without changing the selection or moving the gallery', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('PIN');
  await settled(page);
  await card(page, 'Pagga').getByRole('button', { name: 'Pin Pagga' }).click();
  const future = card(page, 'Future');
  await future.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await future.getByRole('radio', { name: 'Future Thin' }).check();
  await settled(page);
  const top = await topOf(page, 'Future');
  await future.getByRole('button', { name: 'Pin Future Thin' }).click();
  await future.getByRole('radio', { name: 'Future Smooth' }).check();
  await future.getByRole('button', { name: 'Pin Future Smooth' }).click();
  await settled(page);
  // The tray grew above the cards, but the card being used stayed put.
  expect(Math.abs(await topOf(page, 'Future') - top)).toBeLessThan(4);
  await expect(compare(page)).toHaveAccessibleName('Compare (3)');
  await expect(page.getByRole('heading', { level: 2, name: 'ANSI Compact', exact: true })).toBeVisible();
  const before = await compare(page).locator('pre').allTextContents();
  await input.fill('PIN\nTWO');
  await settled(page);
  const after = await compare(page).locator('pre').allTextContents();
  after.forEach((text, index) => { expect(text).not.toBe(before[index]); expect(text.split('\n').length).toBeGreaterThan(before[index].split('\n').length); });
  await expect(compare(page).locator('strong')).toHaveText(['Pagga', 'Future Thin', 'Future Smooth']);
  await compare(page).getByRole('button', { name: 'Unpin Future Smooth' }).click();
  await expect(compare(page).locator('strong')).toHaveText(['Pagga', 'Future Thin']);
  await expect(future.getByRole('button', { name: 'Pin Future Smooth' })).toHaveAttribute('aria-pressed', 'false');
  await compare(page).getByTestId('pinned-figlet-future-thin').getByRole('button', { name: 'Use' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Future Thin', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('pins work with touch and keyboard', async ({ page }) => {
    await page.goto('/');
    await card(page, 'Circle').getByRole('button', { name: 'Pin Circle' }).tap();
    await card(page, 'Letter').getByRole('button', { name: 'Pin Letter' }).focus();
    await page.keyboard.press('Enter');
    await expect(compare(page)).toHaveAccessibleName('Compare (2)');
    await compare(page).getByRole('button', { name: 'Unpin Circle' }).tap();
    await expect(compare(page)).toHaveAccessibleName('Compare (1)');
  });
});
