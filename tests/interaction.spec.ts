import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { card, cardMenuToggle, openCustomize, openDownload, openLibrary } from './ui.ts';
// Interactions found broken in real browsers on the live studio, kept here so they stay fixed.
const settled = (page: Page) => expect(page.locator('.preview[aria-busy=true]')).toHaveCount(0);
const ready = (page: Page) => expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
const style = (page: Page) => page.getByLabel('Style', { exact: true });

test('a click or tap anywhere on a style card picks that style', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  for (const [name, variantId, where] of [['Classy', 'figlet/classy', 'preview'], ['Circle', 'figlet/circle', 'corner']] as const) {
    const target = card(page, name);
    await target.scrollIntoViewIfNeeded();
    const box = (where === 'preview' ? await target.locator('.preview').boundingBox() : await target.boundingBox())!;
    // The middle of the preview art, or a point in the card's empty bottom-left corner.
    const x = where === 'preview' ? box.x + box.width / 2 : box.x + 8, y = where === 'preview' ? box.y + box.height / 2 : box.y + box.height - 8;
    await page.mouse.click(x, y);
    await expect(style(page)).toHaveValue(variantId);
    await expect(target).toHaveAttribute('data-active', 'true');
  }
});

test('the result keeps every row, indent and colour run in line, and wide art scrolls from its first column', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  const art = page.getByTestId('output');
  // Rows laid out by the browser match the rows of text: colour runs flow inline and blank rows are kept.
  const rowsMatch = () => art.evaluate(element => {
    const body = element.querySelector('.art-body') as HTMLElement;
    const rows = body.textContent!.replace(/\n$/, '').split('\n').length;
    const line = parseFloat(getComputedStyle(body).lineHeight);
    return Math.abs(body.getBoundingClientRect().height - rows * line) <= rows;
  });
  await input.fill('ASKI');
  for (const variantId of ['ansi-compact.regular', 'figlet/linguaholic-shadow-3d', 'figlet/classy']) {
    await style(page).selectOption(variantId); await ready(page);
    expect(await rowsMatch(), variantId).toBe(true);
  }
  await style(page).selectOption('ansi-compact.regular');
  await input.fill('ABCDEFGHIJKLMNOPQRSTUVWXYZ ABCDEFGHIJKLMNOPQRSTUVWXYZ'); await ready(page);
  const edges = await art.evaluate(element => {
    element.scrollLeft = 0;
    return { box: element.getBoundingClientRect().left, art: element.querySelector('.art-body')!.getBoundingClientRect().left, wide: element.scrollWidth > element.clientWidth };
  });
  expect(edges.wide).toBe(true);
  expect(edges.art).toBeGreaterThanOrEqual(edges.box);
});

test('menus and the library close on Escape and on a click outside, and focus returns to what opened them', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const download = page.locator('.output-actions details.menu');
  await openDownload(page);
  await page.keyboard.press('Escape');
  await expect(download).not.toHaveAttribute('open');
  await expect(download.locator('summary')).toBeFocused();
  // Choosing an item closes the menu, so the share link it makes is not hidden behind it.
  await (await openDownload(page)).getByRole('button', { name: 'Share link' }).click();
  await expect(download).not.toHaveAttribute('open');
  await expect(page.getByLabel(/^Share link \(/)).toBeVisible();
  const classy = card(page, 'Classy');
  await cardMenuToggle(classy).click();
  await expect(classy.locator('details.card-menu')).toHaveAttribute('open');
  await page.mouse.click(5, 5);
  await expect(classy.locator('details.card-menu')).not.toHaveAttribute('open');

  const library = await openLibrary(page);
  await expect(library.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(library).toBeHidden();
  await expect(page.getByRole('button', { name: 'Library', exact: true })).toBeFocused();
});

test('undo and redo shortcuts keep working after the history buttons hide and from radio buttons', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('ONE');
  await ready(page);
  // The last undo hides the Undo button; focus moves to Redo instead of falling to the page.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  while (await undo.isVisible()) await undo.click();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeFocused();
  await page.keyboard.press('Control+Shift+Z');
  await expect(input).toHaveValue('ONE');
  const layout = await openCustomize(page, 'Layout');
  await layout.getByRole('radio', { name: 'Right' }).check();
  await expect(layout.getByRole('radio', { name: 'Right' })).toBeFocused();
  await page.keyboard.press('Control+Z');
  await expect(layout.getByRole('radio', { name: 'Right' })).not.toBeChecked();
  // A keyboard undo in the text field leaves the caret where the change was.
  await input.fill('hello world');
  await input.press('Home');
  await input.press('ArrowRight'); await input.press('ArrowRight');
  await page.keyboard.type('X');
  await expect(input).toHaveValue('heXllo world');
  await page.keyboard.press('Control+Z');
  await expect(input).toHaveValue('hello world');
  expect(await input.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(2);
});

test('the small copy bar appears once Copy text is out of sight and confirms a copy', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } }));
  await page.goto('/');
  await ready(page);
  const bar = page.locator('.copy-bar');
  await expect(bar).toBeHidden();
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(bar).toBeVisible();
  await bar.getByRole('button').click();
  await expect(bar.getByRole('button')).toHaveText('Copied');
  // At the bottom of the page the bar leaves the footer links clear.
  const footer = await page.locator('footer a').first().boundingBox();
  const barBox = await bar.boundingBox();
  expect(footer!.y + footer!.height <= barBox!.y || footer!.x + footer!.width <= barBox!.x).toBe(true);
});
