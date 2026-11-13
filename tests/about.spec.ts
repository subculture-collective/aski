import { test, expect } from '@playwright/test';
import { families } from '../shared/catalog.ts';
test('about page shows every family as a live specimen with a working look filter', async ({ page }) => {
  await page.goto('/about/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Lettering made of characters, in ${families.length} families.`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', /Fraunces/);
  const rows = page.locator('article.row');
  await expect(rows).toHaveCount(families.length);
  for (const family of families) await expect(page.getByRole('img', { name: `“hello” in ${family.name} lettering`, exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '“aski” in Classy lettering', exact: true })).toBeVisible();

  await page.getByLabel('Sample text', { exact: true }).fill('zine é');
  await expect(page.getByRole('img', { name: '“zine é” in Pagga lettering', exact: true })).toBeVisible();
  await expect(page.locator('.miss').first()).toContainText('has no é');

  await page.getByRole('button', { name: 'Braille', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Braille', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveText(`Showing 1 of ${families.length} families with braille.`);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(rows).toHaveCount(families.length);

  for (const control of await page.locator('button:visible,input:visible,a.btn:visible').all()) expect(Math.round((await control.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const link of await page.getByRole('link', { name: 'Open the studio', exact: true }).all()) await expect(link).toHaveAttribute('href', '/');
});
