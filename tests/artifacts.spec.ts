import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const saved = (page: Page) => page.getByRole('region', { name: 'Saved work' });
const files = (page: Page) => page.evaluate(() => new Promise<number>(resolve => {
  const open = indexedDB.open('aski-library');
  open.onsuccess = () => { const count = open.result.transaction('artifacts').objectStore('artifacts').count(); count.onsuccess = () => { open.result.close(); resolve(count.result); }; };
}));
// Stores a design saved by an older renderer together with a file whose bytes this build could never make.
const seed = (page: Page, damaged = false) => page.evaluate(async damaged => {
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><!-- original --></svg>');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  const now = '2026-01-01T00:00:00.000Z', file = '00000000-0000-4000-8000-0000000000f1';
  const design = (id: string, name: string) => ({ namespace: 'anonymous', id, type: 'design', schemaVersion: 1, revision: 0, deletedAt: null, createdAt: now, updatedAt: now,
    payload: { name, artifacts: [file], snapshot: { text: 'OLD', columns: 3, rows: 1 },
      recipe: { schemaVersion: 1, id: '00000000-0000-4000-8000-0000000000e1', input: 'OLD', familyId: 'ansi-compact', variantId: 'ansi-compact.regular', fontSha256: 'f'.repeat(64), rendererVersion: 'figlet@0.1.0' } } });
  await new Promise<void>(resolve => {
    const open = indexedDB.open('aski-library');
    open.onsuccess = () => {
      const transaction = open.result.transaction(['records', 'artifacts'], 'readwrite');
      transaction.objectStore('records').put(design('00000000-0000-4000-8000-0000000000d1', 'Legacy one'));
      transaction.objectStore('records').put(design('00000000-0000-4000-8000-0000000000d2', 'Legacy two'));
      transaction.objectStore('artifacts').put({ namespace: 'anonymous', id: file, sha256: damaged ? '0'.repeat(64) : hash, mime: 'image/svg+xml', byteLength: bytes.length, width: 10, height: 5,
        provenance: { variantId: 'ansi-compact.regular', fontSha256: 'f'.repeat(64), rendererVersion: 'figlet@0.1.0' }, createdAt: now, bytes });
      transaction.oncomplete = () => { open.result.close(); resolve(); };
    };
  });
  return new TextDecoder().decode(bytes);
}, damaged);

test('saved designs keep chosen PNG and SVG files exactly as exported', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('KEEP');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await saved(page).getByRole('checkbox', { name: 'PNG' }).check();
  await saved(page).getByRole('checkbox', { name: 'SVG' }).check();
  await saved(page).getByRole('button', { name: 'Save design' }).click();
  const list = saved(page).getByRole('list', { name: 'Original files for ANSI Compact: KEEP' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect.poll(() => files(page)).toBe(2);
  await page.reload();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  const [png] = await Promise.all([page.waitForEvent('download'), list.getByRole('listitem').filter({ hasText: 'PNG' }).getByRole('button', { name: 'Download original' }).click()]);
  expect([...readFileSync((await png.path())!).subarray(0, 4)]).toEqual([137, 80, 78, 71]);
});

test('originals survive renderer changes, shared files outlive one design and damage is reported', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('CURRENT');
  const original = await seed(page);
  await page.reload();
  const one = saved(page).getByRole('listitem', { name: 'Design Legacy one', exact: true });
  const [file] = await Promise.all([page.waitForEvent('download'), one.getByRole('button', { name: 'Download original' }).click()]);
  expect(readFileSync((await file.path())!, 'utf8')).toBe(original);
  // The recipe cannot be rendered by this build, but its original file is still available.
  await one.getByRole('button', { name: 'Legacy one', exact: true }).click();
  await expect(one.getByTestId('saved-note')).toContainText('needs a font or renderer');
  await one.getByRole('button', { name: 'Delete' }).click(); await one.getByRole('button', { name: 'Confirm delete' }).click();
  await expect.poll(() => files(page)).toBe(1);
  const two = saved(page).getByRole('listitem', { name: 'Design Legacy two', exact: true });
  await two.getByRole('button', { name: 'Delete' }).click(); await two.getByRole('button', { name: 'Confirm delete' }).click();
  await expect.poll(() => files(page)).toBe(0);
  await seed(page, true);
  await page.reload();
  const damaged = saved(page).getByRole('listitem', { name: 'Design Legacy one', exact: true });
  await damaged.getByRole('button', { name: 'Download original' }).click();
  await expect(damaged.getByTestId('saved-note')).toHaveText('This saved file is damaged.');
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('CURRENT');
});

test('a full file store keeps the design and the draft', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'artifacts') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('FULL');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await saved(page).getByRole('checkbox', { name: 'PNG' }).check();
  await saved(page).getByRole('button', { name: 'Save design' }).click();
  await expect(saved(page).getByRole('alert')).toHaveText('The design is saved, but this browser had no room to keep its exported files.');
  await expect(saved(page).getByRole('listitem', { name: 'Design ANSI Compact: FULL', exact: true })).toBeVisible();
  await page.reload();
  await expect(saved(page).getByRole('listitem', { name: 'Design ANSI Compact: FULL', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('FULL');
});
