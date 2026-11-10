import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const cards = (page: Page) => page.locator('article.family-card');
const names = (page: Page) => cards(page).locator('h3').allTextContents();
const find = (page: Page) => page.getByRole('search', { name: 'Find styles' });
const settled = (page: Page) => expect(page.locator('.preview[aria-busy=true]')).toHaveCount(0);

test('search and look filters combine and keep 3D and line styles as separate families', async ({ page }) => {
  await page.goto('/');
  await find(page).getByLabel('Search styles').fill('thin');
  expect(await names(page)).toEqual(['Future']);
  await find(page).getByLabel('Search styles').fill('');
  await find(page).getByRole('checkbox', { name: 'Lines' }).check();
  expect(await names(page)).toEqual(['Emboss', 'Future', 'Linguaholic Neon', 'Linguaholic Rounded', 'Linguaholic Shadow 3D']);
  await find(page).getByLabel('Search styles').fill('lingua');
  expect(await names(page)).toEqual(['Linguaholic Neon', 'Linguaholic Rounded', 'Linguaholic Shadow 3D']);
  await expect(page.getByTestId('filter-count')).toContainText('Showing 3 of 16 families');
  await expect(page.getByTestId('meta-figlet-linguaholic-shadow-3d')).toContainText('Blocks, Lines');
  // Filters and variants survive text edits.
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('EDIT\nTWO');
  await expect(find(page).getByRole('checkbox', { name: 'Lines' })).toBeChecked();
  expect(await names(page)).toEqual(['Linguaholic Neon', 'Linguaholic Rounded', 'Linguaholic Shadow 3D']);
});

test('dimension and character filters use the current text and offer a way back from no results', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('A');
  await settled(page);
  await expect(page.getByTestId('meta-figlet-future')).toContainText(/^\d+ × 3 · Lines$/);
  await find(page).getByLabel('Max rows').fill('3');
  await settled(page);
  for (const meta of await cards(page).locator('.card-meta').allTextContents()) expect(Number(meta.match(/× (\d+)/)![1])).toBeLessThanOrEqual(3);
  expect((await names(page)).length).toBeGreaterThan(0);
  await find(page).getByLabel('Max rows').fill('');
  await input.fill('A🙂');
  await find(page).getByRole('checkbox', { name: 'Supports every character in my text' }).check();
  await expect(page.getByTestId('no-results')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('A🙂');
  await input.fill('A');
  await expect(cards(page)).toHaveCount(16);
  await input.fill('A\t');
  await expect(page.getByTestId('no-results')).toBeVisible();
  await page.getByTestId('no-results').getByRole('button', { name: 'Clear filters' }).click();
  await expect(cards(page)).toHaveCount(16);
  await expect(find(page).getByRole('checkbox', { name: 'Supports every character in my text' })).not.toBeChecked();
});
