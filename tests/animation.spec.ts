import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const panel = (page: Page) => page.getByRole('region', { name: 'Animation' });
const preview = (page: Page) => page.getByTestId('animation-preview');
const dims = async (page: Page) => {
  const lines = (await preview(page).textContent())!.split('\n');
  return { rows: lines.length, widths: new Set(lines.map(line => Array.from(line).length)) };
};

test('typewriter and reveal keep a fixed canvas and stay selected while editing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('TYPE');
  await panel(page).getByRole('radio', { name: 'Typewriter' }).check();
  await expect(preview(page)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Pause' })).toBeVisible();
  // Frames advance while playing and every sample has the final artwork's size.
  const seen = new Set<string>();
  const rows = (await page.getByTestId('output').textContent())!.replace(/\n$/, '').split('\n');
  for (let i = 0; i < 6; i++) {
    const { rows: count, widths } = await dims(page);
    expect(count).toBe(rows.length);
    expect([...widths]).toEqual([Math.max(...rows.map(row => Array.from(row).length))]);
    seen.add((await preview(page).textContent())!);
    await page.waitForTimeout(250);
  }
  expect(seen.size).toBeGreaterThan(1);
  await input.fill('TYPE\nMORE');
  await expect(panel(page).getByRole('radio', { name: 'Typewriter' })).toBeChecked();
  await expect.poll(async () => (await dims(page)).rows).toBeGreaterThan(rows.length);
  await panel(page).getByRole('radio', { name: 'Reveal' }).check();
  await panel(page).getByRole('radio', { name: 'Right to left' }).check();
  await panel(page).getByRole('button', { name: 'Pause' }).click();
  const paused = await preview(page).textContent();
  await page.waitForTimeout(300);
  expect(await preview(page).textContent()).toBe(paused);
  await page.reload();
  await expect(panel(page).getByRole('radio', { name: 'Right to left' })).toBeChecked();
  await expect(input).toHaveValue('TYPE\nMORE');
});

test('reduced motion starts the preview paused', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await panel(page).getByRole('radio', { name: 'Reveal' }).check();
  await expect(panel(page).getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.getByTestId('frame-label')).toHaveText('Frame 1 of 36');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('frame-label')).toHaveText('Frame 1 of 36');
  await panel(page).getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('frame-label')).not.toHaveText('Frame 1 of 36');
});
