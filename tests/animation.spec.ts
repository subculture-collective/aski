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

test('transport, seeking and timing settings survive text and color edits', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('SEEK');
  await panel(page).getByRole('radio', { name: 'Reveal' }).check();
  const scrubber = panel(page).getByRole('slider', { name: 'Frame' });
  await expect(scrubber).toHaveAttribute('max', '36');
  await scrubber.fill('12');
  await expect(page.getByTestId('frame-label')).toHaveText('Frame 12 of 36');
  const atTwelve = await preview(page).textContent();
  await scrubber.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('frame-label')).toHaveText('Frame 12 of 36');
  expect(await preview(page).textContent()).toBe(atTwelve);
  // Timing: 1 s + 0.5 s hold at 10 fps = 15 frames.
  await panel(page).getByLabel('Duration (seconds)').fill('1');
  await panel(page).getByLabel('Duration (seconds)').press('Enter');
  await panel(page).getByLabel('End hold (seconds)').fill('0.5');
  await panel(page).getByLabel('End hold (seconds)').press('Enter');
  await panel(page).getByLabel('Frame rate').selectOption('10');
  await expect(scrubber).toHaveAttribute('max', '15');
  await panel(page).getByLabel('Duration (seconds)').fill('99');
  await panel(page).getByLabel('Duration (seconds)').press('Enter');
  await expect(panel(page).getByRole('alert')).toContainText('Duration must be a whole number from 500 to 20000');
  await expect(scrubber).toHaveAttribute('max', '15');
  await panel(page).getByLabel('Duration (seconds)').fill('1');
  await panel(page).getByLabel('Duration (seconds)').press('Enter');
  // Play once stops on the last frame.
  await panel(page).getByRole('radio', { name: 'Play once' }).check();
  await panel(page).getByRole('button', { name: 'Restart' }).click();
  await expect(page.getByTestId('frame-label')).toHaveText('Frame 15 of 15', { timeout: 5000 });
  await expect(panel(page).getByRole('button', { name: 'Play' })).toBeVisible();
  // Edits keep every transport setting.
  await input.fill('SEEK\nAGAIN');
  await page.getByRole('region', { name: 'Colors' }).getByRole('button', { name: '#FF4D6D' }).click();
  await expect(panel(page).getByRole('radio', { name: 'Reveal' })).toBeChecked();
  await expect(panel(page).getByRole('radio', { name: 'Play once' })).toBeChecked();
  await expect(panel(page).getByLabel('Frame rate')).toHaveValue('10');
  await expect(panel(page).getByLabel('End hold (seconds)')).toHaveValue('0.5');
  await expect(scrubber).toHaveAttribute('max', '15');
  await page.reload();
  await expect(scrubber).toHaveAttribute('max', '15');
  await expect(panel(page).getByRole('radio', { name: 'Play once' })).toBeChecked();
});
