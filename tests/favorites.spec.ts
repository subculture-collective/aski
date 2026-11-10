import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const card = (page: Page, name: string) => page.locator('article.family-card').filter({ has: page.getByRole('heading', { name, exact: true, level: 3 }) });
const favorites = (page: Page) => page.getByRole('region', { name: 'Favorites' });
// The list updates immediately; IndexedDB commits shortly after. Wait for it before reloading.
const stored = (page: Page) => page.evaluate(() => new Promise<number>(resolve => {
  const open = indexedDB.open('aski-library', 1);
  open.onsuccess = () => { const all = open.result.transaction('records').objectStore('records').count(); all.onsuccess = () => { open.result.close(); resolve(all.result); }; };
}));

test('favorites survive reload and apply a style to new text without account services', async ({ page }) => {
  // Account services are down; favorites must not need them.
  await page.route('**/api/**', route => route.abort());
  await page.goto('/');
  await expect(favorites(page)).toContainText('Saved in this browser only');
  await expect(favorites(page).getByRole('listitem')).toHaveCount(0);
  const future = card(page, 'Future');
  await future.getByRole('radio', { name: 'Future Thin' }).check();
  await future.getByRole('button', { name: 'Favorite Future Thin' }).click();
  await expect(future.getByRole('button', { name: 'Favorite Future Thin' })).toHaveAttribute('aria-pressed', 'true');
  await card(page, 'Pagga').getByRole('button', { name: 'Favorite Pagga' }).click();
  await expect(favorites(page).getByRole('listitem')).toHaveCount(2);
  // Favoriting browses only; the design stays on its current style.
  await expect(page.getByRole('heading', { level: 2, name: 'ANSI Compact', exact: true })).toBeVisible();
  await expect.poll(() => stored(page)).toBe(2);
  await page.reload();
  await expect(favorites(page).getByRole('listitem')).toHaveCount(2);
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('BRAND NEW');
  await favorites(page).getByRole('button', { name: 'Future Thin', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Future Thin', exact: true })).toBeVisible();
  await expect(page.getByLabel('Style', { exact: true })).toHaveValue('figlet/future-thin');
  await expect(input).toHaveValue('BRAND NEW');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await expect(favorites(page).getByRole('button', { name: 'Future Thin', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await favorites(page).getByRole('button', { name: 'Remove Pagga from favorites' }).click();
  await expect(card(page, 'Pagga').getByRole('button', { name: 'Favorite Pagga' })).toHaveAttribute('aria-pressed', 'false');
  await future.getByRole('button', { name: 'Favorite Future Thin' }).click();
  await expect(favorites(page).getByRole('listitem')).toHaveCount(0);
  await expect.poll(() => stored(page)).toBe(0);
  await page.reload();
  await expect(favorites(page).getByRole('listitem')).toHaveCount(0);
  await expect(input).toHaveValue('BRAND NEW');
});

test('unreadable library records are kept and reported', async ({ page }) => {
  await page.goto('/');
  await card(page, 'Circle').getByRole('button', { name: 'Favorite Circle' }).click();
  await expect(favorites(page).getByRole('listitem')).toHaveCount(1);
  await expect.poll(() => stored(page)).toBe(1);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('aski-library', 1);
    open.onsuccess = () => {
      const transaction = open.result.transaction('records', 'readwrite');
      transaction.objectStore('records').put({ namespace: 'anonymous', id: '00000000-0000-4000-8000-0000000000ff', type: 'favorite', schemaVersion: 9, payload: {}, revision: 0 });
      transaction.oncomplete = () => { open.result.close(); resolve(); }; transaction.onerror = () => reject(transaction.error);
    };
  }));
  await page.reload();
  await expect(page.getByTestId('library-warning')).toHaveText('1 saved item could not be read and was kept unchanged.');
  await expect(favorites(page).getByRole('listitem')).toHaveCount(1);
  const kept = await page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open('aski-library', 1);
    open.onsuccess = () => { const get = open.result.transaction('records').objectStore('records').get(['anonymous', '00000000-0000-4000-8000-0000000000ff']); get.onsuccess = () => { open.result.close(); resolve(get.result?.schemaVersion); }; };
  }));
  expect(kept).toBe(9);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('favorites work with touch', async ({ page }) => {
    await page.goto('/');
    const emboss = card(page, 'Emboss');
    await emboss.getByRole('radio', { name: 'Emboss 2' }).tap();
    await emboss.getByRole('button', { name: 'Favorite Emboss 2' }).tap();
    await favorites(page).getByRole('button', { name: 'Emboss 2', exact: true }).tap();
    await expect(page.getByRole('heading', { level: 2, name: 'Emboss 2', exact: true })).toBeVisible();
    await favorites(page).getByRole('button', { name: 'Remove Emboss 2 from favorites' }).tap();
    await expect(favorites(page).getByRole('listitem')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
