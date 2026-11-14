import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import data from '../shared/catalog-data.json' with { type: 'json' };
import { card, cardAction, openCardMenu, closeCardMenu, openCustomize, selectVariant, shownVariant, useButton, variantSelect } from './ui.ts';
const familyCount = new Set(data.map(font => font.familyId)).size;
const settled = (page: Page) => expect(page.locator('.preview[aria-busy=true]')).toHaveCount(0);
// Scroll anchoring runs in the ResizeObserver step before paint; read positions after that frame.
const topOf = async (page: Page, name: string) => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)))); return (await card(page, name).boundingBox())!.y; };

test('each family appears once with its variants and live previews', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('article.family-card')).toHaveCount(familyCount);
  const names = await page.locator('article.family-card h3').allTextContents();
  expect(new Set(names).size).toBe(familyCount);
  await expect(variantSelect(card(page, 'Future')).getByRole('option')).toHaveCount(3);
  await expect(variantSelect(card(page, 'Emboss')).getByRole('option')).toHaveCount(2);
  await expect(variantSelect(card(page, 'Circle'))).toHaveCount(0);
  await settled(page);
  await expect(useButton(card(page, 'ANSI Compact'))).toHaveAttribute('aria-pressed', 'true');
  const before = await card(page, 'Pagga').locator('.preview').textContent();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('HI');
  await expect(card(page, 'Pagga').locator('.preview')).not.toHaveText(before!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('changing text keeps the anchored family, its variant and open details in view', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('ASKI');
  await settled(page);
  const future = card(page, 'Future');
  await future.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await selectVariant(future, 'Future Thin');
  await cardAction(future, 'Details');
  await settled(page);
  const top = await topOf(page, 'Future');
  await input.fill('ASKI\nTWO\nTHREE\nFOUR');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await settled(page);
  // Previews grew by several rows and so did the selected design above the gallery.
  expect(Math.abs(await topOf(page, 'Future') - top)).toBeLessThan(4);
  await expect(future).toBeInViewport();
  await expect(shownVariant(future)).toHaveText('Future Thin');
  await expect((await openCardMenu(future)).getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'true');
  await closeCardMenu(future);
  await expect(future.getByText('Line height')).toBeVisible();
  await input.fill('A');
  await settled(page);
  expect(Math.abs(await topOf(page, 'Future') - top)).toBeLessThan(4);
  await expect(input).toHaveValue('A');
});

test('keyboard users switch variants and select a family without leaving the editor state', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('KEYS');
  const emboss = card(page, 'Emboss');
  // The variant choice lives in the card's "more" menu.
  await openCardMenu(emboss);
  await variantSelect(emboss).focus();
  await page.keyboard.press('ArrowDown');
  await expect(shownVariant(emboss)).toHaveText('Emboss 2');
  // Browsing a variant does not change the selected design.
  await expect(page.getByRole('heading', { level: 2, name: 'ANSI Compact', exact: true })).toBeVisible();
  await useButton(emboss).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Emboss 2', exact: true })).toBeVisible();
  await expect(page.getByLabel('Style', { exact: true })).toHaveValue('figlet/emboss-2');
  await expect(useButton(emboss)).toHaveAttribute('aria-pressed', 'true');
  // Switching the active family's variant updates the design and is undoable.
  await openCardMenu(emboss);
  await variantSelect(emboss).focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('heading', { level: 2, name: 'Emboss', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(shownVariant(emboss)).toHaveText('Emboss 2');
  await expect(input).toHaveValue('KEYS');
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('touch users edit, switch variants and select a family', async ({ page }) => {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: 'Text', exact: true });
    await input.tap(); await input.fill('TAP');
    const future = card(page, 'Future');
    await future.scrollIntoViewIfNeeded();
    // A tap opens the browser's own variant picker, which tests cannot drive; choose the option directly.
    await selectVariant(future, 'Future Smooth');
    await expect(shownVariant(future)).toHaveText('Future Smooth');
    await useButton(future).tap();
    await expect(page.getByRole('heading', { level: 2, name: 'Future Smooth', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
    await expect(input).toBeInViewport();
    await settled(page);
    const top = await topOf(page, 'Future');
    await input.fill('TAP\nAGAIN\nTHREE');
    await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
    await settled(page);
    expect(Math.abs(await topOf(page, 'Future') - top)).toBeLessThan(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test('content growing between the view and the cards does not push the panel in use off screen', async ({ page }) => {
  await page.goto('/');
  const layout = await openCustomize(page, 'Layout');
  await layout.evaluate(element => element.scrollIntoView({ block: 'start' }));
  const top = (await layout.boundingBox())!.y;
  await layout.getByLabel('Maximum width').fill('5');
  await layout.getByRole('button', { name: 'Set width' }).click();
  await expect(layout.getByRole('alert')).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve))));
  expect(Math.abs((await layout.boundingBox())!.y - top)).toBeLessThan(4);
});
