import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import data from '../shared/catalog-data.json' with { type: 'json' };
const familyCount = new Set(data.map(font => font.familyId)).size;
const card = (page: Page, name: string) => page.locator('article.family-card').filter({ has: page.getByRole('heading', { name, exact: true, level: 3 }) });
const settled = (page: Page) => expect(page.locator('.preview[aria-busy=true]')).toHaveCount(0);
// Scroll anchoring runs in the ResizeObserver step before paint; read positions after that frame.
const topOf = async (page: Page, name: string) => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)))); return (await card(page, name).boundingBox())!.y; };

test('each family appears once with its variants and live previews', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('article.family-card')).toHaveCount(familyCount);
  const names = await page.locator('article.family-card h3').allTextContents();
  expect(new Set(names).size).toBe(familyCount);
  await expect(card(page, 'Future').getByRole('radio')).toHaveCount(3);
  await expect(card(page, 'Emboss').getByRole('radio')).toHaveCount(2);
  await expect(card(page, 'Circle').getByRole('radio')).toHaveCount(0);
  await settled(page);
  await expect(card(page, 'ANSI Compact').getByRole('button', { name: 'Use style' })).toHaveAttribute('aria-pressed', 'true');
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
  await future.getByRole('radio', { name: 'Future Thin' }).check();
  await future.getByRole('button', { name: 'Details' }).click();
  await settled(page);
  const top = await topOf(page, 'Future');
  await input.fill('ASKI\nTWO\nTHREE\nFOUR');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await settled(page);
  // Previews grew by several rows and so did the selected design above the gallery.
  expect(Math.abs(await topOf(page, 'Future') - top)).toBeLessThan(4);
  await expect(future).toBeInViewport();
  await expect(future.getByRole('radio', { name: 'Future Thin' })).toBeChecked();
  await expect(future.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'true');
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
  await emboss.getByRole('radio', { name: 'Emboss', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(emboss.getByRole('radio', { name: 'Emboss 2' })).toBeChecked();
  // Browsing a variant does not change the selected design.
  await expect(page.getByRole('heading', { level: 2, name: 'ANSI Compact', exact: true })).toBeVisible();
  await emboss.getByRole('button', { name: 'Use style' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Emboss 2', exact: true })).toBeVisible();
  await expect(page.getByLabel('Style', { exact: true })).toHaveValue('figlet/emboss-2');
  await expect(emboss.getByRole('button', { name: 'Use style' })).toHaveAttribute('aria-pressed', 'true');
  // Switching the active family's variant updates the design and is undoable.
  await emboss.getByRole('radio', { name: 'Emboss 2' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('heading', { level: 2, name: 'Emboss', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(emboss.getByRole('radio', { name: 'Emboss 2' })).toBeChecked();
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
    await future.getByRole('radio', { name: 'Future Smooth' }).tap();
    await expect(future.getByRole('radio', { name: 'Future Smooth' })).toBeChecked();
    await future.getByRole('button', { name: 'Use style' }).tap();
    await expect(page.getByRole('heading', { level: 2, name: 'Future Smooth', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
    await expect(input).toBeInViewport();
    await input.fill('TAP\nAGAIN');
    await expect(future).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
