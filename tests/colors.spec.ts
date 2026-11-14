import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openCustomize } from './ui.ts';
const colors = (page: Page) => page.getByRole('region', { name: 'Colors' });
const output = (page: Page) => page.getByTestId('output');
const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
async function ready(page: Page) { await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled(); }

test('slots follow font mappings; swatches, custom colors, presets and reset keep the text intact', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill(' AK\nB'); await ready(page);
  const text = await output(page).textContent();
  await openCustomize(page, 'Colors');
  await expect(colors(page).getByRole('radio')).toHaveCount(2);
  await colors(page).getByRole('button', { name: '#FF4D6D' }).click();
  await expect(output(page)).toHaveCSS('color', rgb('#FF4D6D'));
  await colors(page).getByRole('radio', { name: /Background/ }).check();
  await colors(page).getByLabel('Custom background color').fill('112233');
  await colors(page).getByRole('button', { name: 'Apply' }).click();
  await expect(output(page)).toHaveCSS('background-color', rgb('#112233'));
  // Invalid input keeps the last valid color and the artwork.
  await colors(page).getByLabel('Custom background color').fill('#12');
  await colors(page).getByRole('button', { name: 'Apply' }).click();
  await expect(colors(page).getByRole('alert')).toHaveText('Enter a color as #RRGGBB.');
  await expect(output(page)).toHaveCSS('background-color', rgb('#112233'));
  await expect(output(page)).toHaveText(text!);
  expect(await output(page).textContent()).toBe(text);

  await page.getByLabel('Style', { exact: true }).selectOption('figlet/linguaholic-shadow-3d'); await ready(page);
  await expect(colors(page).getByRole('radio')).toHaveCount(3);
  await colors(page).getByRole('radio', { name: /Shadow/ }).check();
  await colors(page).getByRole('button', { name: '#00FF66' }).click();
  await expect(output(page).locator('.slot-shadow').first()).toHaveCSS('color', rgb('#00FF66'));
  const shadowText = await output(page).textContent();
  expect(await output(page).locator('.slot-shadow').allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(/^[╔╗╚╝═║]+$/)]));
  // Foreground stays on the faces; the background color shows behind spaces.
  await expect(output(page)).toHaveCSS('color', rgb('#FF4D6D'));
  await colors(page).getByRole('button', { name: 'Terminal' }).click();
  await expect(output(page)).toHaveCSS('background-color', rgb('#000000'));
  await expect(output(page).locator('.slot-shadow').first()).toHaveCSS('color', rgb('#007A33'));
  await colors(page).getByRole('button', { name: 'Reset colors' }).click();
  await expect(output(page)).toHaveCSS('color', rgb('#211B30'));
  expect(await output(page).textContent()).toBe(shadowText);
  // Switching to an unmapped font hides the shadow slot.
  await page.getByLabel('Style', { exact: true }).selectOption('figlet/emboss'); await ready(page);
  await expect(colors(page).getByRole('radio')).toHaveCount(2);
  await expect(output(page).locator('.slot-shadow')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('colors join undo history, survive reload and save as reusable palettes', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await openCustomize(page, 'Colors');
  await colors(page).getByRole('button', { name: '#3A86FF' }).click();
  await expect(output(page)).toHaveCSS('color', rgb('#3A86FF'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(output(page)).toHaveCSS('color', rgb('#211B30'));
  await expect(page.getByRole('status')).toHaveText('');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(output(page)).toHaveCSS('color', rgb('#3A86FF'));
  await colors(page).getByLabel('Palette name').fill('Ocean');
  await colors(page).getByRole('button', { name: 'Save palette' }).click();
  await colors(page).getByRole('button', { name: 'Reset colors' }).click();
  await page.reload();
  await expect(output(page)).toHaveCSS('color', rgb('#211B30'));
  await page.getByLabel('Style', { exact: true }).selectOption('figlet/pagga');
  await openCustomize(page, 'Colors');
  await colors(page).getByRole('button', { name: 'Ocean', exact: true }).click();
  await expect(output(page)).toHaveCSS('color', rgb('#3A86FF'));
  await page.reload();
  await expect(output(page)).toHaveCSS('color', rgb('#3A86FF'));
  await openCustomize(page, 'Colors');
  await colors(page).getByRole('button', { name: 'Delete palette Ocean' }).click();
  await expect(colors(page).getByRole('list', { name: 'Saved palettes' })).toHaveCount(0);
});
