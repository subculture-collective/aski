# aski

aski is a text-art studio that runs in the browser. Type once, browse font
families side by side, pick colors, then copy the result as text or export it
as an image or an animated GIF. It runs at https://aski.subcult.tv, with an
about page at https://aski.subcult.tv/about/; editing and exports work without
an account.

It builds on the controls of [TAAG](https://patorjk.com/software/taag/) and
adds grouped font variants, uninterrupted editing, palette slots, saved work
and animation.

## Features

- **Fonts:** 19 FIGlet fonts in 16 families, each shipped only after its
  redistribution notice was reviewed. Multiline input up to 2,000 characters;
  unsupported characters are reported and the input stays editable.
- **Gallery:** one card per family with a live preview and variant buttons.
  Search and filter by look, size and character support. Pin cards to a Compare
  tray to see several results follow the same text. **Details** shows a font's
  line height, character coverage and license.
- **Colors:** foreground and background for every font, plus extra slots where a
  font supports them (for example a shadow). Swatches, custom `#RRGGBB` values,
  presets and saved palettes.
- **Layout:** letter spacing (font default, full width, fitted or smushed), an
  optional maximum width that wraps between words, and left, center or right
  alignment.
- **Gap-free blocks:** fonts made only of block characters are drawn as solid
  rectangles, without the thin gaps between cells. Copied text is unchanged.
- **Export:** copy as text or a Markdown code block; download plain text, 24-bit
  ANSI, PNG or self-contained SVG; share a design through a link that carries it
  in the URL fragment.
- **Animation:** typewriter, reveal, palette cycle, shimmer and glitch effects
  with duration, frame rate, loop and hold controls, previewed on a fixed-size
  canvas. **Create GIF** encodes the same frames in a worker, with progress and
  cancel.
- **Local library:** favorites, saved text, saved designs and named collections,
  stored in the browser (IndexedDB). Drafts are saved locally, with undo and
  redo.
- Works on desktop, tablet and phone. Rendering runs in web workers so the
  editor stays responsive.

Optional accounts are being built. The repository has a service that sends
sign-in links; signing in and syncing between devices are not finished.

## Quick start

You need Node.js 24.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run dev        # http://127.0.0.1:5173
```

The studio is at `/`. The about page at `/about/` is a specimen of every font
family, drawn with the studio's renderer.

Copying to the clipboard needs HTTPS or localhost; otherwise **Copy text** opens
a dialog you can copy from by hand.

Checks:

```sh
make check         # typecheck, lint, unit and renderer tests, account service tests, brand check, build
npx playwright install --with-deps chromium firefox webkit
make test-ui       # browser tests in Chromium, Firefox and WebKit, plus phone and tablet viewports
```

`make test-account` and `make test-account-ui` need Docker; they start their own
temporary PostgreSQL 17 database and capture mail locally. Smaller targets:
`make test-render`, `make test-export`, `make test-animation`,
`make test-storage`. `make qualify-export` records export and GIF timings in
every browser project ([export qualification](docs/export-qualification.md)).

To run the sign-in request service next to the editor, set the variables below,
then:

```sh
npm run migrate:account
npm run dev:api    # API on 127.0.0.1:4181; Vite proxies /api to it
```

## Configuration

The editor needs no configuration. The account service in `server/` (sign-in,
the account library and its image files) reads:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Secret of at least 32 characters |
| `PUBLIC_ORIGIN` | The site's public origin; sign-in links are built from it |
| `BREVO_API_KEY`, `MAIL_FROM_EMAIL` | Transactional email through Brevo |
| `TRUSTED_PROXY_CIDRS` | Optional proxies allowed to set `X-Real-IP` |
| `ARTIFACT_ROOT` | Optional private directory for account image files; without it, account designs are saved without files |
| `ASKI_API_PORT` | API port (default 4181) |

Without mail configuration the API reports itself unavailable; editing and
exports are not affected.

## Deploy

`npm run build` writes a static site to `dist/`; `npm run preview` serves it
locally. Any static host works for the editor. The sign-in service is a Node 24
process (`node server/main.ts`) that needs PostgreSQL; run
`npm run migrate:account` yourself, since migrations never run on start.
`ops/compose.release.yml` sketches a production layout with separate web, API
and PostgreSQL containers; you supply the images.

## Project layout

```text
web/       React editor, gallery, panels and workers
shared/    rendering, recipes, layout, colors, animation, GIF and export code
server/    sign-in request service (Hono, Better Auth, PostgreSQL)
catalog/   font candidates, rights decisions and color mappings
public/    static files, font notices and the FIGlet license
tests/     Playwright browser tests
scripts/   catalog import, brand import, build and account test helpers
research/  font audit and browser probe projects
docs/      feature notes and design decisions
```

The feature notes in `docs/` go into detail: [catalog and rights](docs/catalog.md),
[colors](docs/colors.md), [layout](docs/layout.md), [export](docs/export.md),
[share links](docs/share-links.md), [animation](docs/animation.md),
[GIF export](docs/gif.md), [local library](docs/library.md),
[account library](docs/account-library.md) and [drafts](docs/drafts.md).

## Contributing

- Bugs and feature requests: [GitHub issues](https://github.com/subculture-collective/aski/issues).
  The first public release roadmap is [issue #23](https://github.com/subculture-collective/aski/issues/23).
- Questions and ideas: [GitHub Discussions](https://github.com/subculture-collective/aski/discussions).
- Code: open a pull request on GitHub against `main`. CI runs `make check`, the
  browser tests and the account tests, plus the font audit and browser probe
  projects under `research/`.

## License

aski is licensed under the GNU General Public License, version 3 or later
(GPL-3.0-or-later). See [LICENSE](LICENSE). Each shipped font keeps its own
MIT or WTFPL notice next to it in `public/fonts/`, and the FIGlet engine's
license is in `public/figlet-license.txt`.
