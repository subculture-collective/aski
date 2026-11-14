import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeLibrary, openLibrary } from './ui.ts';
const saved = (page: Page) => page.getByRole('region', { name: 'Saved work' });
const item = (page: Page, label: string) => saved(page).getByRole('listitem', { name: label, exact: true });
const stored = (page: Page) => page.evaluate(() => new Promise<number>(resolve => {
  const open = indexedDB.open('aski-library');
  open.onsuccess = () => { const all = open.result.transaction('records').objectStore('records').count(); all.onsuccess = () => { open.result.close(); resolve(all.result); }; };
}));
async function ready(page: Page) { await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled(); }

test('text and designs save separately and each design restores its own variant and snapshot', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  const style = page.getByLabel('Style', { exact: true });
  const output = page.getByTestId('output');
  await input.fill('SAME\nINPUT');
  await openLibrary(page);
  await saved(page).getByRole('button', { name: 'Save text' }).click();
  await closeLibrary(page);
  await style.selectOption('figlet/future-thin'); await ready(page);
  const thin = await output.textContent();
  await openLibrary(page);
  await saved(page).getByRole('button', { name: 'Save design' }).click();
  await closeLibrary(page);
  await style.selectOption('figlet/circle'); await ready(page);
  const circle = await output.textContent();
  await openLibrary(page);
  await saved(page).getByRole('button', { name: 'Save design' }).click();
  await expect(saved(page).getByRole('list', { name: 'Saved designs' }).getByRole('listitem')).toHaveCount(2);
  await expect.poll(() => stored(page)).toBe(3);

  await page.reload();
  await input.fill('SOMETHING ELSE'); await style.selectOption('figlet/pagga');
  await openLibrary(page);
  await item(page, 'Design Future Thin: SAME').getByRole('button', { name: 'Future Thin: SAME' }).click();
  await expect(style).toHaveValue('figlet/future-thin'); await expect(input).toHaveValue('SAME\nINPUT'); await ready(page);
  await expect(output).toHaveText(thin!);
  // Opening an item closes the Library so the result is in view.
  await expect(page.locator('aside#library')).toBeHidden();
  await openLibrary(page);
  await item(page, 'Design Circle: SAME').getByRole('button', { name: 'Circle: SAME' }).click();
  await expect(style).toHaveValue('figlet/circle'); await ready(page);
  await expect(output).toHaveText(circle!);
  await expect(page.getByTestId('snapshot-differs')).toHaveCount(0);

  // Saved text reopens with whatever style is current.
  await closeLibrary(page);
  await style.selectOption('figlet/letter'); await input.fill('X');
  await openLibrary(page);
  await item(page, 'Text SAME').getByRole('button', { name: 'SAME', exact: true }).click();
  await expect(input).toHaveValue('SAME\nINPUT'); await expect(style).toHaveValue('figlet/letter');
  await closeLibrary(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(input).toHaveValue('X');
});

test('rename and delete persist; an unavailable renderer keeps current work and the saved text', async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  else await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('Permission denied')) } }));
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('KEEP'); await ready(page);
  await openLibrary(page);
  await saved(page).getByRole('button', { name: 'Save text' }).click();
  await saved(page).getByRole('button', { name: 'Save design' }).click();
  const text = item(page, 'Text KEEP');
  await text.getByRole('button', { name: 'Rename' }).click();
  await text.getByRole('textbox', { name: 'Name' }).fill('   ');
  await text.getByRole('button', { name: 'Save name' }).click();
  await expect(text.getByTestId('saved-note')).toHaveText('Use a name of 1–120 characters.');
  await text.getByRole('textbox', { name: 'Name' }).fill('Renamed text');
  await text.getByRole('textbox', { name: 'Name' }).press('Enter');
  await expect(item(page, 'Text Renamed text')).toBeVisible();
  const design = item(page, 'Design ANSI Compact: KEEP');
  await design.getByRole('button', { name: 'Delete' }).click();
  await design.getByRole('button', { name: 'Cancel' }).click();
  await design.getByRole('button', { name: 'Delete' }).click();
  await design.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(saved(page).getByText('No saved designs yet.')).toBeVisible();
  await expect.poll(() => stored(page)).toBe(1);
  await page.reload();
  await openLibrary(page);
  await expect(item(page, 'Text Renamed text')).toBeVisible();
  await expect(saved(page).getByText('No saved designs yet.')).toBeVisible();

  // A design saved by a renderer this build lacks.
  await page.evaluate(() => new Promise<void>(resolve => {
    const open = indexedDB.open('aski-library');
    open.onsuccess = () => {
      const transaction = open.result.transaction('records', 'readwrite');
      transaction.objectStore('records').put({ namespace: 'anonymous', id: '00000000-0000-4000-8000-0000000000aa', type: 'design', schemaVersion: 1, revision: 0, deletedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        payload: { name: 'Legacy', snapshot: { text: ' OLD\nART', columns: 4, rows: 2 },
          recipe: { schemaVersion: 1, id: '00000000-0000-4000-8000-0000000000ab', input: 'OLD', familyId: 'ansi-compact', variantId: 'ansi-compact.regular', fontSha256: 'f'.repeat(64), rendererVersion: 'figlet@0.1.0' } } });
      transaction.oncomplete = () => { open.result.close(); resolve(); };
    };
  }));
  await page.reload();
  await input.fill('UNSAVED WORK');
  await openLibrary(page);
  const legacy = item(page, 'Design Legacy');
  await legacy.getByRole('button', { name: 'Legacy' }).click();
  await expect(legacy.getByTestId('saved-note')).toContainText('needs a font or renderer');
  await expect(input).toHaveValue('UNSAVED WORK');
  await legacy.getByRole('button', { name: 'Copy saved text' }).click();
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(' OLD\nART');
  else { await expect(page.getByLabel('Text to copy')).toHaveValue(' OLD\nART'); await page.getByRole('button', { name: 'Done' }).click(); }
});
