# aski

A text-art studio for browsing font families, editing palettes, saving work, and exporting still images and animated GIFs.

The current application renders 19 reviewed fonts from multiline input, shows them as a gallery of 16 families with live previews, and copies whitespace-safe text. Palettes, collections, animation and image exports follow the roadmap.

- [Approved product scope](docs/product-scope.md)
- [Implementation plan and acceptance checks](docs/implementation-plan.md)
- [First public release roadmap](https://github.com/subculture-collective/aski/issues/23): epics, PR-sized work, and native blocking dependencies in execution order.

The reference product is [TAAG](https://patorjk.com/software/taag/). Existing TAAG controls belong in the baseline feature set. The improvements center on grouped variants, uninterrupted editing, palette slots, saved work, and animation.

Research decisions:

- [TAAG parity and font provenance](docs/research/taag-parity.md), including a reproducible audit of the pinned font candidate source.

## Run locally

Use Node.js 24 LTS.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

Open `http://127.0.0.1:5173`. Rendering runs in a dedicated worker; the editor remains on the main thread. The current input limit is 2,000 UTF-16 code units. Unsupported code points are reported and the original input remains editable. The native Style selector keeps confirmed variants together.

The Styles gallery shows one card per confirmed family. Variant buttons change a card's preview; on the family in use they also change the design, which joins undo history. **Use style** selects a family with its chosen variant, and **Details** lists its line height, character coverage and license. Previews render in a second worker, one at a time, from the first 160 characters, so the selected design is never queued behind them. While text changes, the card you last touched (or the first card in view) keeps its screen position, even when previews or the design above it change height. On phones the text editor stays pinned to the top. Search, look, size and character-support filters narrow the gallery; see [Looks and filters](docs/catalog.md#looks-and-filters). **Pin** adds a card's current variant to a Compare tray above the cards; every pinned result follows the live text with its own variant, pinning never changes the selected design, and the card you are using keeps its place. Pins last for the page session.

**Colors** assigns a swatch, a custom `#RRGGBB` value or a native color pick to each slot the selected font supports: foreground and background for every font, plus reviewed extra slots (currently a shadow for Linguaholic Shadow 3D). Invalid values leave the last valid color in place. Presets, reset and saved palettes apply every slot at once. Colors are part of the recipe, so they join undo history, the local draft and saved designs. See [Colors](docs/colors.md).

**Layout** sets letter spacing (font default, full width, fitted, or smushed where the font defines smushing rules), an optional maximum width that wraps between words, and left, center or right alignment. See [Layout](docs/layout.md).

The **Export** group copies a Markdown code block, downloads exact plain text or 24-bit ANSI with per-line resets, downloads PNG or self-contained SVG at a chosen scale, padding and background, and creates [share links](docs/share-links.md) that carry the design in the URL fragment. See [Text and ANSI export](docs/export.md).

**Animation** previews typewriter and directional reveal effects on the selected design, on a canvas fixed to the finished artwork's size. See [Animation](docs/animation.md). **Create GIF** encodes the same frames in a worker with progress and cancellation; see [GIF export](docs/gif.md).

**Seamless blocks** draws block-element fonts as gap-free shapes. See [Seamless blocks](docs/seamless-blocks.md).

The star on a card saves that family and variant as a favorite in this browser, with no account. Selecting a favorite applies its style to the current text; it stores no text or output. **Saved work** keeps reusable text and exact designs (style, recipe provenance and output text) as separate items. **Collections** group favorite styles and saved designs; an item can be in several. Favorites, saved work and collections live in the IndexedDB library described in [Local library](docs/library.md). The shell uses the approved Lilac identity, with Fraunces headings and Atkinson Hyperlegible Next controls.

```sh
make check
PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install chromium firefox webkit
make test-ui
```

`make check` runs TypeScript, ESLint, renderer regression tests and a production build. `make test-ui` starts the built preview on `127.0.0.1:4179`, then exercises real worker rendering, multiline text, clipboard or permission fallback, errors, gallery anchoring, variant state, keyboard and touch use, and responsive layout across three browser engines plus phone and tablet viewports. Linux needs Playwright's system dependencies (`npx playwright install --with-deps chromium firefox webkit`). A custom `ASKI_TEST_URL` targets an already running preview; the harness does not stop that server.

TypeScript 6.0.3 is pinned because the selected typescript-eslint 8.72.2 supports versions below 6.1; the registry's TypeScript 7 release is not a compatible dependency set. No peer-dependency overrides are used.

`npm run build` writes `dist/`; `npm run preview` serves that build locally. HTTPS or localhost is needed for clipboard access. If it is unavailable or denied, Copy text opens a selectable manual-copy dialog. Output is copied exactly, including leading spaces and line breaks.

## Source boundaries and license

`shared/recipe.ts` defines the supported version-1 recipe subset and stable IDs; `shared/render.ts` owns text generation. `web/render.worker.ts` adapts that boundary to a browser worker, and the React component owns only current input, rendering status and copy UI. Recipes bind the exact font SHA-256 and engine version; mismatches fail explicitly. Requests carry increasing job IDs so stale results cannot replace the newest input. Copy feedback is tied to the input snapshot that initiated it. The anonymous draft and recipe history are saved locally. A separate sign-in request service sends links; session redemption and account libraries follow later roadmap steps.

ANSI Compact is by Loic Cressot; its included font header explicitly states MIT terms. See `public/font-notice.txt`. The FIGlet engine's separate license is in `public/figlet-license.txt`; it does not clear the rest of the font catalog. [The stack decision](docs/research/stack-browser-decision.md) and [catalog audit](docs/research/taag-parity.md) retain the research boundaries.

See [catalog provenance and import](docs/catalog.md). Run `make test-render` for catalog and glyph-coverage checks.

[Draft recovery and undo/redo](docs/drafts.md): `make test-storage` checks the versioned draft and library records. Browser tests cover reload, text/style history, corrupted drafts and quota failures.

[Sign-in request service](docs/sign-in-requests.md): `make test-account` needs Docker and creates its own temporary PostgreSQL 17 database. `make test-account-ui` exercises the real form against a separate capture inbox. No production mail credentials are needed for these checks. `make check` now includes the account service tests.

[Studio brand handoff](docs/brand-integration.md): `make check-brand` verifies 15 selected source-bound assets. `make check` also inspects the built public file list and copied hashes. The full private Studio pack is not included.
