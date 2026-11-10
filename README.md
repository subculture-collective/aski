# aski

A text-art studio for browsing font families, editing palettes, saving work, and exporting still images and animated GIFs.

The current application renders 19 reviewed fonts from multiline input and copies whitespace-safe text. Family-gallery browsing, palettes, collections, animation and image exports follow the roadmap.

- [Approved product scope](docs/product-scope.md)
- [Implementation plan and acceptance checks](docs/implementation-plan.md)
- [First public release roadmap](https://git.subcult.tv/subculture-collective/aski/issues/1): epics, PR-sized work, and native blocking dependencies in execution order.

The reference product is [TAAG](https://patorjk.com/software/taag/). Existing TAAG controls belong in the baseline feature set. The improvements center on grouped variants, uninterrupted editing, palette slots, saved work, and animation.

Research decisions:

- [TAAG parity and font provenance](docs/research/taag-parity.md), including a reproducible audit of the pinned font candidate source.

## Run locally

Use Node.js 24 LTS.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

Open `http://127.0.0.1:5173`. Rendering runs in a dedicated worker; the editor remains on the main thread. The current input limit is 2,000 UTF-16 code units. Unsupported code points are reported and the original input remains editable. The native Style selector keeps confirmed variants together. The shell uses the approved Lilac identity, with Fraunces headings and Atkinson Hyperlegible Next controls.

```sh
make check
PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install chromium firefox webkit
make test-ui
```

`make check` runs TypeScript, ESLint, renderer regression tests and a production build. `make test-ui` starts the built preview on `127.0.0.1:4179`, then exercises real worker rendering, multiline text, clipboard or permission fallback, errors and responsive layout across three browser engines plus phone and tablet viewports. Linux needs Playwright's system dependencies (`npx playwright install --with-deps chromium firefox webkit`). A custom `ASKI_TEST_URL` targets an already running preview; the harness does not stop that server.

TypeScript 6.0.3 is pinned because the selected typescript-eslint 8.72.2 supports versions below 6.1; the registry's TypeScript 7 release is not a compatible dependency set. No peer-dependency overrides are used.

`npm run build` writes `dist/`; `npm run preview` serves that build locally. HTTPS or localhost is needed for clipboard access. If it is unavailable or denied, Copy text opens a selectable manual-copy dialog. Output is copied exactly, including leading spaces and line breaks.

## Source boundaries and license

`shared/recipe.ts` defines the supported version-1 recipe subset and stable IDs; `shared/render.ts` owns text generation. `web/render.worker.ts` adapts that boundary to a browser worker, and the React component owns only current input, rendering status and copy UI. Recipes bind the exact font SHA-256 and engine version; mismatches fail explicitly. Requests carry increasing job IDs so stale results cannot replace the newest input. Copy feedback is tied to the input snapshot that initiated it. The anonymous draft and recipe history are saved locally. A separate sign-in request service sends links; session redemption and account libraries follow later roadmap steps.

ANSI Compact is by Loic Cressot; its included font header explicitly states MIT terms. See `public/font-notice.txt`. The FIGlet engine's separate license is in `public/figlet-license.txt`; it does not clear the rest of the font catalog. [The stack decision](docs/research/stack-browser-decision.md) and [catalog audit](docs/research/taag-parity.md) retain the research boundaries.

See [catalog provenance and import](docs/catalog.md). Run `make test-render` for catalog and glyph-coverage checks.

[Draft recovery and undo/redo](docs/drafts.md): `make test-storage` checks the versioned persistence boundary. Browser tests cover reload, text/style history, corrupted drafts and quota failures.

[Sign-in request service](docs/sign-in-requests.md): `make test-account` needs Docker and creates its own temporary PostgreSQL 17 database. `make test-account-ui` exercises the real form against a separate capture inbox. No production mail credentials are needed for these checks. `make check` now includes the account service tests.

[Studio brand handoff](docs/brand-integration.md): `make check-brand` verifies 15 selected source-bound assets. `make check` also inspects the built public file list and copied hashes. The full private Studio pack is not included.
