import { test, expect } from '@playwright/test';
import { openCustomize } from './ui.ts';
test('seamless blocks draw without seams, only for supported fonts, and keep the text', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('HI');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  const text = await page.getByTestId('output').textContent();
  const toggle = page.getByRole('checkbox', { name: /Seamless blocks/ });
  await openCustomize(page, 'Layout');
  await toggle.check();
  await expect(page.getByTestId('seamless')).toBeVisible();
  expect(await page.getByTestId('output').textContent()).toBe(text);
  // Rasterize the SVG and sample across the edge between two horizontally adjacent full blocks.
  const lines = text!.split('\n');
  const row = lines.findIndex(line => line.includes('██'));
  const column = lines[row].indexOf('██');
  const pixels = await page.getByTestId('seamless').locator('svg').evaluate(async (svg, [row, column]) => {
    const image = new Image();
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const y = row * 16 + 8;
    return [column * 8 + 7, column * 8 + 8, column * 8 + 9].map(x => Array.from(context.getImageData(x, y, 1, 1).data));
  }, [row, column]);
  for (const pixel of pixels) expect(pixel).toEqual([33, 27, 48, 255]);
  await page.reload();
  await expect(page.getByTestId('seamless')).toBeVisible();
  await openCustomize(page, 'Layout');
  await expect(toggle).toBeChecked();
  await page.getByLabel('Style', { exact: true }).selectOption('figlet/pagga');
  await expect(toggle).toHaveCount(0);
  await expect(page.getByTestId('seamless')).toHaveCount(0);
  await page.getByLabel('Style', { exact: true }).selectOption('figlet/small-block');
  await expect(page.getByTestId('seamless')).toBeVisible();
});
