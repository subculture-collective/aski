import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openCustomize } from './ui.ts';
const layout = (page: Page) => page.getByRole('region', { name: 'Layout' });
const output = (page: Page) => page.getByTestId('output');
const size = async (page: Page) => {
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  const [columns, rows] = (await page.getByLabel('Output dimensions').textContent())!.match(/\d+/g)!.map(Number);
  const lines = (await output(page).textContent())!.replace(/\n$/, '').split('\n');
  expect(rows).toBe(lines.length);
  expect(columns).toBe(Math.max(...lines.map(line => Array.from(line).length)));
  return { columns, rows, lines };
};

test('spacing modes follow font capability and keep word gaps', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('A B');
  await openCustomize(page, 'Layout');
  await expect(layout(page).getByRole('radio', { name: 'Font default (fitted)' })).toBeChecked();
  await expect(layout(page).getByRole('radio', { name: 'Smushed' })).toBeDisabled();
  await expect(layout(page).getByText('ANSI Compact defines no smushing rules')).toBeVisible();
  await page.getByLabel('Style', { exact: true }).selectOption('figlet/letter');
  await expect(layout(page).getByRole('radio', { name: 'Font default (full)' })).toBeChecked();
  const full = await size(page);
  await layout(page).getByRole('radio', { name: 'Fitted', exact: true }).check();
  const fitted = await size(page);
  expect(full.columns).toBeGreaterThan(fitted.columns);
  for (const lines of [fitted.lines, full.lines]) {
    const gap = Array.from({ length: Math.max(...lines.map(l => l.length)) }, (_, c) => lines.every(l => (l[c] ?? ' ') === ' ')).slice(1, -1);
    expect(gap).toContain(true);
  }
  // The chosen mode stays when the font changes.
  await page.getByLabel('Style', { exact: true }).selectOption('figlet/future');
  await expect(layout(page).getByRole('radio', { name: 'Fitted', exact: true })).toBeChecked();
});

test('maximum width and alignment change the output dimensions and persist with history', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await page.getByLabel('Style', { exact: true }).selectOption('figlet/future');
  await input.fill('ONE TWO THREE FOUR');
  const wide = await size(page);
  await openCustomize(page, 'Layout');
  await layout(page).getByLabel('Maximum width').fill('10');
  await layout(page).getByRole('button', { name: 'Set width' }).click();
  await expect(layout(page).getByRole('alert')).toContainText('from 20 to 1000');
  expect((await size(page)).rows).toBe(wide.rows);
  await layout(page).getByLabel('Maximum width').fill('30');
  await layout(page).getByRole('button', { name: 'Set width' }).click();
  await expect(layout(page).getByText('Lines wrap between words at 30 columns.')).toBeVisible();
  const wrapped = await size(page);
  expect(wrapped.columns).toBeLessThanOrEqual(30);
  expect(wrapped.rows).toBeGreaterThan(wide.rows);
  await layout(page).getByRole('radio', { name: 'Right' }).check();
  await expect.poll(async () => (await size(page)).lines.at(-1)!.startsWith(' ')).toBe(true);
  const right = await size(page);
  expect(right.columns).toBe(wrapped.columns);
  await page.reload();
  await openCustomize(page, 'Layout');
  await expect(layout(page).getByRole('radio', { name: 'Right' })).toBeChecked();
  expect((await size(page)).lines).toEqual(right.lines);
  await layout(page).getByRole('button', { name: 'No limit' }).click();
  expect((await size(page)).rows).toBe(wide.rows);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await size(page)).lines).toEqual(right.lines);
  await layout(page).getByRole('radio', { name: 'Right' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(layout(page).getByRole('radio', { name: 'Center' })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
