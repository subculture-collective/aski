import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { closeLibrary, openCustomize, openDownload, openLibrary } from './ui.ts';
const panel = (page: Page) => page.getByRole('region', { name: 'Animation' });
const gif = (page: Page) => page.getByRole('group', { name: 'GIF export' });
async function animate(page: Page) {
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('MOVE');
  await openCustomize(page, 'Animation');
  await panel(page).getByRole('radio', { name: 'Glitch' }).check();
  await panel(page).getByRole('slider', { name: 'Intensity' }).fill('4');
  await panel(page).getByRole('button', { name: 'New glitch pattern' }).click();
  await panel(page).getByLabel('Frame rate').selectOption('10');
  await panel(page).getByLabel('Duration (seconds)').fill('1'); await panel(page).getByLabel('Duration (seconds)').press('Enter');
  return (await panel(page).getByText(/^Pattern \d+\./).textContent())!;
}

test('a saved design keeps its animation settings and the original GIF', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const pattern = await animate(page);
  await gif(page).getByRole('button', { name: 'Create GIF' }).click();
  await expect(page.getByTestId('gif-result')).toBeVisible({ timeout: 20_000 });
  const [made] = await Promise.all([page.waitForEvent('download'), gif(page).getByRole('link', { name: 'Download GIF' }).click()]);
  const bytes = readFileSync((await made.path())!);
  await gif(page).getByRole('button', { name: 'Save design with this GIF' }).click();
  await expect(page.getByTestId('gif-save-note')).toHaveText('Saved with this GIF in Saved work.');
  const saved = page.getByRole('region', { name: 'Saved work' }).getByRole('listitem', { name: 'Design ANSI Compact: MOVE', exact: true });
  await openLibrary(page);
  await expect(saved.getByText(/^Original GIF/)).toBeVisible();
  // Wait until the design and its GIF are stored before reloading.
  await expect.poll(() => page.evaluate(() => new Promise<number>(resolve => {
    const open = indexedDB.open('aski-library');
    open.onsuccess = () => { const count = open.result.transaction('artifacts').objectStore('artifacts').count(); count.onsuccess = () => { open.result.close(); resolve(count.result); }; };
  }))).toBe(1);
  // Change everything, reload, then reopen the design.
  await page.reload();
  await openCustomize(page, 'Animation');
  await panel(page).getByRole('radio', { name: 'Reveal' }).check();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('OTHER');
  await openLibrary(page);
  await saved.getByRole('button', { name: 'ANSI Compact: MOVE', exact: true }).click();
  await expect(panel(page).getByRole('radio', { name: 'Glitch' })).toBeChecked();
  await expect(panel(page).getByRole('slider', { name: 'Intensity' })).toHaveValue('4');
  await expect(panel(page).getByText(/^Pattern \d+\./)).toHaveText(pattern);
  await expect(panel(page).getByLabel('Frame rate')).toHaveValue('10');
  const [original] = await Promise.all([page.waitForEvent('download'), saved.getByRole('button', { name: 'Download original' }).click()]);
  expect(original.suggestedFilename()).toMatch(/\.gif$/);
  expect(readFileSync((await original.path())!).equals(bytes)).toBe(true);
});

test('an animated share opens in a fresh session without library data and respects reduced motion', async ({ page, browser }) => {
  await page.goto('/');
  const pattern = await animate(page);
  await (await openLibrary(page)).getByRole('region', { name: 'Saved work' }).getByRole('button', { name: 'Save text' }).click();
  await closeLibrary(page);
  await (await openDownload(page)).getByRole('button', { name: 'Share link' }).click();
  const link = await page.getByLabel(/^Share link \(\d+ characters\)$/).inputValue();
  const fresh = await browser.newContext({ reducedMotion: 'reduce' });
  const other = await fresh.newPage();
  await other.goto(link);
  await expect(other.getByTestId('share-notice')).toContainText('Opened a shared design');
  await openCustomize(other, 'Animation');
  await expect(panel(other).getByRole('radio', { name: 'Glitch' })).toBeChecked();
  await expect(panel(other).getByText(/^Pattern \d+\./)).toHaveText(pattern);
  await expect(panel(other).getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(other.getByTestId('frame-label')).toHaveText('Frame 1 of 20');
  await expect((await openLibrary(other)).getByRole('region', { name: 'Saved work' }).getByText('No saved text yet.')).toBeVisible();
  await fresh.close();
});
