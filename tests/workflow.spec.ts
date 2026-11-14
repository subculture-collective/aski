import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { card, cardAction, closeLibrary, openCustomize, openFilters, openLibrary, selectVariant, useButton } from './ui.ts';
// The whole studio workflow in one session, for #65: find a family, switch variants, change text and
// colors, compare, collect, animate and download the GIF, then reload. The desktop projects use the mouse;
// the tablet and phone projects run the same steps with touch.
const touch = (name: string) => name === 'tablet' || name === 'phone';
test.use({ hasTouch: async ({}, use, info) => use(touch(info.project.name)) });
const settled = (page: Page) => expect(page.locator('.preview[aria-busy=true]')).toHaveCount(0);
const compare = (page: Page) => page.locator('section.compare');
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const topOf = async (locator: Locator) => { await locator.page().evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)))); return (await locator.boundingBox())!.y; };

test('find, vary, color, compare, collect, animate and download without losing the design', async ({ page }, info) => {
  const press = (locator: Locator) => touch(info.project.name) ? locator.tap() : locator.click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  const heading = page.getByRole('heading', { level: 2, name: 'Future Thin', exact: true });
  await input.fill('ASKI');

  // Find a family with search and a look filter, browse a variant and use it.
  await page.getByRole('search', { name: 'Find styles' }).getByLabel('Search styles').fill('future');
  await (await openFilters(page)).getByRole('checkbox', { name: 'Lines' }).check();
  await expect(page.locator('article.family-card h3')).toHaveText(['Future']);
  const future = card(page, 'Future');
  await selectVariant(future, 'Future Thin');
  await press(useButton(future));
  await expect(heading).toBeVisible();

  // A new line typed with the keyboard keeps the selection, the filter and the card where it was. With the
  // filter on, the card is near the bottom of the page, where WebKit's caret reveal used to move it.
  await future.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await settled(page);
  const top = await topOf(future);
  await input.focus(); await input.press('End'); await input.press('Enter'); await input.pressSequentially('STUDIO', { delay: 40 });
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  await settled(page);
  expect(Math.abs(await topOf(future) - top)).toBeLessThan(4);
  await expect(future).toBeInViewport();

  // Pin two variants to compare the same text; the card in use stays put.
  await cardAction(future, 'Pin Future Thin');
  await selectVariant(future, 'Future Smooth');
  await cardAction(future, 'Pin Future Smooth');
  await settled(page);
  await expect(compare(page)).toHaveAccessibleName('Compare (2)');
  expect(Math.abs(await topOf(future) - top)).toBeLessThan(4);
  await expect(compare(page).locator('pre')).toHaveCount(2);
  for (const art of await compare(page).locator('pre').allTextContents()) expect(art.split('\n').length).toBeGreaterThan(2);
  // Choosing a variant on the card in use applies it; Compare's Use goes back to the other one.
  await expect(page.getByRole('heading', { level: 2, name: 'Future Smooth', exact: true })).toBeVisible();
  await press(compare(page).getByTestId('pinned-figlet-future-thin').getByRole('button', { name: 'Use' }));
  await expect(heading).toBeVisible();

  // Colors.
  const colors = await openCustomize(page, 'Colors');
  await press(colors.getByRole('button', { name: '#FF4D6D' }));
  await expect(page.getByTestId('output')).toHaveCSS('color', rgb('#FF4D6D'));

  // Collect: favorite the family, save the design and put both in a collection.
  await press(future.getByRole('button', { name: 'Favorite Future Thin' }));
  const library = await openLibrary(page);
  await press(region(page, 'Saved work').getByRole('button', { name: 'Save design' }));
  await region(page, 'Collections').getByLabel('New collection').fill('Launch');
  await region(page, 'Collections').getByLabel('New collection').press('Enter');
  const collection = region(page, 'Collections').getByRole('listitem', { name: 'Collection Launch', exact: true });
  await expect(collection).toBeVisible();
  for (const [list, name] of [['Favorites', 'Future Thin'], ['Saved work', 'Future Thin: ASKI']]) {
    const item = region(page, list).getByRole('listitem').filter({ has: page.getByRole('button', { name, exact: true }) });
    await press(item.getByRole('button', { name: 'Collections' }));
    await item.getByRole('checkbox', { name: 'Launch' }).check();
  }
  await expect(collection.getByRole('listitem')).toHaveCount(2);
  await expect(library).toBeVisible();
  await closeLibrary(page);

  // Animate and download the GIF.
  const panel = await openCustomize(page, 'Animation');
  await press(panel.getByRole('radio', { name: 'Reveal' }));
  await panel.getByLabel('Duration (seconds)').fill('1'); await panel.getByLabel('Duration (seconds)').press('Enter');
  await panel.getByLabel('End hold (seconds)').fill('0'); await panel.getByLabel('End hold (seconds)').press('Enter');
  await panel.getByLabel('Frame rate').selectOption('10');
  const gif = page.getByRole('group', { name: 'GIF export' });
  await press(gif.getByRole('button', { name: 'Create GIF' }));
  await expect(page.getByTestId('gif-result')).toBeVisible({ timeout: 20_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), press(gif.getByRole('link', { name: 'Download GIF' }))]);
  expect(file.suggestedFilename()).toBe('aski-future-thin-aski-studio.gif');
  const bytes = readFileSync((await file.path())!);
  const parsed = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  expect(decompressFrames(parsed, true).reduce((sum, frame) => sum + frame.delay, 0)).toBe(1000);

  // Nothing chosen along the way was lost, and the page never scrolled sideways.
  await expect(heading).toBeVisible();
  await expect(input).toHaveValue('ASKI\nSTUDIO');
  await expect(page.getByTestId('output')).toHaveCSS('color', rgb('#FF4D6D'));
  await expect(compare(page)).toHaveAccessibleName('Compare (2)');
  await expect((await openFilters(page)).getByRole('checkbox', { name: 'Lines' })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // After a reload the draft, the animation and the collection are still there.
  await page.reload();
  await expect(heading).toBeVisible();
  await expect(input).toHaveValue('ASKI\nSTUDIO');
  await expect((await openCustomize(page, 'Animation')).getByRole('radio', { name: 'Reveal' })).toBeChecked();
  await openLibrary(page);
  await expect(region(page, 'Collections').getByRole('listitem', { name: 'Collection Launch', exact: true }).getByRole('listitem')).toHaveCount(2);
});
