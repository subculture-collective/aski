import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { card, cardAction, cardMenuToggle, closeCardMenu, openCardMenu, selectVariant } from './ui.ts';
// Firefox's page process crashed on a regex-named role query here, so locate the tray by class.
const compare = (page: Page) => page.locator('section.compare');
const settled = (page: Page) => expect(page.locator('.preview[aria-busy=true]')).toHaveCount(0);
const topOf = async (page: Page, name: string) => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)))); return (await card(page, name).boundingBox())!.y; };

test('pinned variants follow the live text without changing the selection or moving the gallery', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('PIN');
  await settled(page);
  await cardAction(card(page, 'Pagga'), 'Pin Pagga');
  const future = card(page, 'Future');
  await future.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await selectVariant(future, 'Future Thin');
  await settled(page);
  const top = await topOf(page, 'Future');
  await cardAction(future, 'Pin Future Thin');
  await selectVariant(future, 'Future Smooth');
  await cardAction(future, 'Pin Future Smooth');
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
  await expect((await openCardMenu(future)).getByRole('button', { name: 'Pin Future Smooth' })).toHaveAttribute('aria-pressed', 'false');
  await closeCardMenu(future);
  await compare(page).getByTestId('pinned-figlet-future-thin').getByRole('button', { name: 'Use' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Future Thin', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('pins work with touch and keyboard', async ({ page }) => {
    await page.goto('/');
    const circle = card(page, 'Circle'), letter = card(page, 'Letter');
    await cardMenuToggle(circle).tap();
    await circle.getByRole('button', { name: 'Pin Circle' }).tap();
    await cardMenuToggle(letter).focus();
    await page.keyboard.press('Enter');
    await letter.getByRole('button', { name: 'Pin Letter' }).focus();
    await page.keyboard.press('Enter');
    await expect(compare(page)).toHaveAccessibleName('Compare (2)');
    await compare(page).getByRole('button', { name: 'Unpin Circle' }).tap();
    await expect(compare(page)).toHaveAccessibleName('Compare (1)');
  });
});
