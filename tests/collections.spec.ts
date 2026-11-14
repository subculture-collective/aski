import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { card, openLibrary } from './ui.ts';
const region = (page: Page, name: string) => page.getByRole('region', { name });
const collection = (page: Page, name: string) => region(page, 'Collections').getByRole('listitem', { name: `Collection ${name}`, exact: true });
const stored = (page: Page) => page.evaluate(() => new Promise<number>(resolve => {
  const open = indexedDB.open('aski-library');
  open.onsuccess = () => { const all = open.result.transaction('records').objectStore('records').count(); all.onsuccess = () => { open.result.close(); resolve(all.result); }; };
}));
async function setup(page: Page) {
  await page.goto('/');
  await card(page, 'Pagga').getByRole('button', { name: 'Favorite Pagga' }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('LOGO');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  // The library stays open from here on, except that opening an item closes it so the result is in view.
  await openLibrary(page);
  await region(page, 'Saved work').getByRole('button', { name: 'Save design' }).click();
}
async function create(page: Page, name: string) {
  await region(page, 'Collections').getByLabel('New collection').fill(name);
  await region(page, 'Collections').getByLabel('New collection').press('Enter');
  await expect(collection(page, name)).toBeVisible();
}
const pick = (page: Page, list: string, item: string) => region(page, list).getByRole('listitem').filter({ has: page.getByRole('button', { name: item, exact: true }) });

test('styles and designs join several collections and survive reload, rename and deletion', async ({ page }) => {
  await setup(page);
  await create(page, 'Project');
  await create(page, 'Ideas');
  await region(page, 'Collections').getByRole('button', { name: 'Create collection' }).click();
  await expect(page.getByTestId('collection-note')).toHaveText('Use a name of 1–120 characters.');
  const style = pick(page, 'Favorites', 'Pagga');
  await style.getByRole('button', { name: 'Collections' }).click();
  await style.getByRole('checkbox', { name: 'Project' }).check();
  const design = pick(page, 'Saved work', 'ANSI Compact: LOGO');
  await design.getByRole('button', { name: 'Collections' }).click();
  await design.getByRole('checkbox', { name: 'Project' }).check();
  await design.getByRole('checkbox', { name: 'Ideas' }).check();
  await expect(design.getByRole('button', { name: 'Collections (2)' })).toBeVisible();
  const project = collection(page, 'Project');
  await expect(project.getByRole('listitem')).toHaveText([/Style\s*Pagga/, /Design\s*ANSI Compact: LOGO/]);
  await expect(project.locator('li[data-kind=favorite] .kind')).toHaveText('Style');
  await expect(project.locator('li[data-kind=design] .kind')).toHaveText('Design');
  await expect.poll(() => stored(page)).toBe(7);

  await page.reload();
  await openLibrary(page);
  await expect(collection(page, 'Project').getByRole('listitem')).toHaveCount(2);
  await expect(collection(page, 'Ideas').getByRole('listitem')).toHaveCount(1);
  // Opening a style from a collection applies it to the current text.
  await collection(page, 'Project').getByRole('button', { name: 'Pagga', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Pagga', exact: true })).toBeVisible();
  await expect(page.locator('aside#library')).toBeHidden();
  await openLibrary(page);

  await collection(page, 'Ideas').getByRole('button', { name: 'Rename' }).click();
  await collection(page, 'Ideas').getByRole('textbox', { name: 'Name' }).fill('Later');
  await collection(page, 'Ideas').getByRole('button', { name: 'Save name' }).click();
  await expect(collection(page, 'Later')).toBeVisible();
  // Removing one membership keeps the design and its other membership.
  await collection(page, 'Project').getByRole('button', { name: 'Remove ANSI Compact: LOGO from Project' }).click();
  await expect(collection(page, 'Project').getByRole('listitem')).toHaveCount(1);
  await expect(collection(page, 'Later').getByRole('listitem')).toHaveCount(1);
  // Deleting a collection keeps its items.
  await collection(page, 'Project').getByRole('button', { name: 'Delete' }).click();
  await collection(page, 'Project').getByRole('button', { name: 'Confirm delete' }).click();
  await expect(collection(page, 'Project')).toHaveCount(0);
  await expect(pick(page, 'Favorites', 'Pagga')).toBeVisible();
  await expect(pick(page, 'Saved work', 'ANSI Compact: LOGO')).toBeVisible();
  // Deleting a design removes it from every collection.
  await pick(page, 'Saved work', 'ANSI Compact: LOGO').getByRole('button', { name: 'Delete' }).click();
  await pick(page, 'Saved work', 'ANSI Compact: LOGO').getByRole('button', { name: 'Confirm delete' }).click();
  await expect(collection(page, 'Later').getByRole('listitem')).toHaveCount(0);
  await expect.poll(() => stored(page)).toBe(2);
  await page.reload();
  await openLibrary(page);
  await expect(collection(page, 'Later')).toBeVisible();
  await expect(pick(page, 'Favorites', 'Pagga')).toBeVisible();
});

test('keyboard organizes a style and a design into a project collection', async ({ page }) => {
  await setup(page);
  await region(page, 'Collections').getByLabel('New collection').focus();
  await page.keyboard.type('Keys'); await page.keyboard.press('Enter');
  for (const item of [pick(page, 'Favorites', 'Pagga'), pick(page, 'Saved work', 'ANSI Compact: LOGO')]) {
    await item.getByRole('button', { name: 'Collections' }).focus(); await page.keyboard.press('Enter');
    await item.getByRole('checkbox', { name: 'Keys' }).focus(); await page.keyboard.press('Space');
  }
  await expect(collection(page, 'Keys').getByRole('listitem')).toHaveCount(2);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('touch organizes a style and a design into a project collection', async ({ page }) => {
    await setup(page);
    await create(page, 'Touch');
    for (const item of [pick(page, 'Favorites', 'Pagga'), pick(page, 'Saved work', 'ANSI Compact: LOGO')]) {
      await item.getByRole('button', { name: 'Collections' }).tap();
      await item.getByRole('checkbox', { name: 'Touch' }).tap();
    }
    await expect(collection(page, 'Touch').getByRole('listitem')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
