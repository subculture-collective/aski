# Workflow qualification

Issue [#65](https://github.com/subculture-collective/aski/issues/65). This record covers the full studio and sync workflow on the release candidate: main at `f7ee4b3` (the redesign in #86 and the fixes in #87) plus the branch that adds this file. It lists what was checked, how, and what is still open. The issue is not complete until the hands-on device table at the end is filled in.

Export fidelity and GIF budgets are recorded separately in [export-qualification.md](export-qualification.md).

## How it was checked

1. **Automated suites on the candidate, 2026-11-14:**
   - `make check` (typecheck, lint, unit tests, render tests, account service tests, brand check, build): passed.
   - The full Playwright suite in five projects (Chromium 158, Firefox 159, WebKit 27.2, a 768 × 1024 WebKit tablet viewport, a 390 × 844 Chromium phone viewport): 301 passed, 54 skipped. The skips are the account tests, which run in the next step, the measurement harness, and tests that apply only to some projects.
   - `make test-account-ui`, the account browser tests against a throwaway Postgres: 27 passed.
2. **Live testing before the candidate.** Two rounds of agents used the live studio and a local build in Chromium, Firefox and WebKit at desktop, tablet and phone sizes, wrote their own scripts and looked at screenshots. Their findings were fixed in #87, which lists each one and the few that were left unchanged.
3. **Chrome on an Android emulator** (Chrome 124, Android 15), driven by touch: downloads, GIF export and cancellation. See [export-qualification.md](export-qualification.md#chrome-on-an-android-emulator).

The tablet and phone projects are viewport sizes on desktop engines, and the emulator is not a phone. None of this is a hands-on check on a real phone or tablet.

## The full workflow in one session

`tests/workflow.spec.ts` runs the whole path from the issue in one page, without a reload until the end. The desktop projects use the mouse and keyboard. The tablet and phone projects run with touch enabled and tap every button.

1. Search for a family and turn on a look filter.
2. Choose a variant in the card menu and use it.
3. Type a new line with the keyboard. The card being used stays within 4 px of where it was.
4. Pin two variants and compare them on the same text. The card still stays put. Changing the variant of the family in use applies it; Compare's Use goes back.
5. Pick a text color.
6. Favorite the family, save the design, and put both in a new collection.
7. Animate it (Reveal, 1 s, 10 fps), create the GIF and download it. The file decodes to 1,000 ms.
8. Check that the design, text, color, Compare tray and filter are all unchanged and the page never scrolled sideways.
9. Reload and check that the draft, the animation and the collection came back.

It passes in all five projects. Many narrower tests cover each step in more detail: `filters`, `gallery`, `compare`, `colors`, `favorites`, `collections`, `saved`, `animation`, `gif` and `export`.

### Bug found by this test

In WebKit, typing a new line moved the card being used down by about 95 px when few cards were below it, for example with a filter on. WebKit scrolls the page to reveal the caret when text is inserted, even in the sticky text field. The scroll-anchor hook took that for the user scrolling and re-anchored at the moved position. Its own scroll event, a frame late, could do the same. In `web/useScrollAnchor.ts`, a scroll in the two frames after an edit no longer counts as the user's, and scroll events restore instead of recording. The one case the late record handled, a correction cut short at the top of the page, is now measured at once. The test fails on the old code (95–97 px) and passes on the new.

## Accounts, sync and recovery

These run in `make test-account-ui` against a real account service and database:

- Signing in through a captured link keeps local work, and signing out keeps it too.
- A mail outage or rate limit leaves anonymous editing working.
- A signed-in visitor saves to the account library, reopens it in a second session, and another account cannot see it.
- Import from this browser is offered explicitly, survives a lost reply and reaches another session.
- Changes made while the account service is down survive a reload and are sent when it returns.
- Edits from two sessions are both kept; an edit to an item deleted elsewhere comes back as a new item.
- Unsent changes stay bound to their account after the session ends.
- A saved animated design and its GIF reach another session byte for byte, and the file stays private to the account.

Without signing in, `draft`, `saved`, `artifacts` and `favorites` cover local recovery: reload, damaged or future records, a full file store, and exact PNG, SVG and GIF files kept as exported.

## Accessibility and responsive checks

| Area | What was checked | Where |
| --- | --- | --- |
| Keyboard and focus | Variant switching and selection, collections, menus and the Library closing on Escape and returning focus, undo and redo shortcuts and caret position, focus after Library actions, controls focused under the sticky text field scrolling clear | `gallery`, `collections`, `interaction` |
| Touch | Card taps, pins, favorites, collections, and the whole workflow above on the tablet and phone projects | `interaction`, `compare`, `favorites`, `collections`, `workflow` |
| Reduced motion | The preview starts paused, button transitions are off, and an animated share opened in a fresh session respects it | `animation`, `brand`, `animated-work` |
| Contrast | Measured from the brand tokens (WCAG 2 formula): ink on white 16.61:1, ink on paper 14.38:1, muted on white 7.49:1, muted on paper 6.49:1, ink on lilac 8.76:1, ink on lime 14.45:1, focus ring on white 8.01:1. Muted on lilac would be 3.95:1, but no muted text sits on lilac: Undo and Redo, the muted buttons with a lilac hover, turn ink on hover and focus. #87 fixed a placeholder at 3.67:1 in Firefox. | This record |
| Responsive | No sideways page scroll at any project size, wide art scrolling from its first column, phone result height with a share link | `gallery`, `compare`, `interaction`, `workflow` |
| Loading and errors | Unavailable fonts and renderers, damaged links and records, quota failures, a full file store, mail outage and an account service that goes down and comes back. Retrying previews and renders after going offline was fixed in #87 but has no browser test. | `catalog`, `draft`, `saved`, `share`, `artifacts`, `account` |
| Branding | The brand files match the selected Studio handoff by hash; typography and controls stay usable with keyboard, touch and wide art | `make check-brand`, `brand` |

Two more problems were found on the Android emulator and fixed: the Download menu opened under the style cards in Chrome 124, and ANSI files were saved as `.ans.txt`. Details are in the export record.

## Known open items

These are not fixed and are listed so nobody reads them as tested:

- Block previews crop very long or many-line text, because previews stop shrinking at 3 px.
- The character limit counts code points, so a letter with a separate combining mark, or a joined emoji, counts as more than one.
- On short landscape phones the Copy bar can cover the bottom of the result art. On the Android emulator it also covered most of the Create GIF button until the page was scrolled further.
- On phones the Download menu reaches within 3 px of the left edge.
- Block styles can show faint seams between cells in Firefox and WebKit.
- In the image settings on the Android emulator, the "Export the inspected animation frame" checkbox sat on its own line above its label.

## Real devices (not done)

Record the device, OS and browser versions, then run the workflow above by hand: filter, switch variants, edit text and colors, compare, collect, animate and download the GIF; then sign in, import, open the work in a second session, go offline and back, and retrieve the saved GIF. Note anything that loses position or focus, anything hard to tap, and how it looks with reduced motion and larger text.

| Device | OS | Browser | Workflow | Sync | Keyboard / touch | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Phone (iOS) | | Safari | | | | |
| Phone (Android) | | Chrome | | | | |
| Tablet (iPad) | | Safari | | | | |
| Desktop | | Chrome, Firefox, Safari | | | | |
