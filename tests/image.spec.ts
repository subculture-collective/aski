import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const group = (page: Page) => page.getByRole('group', { name: 'Image export' });
async function download(page: Page, name: string) {
  const [file] = await Promise.all([page.waitForEvent('download'), group(page).getByRole('button', { name }).click()]);
  return { name: file.suggestedFilename(), bytes: readFileSync((await file.path())!) };
}
// Decodes an image in the page and returns its size and a few pixels.
const inspect = (page: Page, bytes: Buffer, type: string, points: [number, number][]) => page.evaluate(async ([base64, type, points]) => {
  const image = new Image();
  image.src = `data:${type};base64,${base64}`;
  await image.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width: image.naturalWidth, height: image.naturalHeight });
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  return { width: image.naturalWidth, height: image.naturalHeight, pixels: (points as [number, number][]).map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data)) };
}, [bytes.toString('base64'), type, points] as const);

test('PNG and SVG downloads match the chosen size, colors, padding and transparency', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('<b>&');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  const [columns, rows] = (await page.getByLabel('Output dimensions').textContent())!.match(/\d+/g)!.map(Number);
  await group(page).getByLabel('Scale').selectOption('3');
  await group(page).getByLabel('Padding (pixels)').fill('10');
  const width = columns * 24 + 20, height = rows * 48 + 20;
  await expect(page.getByTestId('image-size')).toContainText(`${width} × ${height} pixels`);
  const png = await download(page, 'Download PNG');
  expect(png.name).toMatch(/^aski-ansi-compact-.*\.png$/);
  expect([...png.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const opaque = await inspect(page, png.bytes, 'image/png', [[2, 2]]);
  expect([opaque.width, opaque.height]).toEqual([width, height]);
  expect(opaque.pixels[0]).toEqual([255, 255, 255, 255]);
  // Seamless block mode: a full-block run is solid foreground across cell edges.
  await page.getByRole('checkbox', { name: /Seamless blocks/ }).check();
  await group(page).getByRole('checkbox', { name: 'Transparent background' }).check();
  const text = (await page.getByTestId('output').textContent())!.split('\n');
  const row = text.findIndex(line => line.includes('██')), column = text[row].indexOf('██');
  const blocks = await download(page, 'Download PNG');
  const decoded = await inspect(page, blocks.bytes, 'image/png', [[2, 2], [10 + column * 24 + 23, 10 + row * 48 + 24], [10 + column * 24 + 24, 10 + row * 48 + 24]]);
  expect(decoded.pixels[0][3]).toBe(0);
  expect(decoded.pixels[1]).toEqual([33, 27, 48, 255]);
  expect(decoded.pixels[2]).toEqual([33, 27, 48, 255]);
  const svg = await download(page, 'Download SVG');
  const source = svg.bytes.toString('utf8');
  const parsed = await page.evaluate(source => {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    return { error: !!doc.querySelector('parsererror'), width: doc.documentElement.getAttribute('width'), scripts: doc.querySelectorAll('script,foreignObject').length };
  }, source);
  expect(parsed).toEqual({ error: false, width: String(width), scripts: 0 });
  const vector = await inspect(page, svg.bytes, 'image/svg+xml', [[10 + column * 24 + 23, 10 + row * 48 + 24], [10 + column * 24 + 24, 10 + row * 48 + 24]]);
  expect([vector.width, vector.height]).toEqual([width, height]);
  for (const pixel of vector.pixels) expect(pixel).toEqual([33, 27, 48, 255]);
  // Text mode escapes the input's markup characters.
  await page.getByRole('checkbox', { name: /Seamless blocks/ }).uncheck();
  await page.getByLabel('Style', { exact: true }).selectOption('figlet/letter');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  const letters = (await download(page, 'Download SVG')).bytes.toString('utf8');
  expect(await page.evaluate(source => !new DOMParser().parseFromString(source, 'image/svg+xml').querySelector('parsererror'), letters)).toBe(true);
  expect(letters).toContain('&lt;');
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('<b>&');
});

test('over-budget sizes explain the limit and keep exports disabled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('W'.repeat(200));
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await group(page).getByLabel('Scale').selectOption('8');
  await expect(page.getByTestId('image-size')).toContainText('Lower the scale or padding');
  await expect(group(page).getByRole('button', { name: 'Download PNG' })).toBeDisabled();
});
