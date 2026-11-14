import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
// Shared ways to reach the studio's controls. Every menu and panel starts closed after each page load,
// so each helper opens what it needs and is safe to call when it is already open.

export type Panel = 'Colors' | 'Layout' | 'Animation';

const expanded = async (control: Locator) => await control.getAttribute('aria-expanded') === 'true';
const isOpen = (details: Locator) => details.evaluate(element => (element as HTMLDetailsElement).open);

/** Opens Customize and the named tab, and returns that panel's region. */
export async function openCustomize(page: Page, panel: Panel) {
  const toggle = page.getByRole('button', { name: 'Customize', exact: true });
  if (!await expanded(toggle)) await toggle.click();
  const tab = page.getByRole('group', { name: 'Customize', exact: true }).getByRole('button', { name: panel, exact: true });
  if (!await expanded(tab)) await tab.click();
  const region = page.getByRole('region', { name: panel, exact: true });
  await expect(region).toBeVisible();
  return region;
}

const downloadMenu = (page: Page) => page.locator('.output-actions details.menu');
/** Opens the result card's Download menu and returns its Export group. */
export async function openDownload(page: Page) {
  const menu = downloadMenu(page);
  if (!await isOpen(menu)) await menu.locator('summary').click();
  const group = page.getByRole('group', { name: 'Export', exact: true });
  await expect(group).toBeVisible();
  return group;
}
/** Closes the Download menu so it no longer covers the controls below it. */
export async function closeDownload(page: Page) {
  const menu = downloadMenu(page);
  if (await isOpen(menu)) await menu.locator('summary').click();
  await expect(page.getByRole('group', { name: 'Export', exact: true })).toBeHidden();
}

const library = (page: Page) => page.locator('aside#library');
/** Opens the Library panel from the header and returns it. */
export async function openLibrary(page: Page) {
  const toggle = page.getByRole('button', { name: 'Library', exact: true });
  if (!await library(page).isVisible()) await toggle.click();
  await expect(library(page)).toBeVisible();
  return library(page);
}
/** Closes the Library panel; on a phone it covers the page. */
export async function closeLibrary(page: Page) {
  if (await library(page).isVisible()) await library(page).locator('.library-heading').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(library(page)).toBeHidden();
}
/** Opens the Library and returns one of its regions: Saved work, Favorites or Collections. */
export async function libraryRegion(page: Page, name: 'Saved work' | 'Favorites' | 'Collections' | 'Unsent account changes' | 'Import from this browser') {
  return (await openLibrary(page)).getByRole('region', { name, exact: true });
}

/** Opens the gallery's Filters and returns the filter options. */
export async function openFilters(page: Page) {
  const toggle = page.getByRole('search', { name: 'Find styles' }).getByRole('button', { name: /^Filters/ });
  if (!await expanded(toggle)) await toggle.click();
  const group = page.getByRole('group', { name: 'Filters', exact: true });
  await expect(group).toBeVisible();
  return group;
}

/** A style card, found by its select button, "Use <Family name>". */
export const card = (page: Page, name: string) => page.locator('article.family-card').filter({ has: page.getByRole('button', { name: `Use ${name}`, exact: true }) });
/** The card's select button. */
export const useButton = (card: Locator) => card.locator('button.card-select');
/** The card's variant select. */
export const variantSelect = (card: Locator) => card.locator('select.variant-select');
/** The variant the card shows. */
export const shownVariant = (card: Locator) => variantSelect(card).locator('option:checked');
export const selectVariant = (card: Locator, name: string) => variantSelect(card).selectOption({ label: name });

const cardMenu = (card: Locator) => card.locator('details.card-menu');
/** The summary that opens the card's "more" menu; its accessible name is "More for <Family name>". */
export const cardMenuToggle = (card: Locator) => cardMenu(card).locator('summary');
/** Opens the card's "more" menu (Pin, Details) and returns it. */
export async function openCardMenu(card: Locator) {
  if (!await isOpen(cardMenu(card))) await cardMenu(card).locator('summary').click();
  await expect(cardMenu(card).getByRole('button', { name: 'Details', exact: true })).toBeVisible();
  return cardMenu(card);
}
export async function closeCardMenu(card: Locator) {
  if (await isOpen(cardMenu(card))) await cardMenu(card).locator('summary').click();
}
/** Presses a button in the card's "more" menu, then closes the menu so it does not cover the next card. */
export async function cardAction(card: Locator, name: string) {
  await (await openCardMenu(card)).getByRole('button', { name, exact: true }).click();
  await closeCardMenu(card);
}
