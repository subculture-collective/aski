import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { openCustomize, openDownload } from './ui.ts';
const panel = (page: Page) => page.getByRole('region', { name: 'Animation' });
const gif = (page: Page) => page.getByRole('group', { name: 'GIF export' });
function decode(bytes: Buffer) {
  const parsed = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return { frames: decompressFrames(parsed, true), loops: parsed.frames.some(frame => 'application' in frame && frame.application.id === 'NETSCAPE2.0') };
}
async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('GIF');
  await openCustomize(page, 'Animation');
  await panel(page).getByRole('radio', { name: 'Reveal' }).check();
  await panel(page).getByLabel('Duration (seconds)').fill('1'); await panel(page).getByLabel('Duration (seconds)').press('Enter');
  await panel(page).getByLabel('End hold (seconds)').fill('0.5'); await panel(page).getByLabel('End hold (seconds)').press('Enter');
  await panel(page).getByLabel('Frame rate').selectOption('10');
  await expect(page.getByTestId('gif-size')).toContainText('15 frames, 1.5 s, looping');
}
async function create(page: Page) {
  await gif(page).getByRole('button', { name: 'Create GIF' }).click();
  await expect(page.getByTestId('gif-result')).toBeVisible({ timeout: 20_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), gif(page).getByRole('link', { name: 'Download GIF' }).click()]);
  return { name: file.suggestedFilename(), bytes: readFileSync((await file.path())!) };
}

test('GIFs keep the configured timing, loop, disposal and transparency', async ({ page }) => {
  await setup(page);
  const opaque = await create(page);
  expect(opaque.name).toBe('aski-ansi-compact-gif.gif');
  const decoded = decode(opaque.bytes);
  expect(decoded.loops).toBe(true);
  expect(decoded.frames.reduce((sum, frame) => sum + frame.delay, 0)).toBe(1500);
  expect(decoded.frames.every(frame => frame.disposalType === 1)).toBe(true);
  // The reveal's last frame and the hold are identical, so they are stored once.
  expect(decoded.frames.length).toBeLessThan(15);
  await expect(page.getByTestId('gif-result')).toContainText(`${decoded.frames.length} stored frames`);
  await expect(page.getByRole('img', { name: 'Encoded GIF sample' })).toBeVisible();
  const [width, height] = (await page.getByTestId('gif-size').textContent())!.match(/\d+/g)!.map(Number);
  expect([decoded.frames[0].dims.width, decoded.frames[0].dims.height]).toEqual([width, height]);
  expect(Array.from(decoded.frames.at(-1)!.patch.slice(0, 4))).toEqual([255, 255, 255, 255]);
  await panel(page).getByRole('radio', { name: 'Play once' }).check();
  await gif(page).getByRole('checkbox', { name: 'Transparent background' }).check();
  await expect(gif(page).getByRole('link', { name: 'Download GIF' })).toHaveCount(0);
  const clear = decode((await create(page)).bytes);
  expect(clear.loops).toBe(false);
  expect(clear.frames.every(frame => frame.disposalType === 2)).toBe(true);
  expect(clear.frames.at(-1)!.patch[3]).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('GIF');
});

test('encoding can be cancelled and restarted; over-budget GIFs explain the limit', async ({ page }) => {
  await setup(page);
  // Hold the encoder script so the job is still starting when Cancel is pressed.
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/gif.worker*.js', async route => { await held; await route.continue().catch(() => {}); });
  await gif(page).getByRole('button', { name: 'Create GIF' }).click();
  await expect(page.getByTestId('gif-progress')).toHaveText('Frame 0 of 15');
  await gif(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(gif(page).getByRole('button', { name: 'Create GIF' })).toBeEnabled();
  await expect(page.getByTestId('gif-result')).toHaveCount(0);
  release(); await page.unroute('**/assets/gif.worker*.js');
  expect(decode((await create(page)).bytes).frames.length).toBeGreaterThan(1);
  await panel(page).getByLabel('Frame rate').selectOption('30');
  await panel(page).getByLabel('Duration (seconds)').fill('20'); await panel(page).getByLabel('Duration (seconds)').press('Enter');
  await expect(page.getByTestId('gif-size')).toContainText('at most 600 frames');
  await expect(gif(page).getByRole('button', { name: 'Create GIF' })).toBeDisabled();
});

test('the inspected frame exports through the still image controls', async ({ page }) => {
  await setup(page);
  await panel(page).getByRole('slider', { name: 'Frame' }).fill('3');
  const still = (await openDownload(page)).getByRole('group', { name: 'Image export' });
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), still.getByRole('button', { name: 'Download SVG' }).click()]);
    return readFileSync((await file.path())!, 'utf8');
  };
  const finished = await download();
  await still.getByRole('checkbox', { name: 'Export the inspected animation frame (frame 3)' }).check();
  const partial = await download();
  expect(partial.length).toBeLessThan(finished.length);
});
