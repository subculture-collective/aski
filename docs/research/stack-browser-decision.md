# Stack and browser feasibility decision

Decision record for [#30](https://github.com/subculture-collective/aski/issues/30), November 9, 2026. This selects the implementation approach and records a bounded probe. It does not create the application or provision account services.

## Selected stack

| Boundary | Choice | Reason and limit |
| --- | --- | --- |
| Browser app | React, TypeScript, Vite | A client-rendered studio with a persistent editor and many changing previews. React is also used by the existing Studio frontend. Keep rendering and animation independent of components. |
| FIGfont rendering | `figlet@1.12.0`, in a worker | Matches the inspected Standard/Isometric1 samples. Load reviewed fonts lazily. No TDF support is implied; see the [parity research](https://git.subcult.tv/subculture-collective/aski/pulls/45). |
| Frame/image model | Versioned cell grid and deterministic frame function | Preview, PNG/SVG, and GIF consume the same glyph/color/coordinate data. Compatible block geometry can bypass text-font seams. |
| GIF encoder | `gifenc@1.0.3`, in a dedicated worker | Indexed palettes, transparency, disposal, loop metadata, and frame delays are controllable. Terminate the worker on cancellation; stream frames instead of retaining every RGBA frame. |
| Local records/artifacts | IndexedDB through `dexie@4.4.7` | Versioned transactions and binary values support local collecting. Store artifact bytes as `Uint8Array` plus MIME/hash metadata; construct Blobs for preview/download. |
| Optional API | Node.js 24 LTS and Hono | One TypeScript toolchain, web-standard handlers, and a small self-hosted optional account service. Anonymous rendering/export needs no request to that service. |
| Account framework | Better Auth with its magic-link plugin | Use maintained session/token machinery rather than inventing authentication. Verify hashed token storage, single-use redemption, origins, cookies, and rate limits against the pinned release in the account-contract work. No auth behavior is verified by this probe. |
| Remote persistence | PostgreSQL metadata and private artifact storage behind authenticated API handlers | Keep immutable artifact hashes/ownership separate from mutable recipes. Choose the runtime and storage placement in #12, and the reviewed sync/retention contract in #10. |

Runtime packages outside the probe are selected technologies, not an installed or compatibility-tested application dependency set. Foundation work must pin their exact versions and run its real type/build checks. Registry metadata observed during this spike included React 19.3.1, Vite 8.3.7, TypeScript 7.0.2, Hono 4.13.17, and Better Auth 1.7.18. The probe lockfile pins the dependencies it actually exercises.

Alternatives considered:

- Svelte/Vite could reduce component overhead, but would introduce a different UI convention from the maintained Studio frontend. The expensive work belongs in workers whichever component library is used.
- Next.js server rendering adds a framework server and routing/cache behavior that the anonymous editor does not require. Share-link metadata rendering can be added deliberately if needed.
- Canvas-only rendering without a cell-grid contract makes editable text/ANSI export and repeatable vector output harder to keep aligned.
- gif.js would also encode in workers, but gifenc exposes indexed frame/palette/disposal control directly without a browser-global encoder wrapper. A video-to-GIF server or WASM FFmpeg adds download/runtime cost to a task a small JS worker can perform.
- Synchronous localStorage is unsuitable for the artifact byte store. Dexie Cloud is not selected; cross-device sync belongs to the optional self-hosted account boundary.
- A separate Go API is viable, but a second language and custom auth integration are unnecessary for this project's initial scope. This choice does not migrate any fleet service.

## Probe and findings

The [probe](../../research/browser-probe/) bundles the real FIGlet engine, an explicitly licensed ANSI Compact sample font, gifenc, and Dexie. A worker renders a captured text input into 40 frames at 320 × 128. The main input stays editable. The harness decodes each GIF using independent `gifuct-js@2.1.2`, then checks the downloaded bytes and browser image decode.

All six cases passed on macOS/arm64: Chromium desktop, Firefox desktop, WebKit desktop, emulated Chromium phone, emulated WebKit phone, and emulated WebKit tablet. Each case checked opaque looping output and transparent play-once output, 40 decoded frames, 2,200 ms total including the end hold, disposal behavior, binary alpha, input editing, main-thread timer progress, cancellation/restart, over-budget rejection, IndexedDB byte recovery after reload, and transaction rollback. The [machine-readable results](browser-probe-results.json) include engine versions, artifact hashes, durations, and evidence limits. The [sample GIF](probe-sample.gif) is a research artifact, not an application capture.

WebKit rejected direct IndexedDB Blob writes with `UnknownError: Error preparing Blob/File data to be stored in object store` in this automated environment. Chromium and Firefox accepted the same Blob test. Byte-array records survived reload and transaction tests in all six cases. This is why the artifact contract uses bytes and creates a Blob only at the output boundary. It does not establish that every branded Safari version has the same Blob behavior.

The active RGBA plus indexed pixel buffers total 204,800 bytes for this sample. This is a lower-bound accounting of those two arrays, not measured peak memory. Canvas backing stores, encoder growth, native/browser allocations, transfers, and transient copies are excluded. Chromium main-realm heap observations are also not whole-worker or physical-device memory measurements. #42 must measure production limits using representative real devices and larger artwork.

## Browser support and release qualification

The initial target is current stable Chrome/Chromium, Firefox, and Safari on desktop; Chrome on Android; Safari on iPhone; and Safari on iPad. Record the supported versions at release qualification. Every target needs the full editing/collection/export workflow.

Playwright 1.65.0 exercised Chromium 158, Firefox 159, and WebKit 27.2 engine builds on a Mac. Device profiles change viewport, touch, and user agent; they are not physical Android/iOS devices or branded-browser release validation. The findings establish technical feasibility only. Real phone/tablet downloads, thermal pressure, long exports, keyboard behavior, and final export budgets remain #42/#43 work.

## Data and module contracts

- `RecipeV1`: `schemaVersion: 1`, immutable UUID identity, original input, family/variant IDs, font hash, engine version, palette slot assignments, horizontal/vertical layout, optional width, alignment, seamless mode, dimensions, and animation preset/seed/timing/loop/end-hold settings. Unknown versions fail explicitly; migration operates on a copy.
- `CellGridV1`: dimensions in cells, a fixed cell aspect ratio, and positioned glyph cells with foreground/background slot IDs. Font adapters report unsupported code points and layout capabilities before rendering. Wide/combining output requires explicit coverage rather than assumptions about UTF-16 string length.
- `ArtifactV1`: immutable SHA-256, MIME type, byte length, pixel/cell dimensions as applicable, original encoded bytes, and the generating recipe/font/renderer versions. Local storage uses byte arrays. Remote ownership is enforced by authenticated handlers, not by a client-supplied owner ID or a public object URL.
- Worker requests carry a job ID, recipe snapshot, dimensions, frame count, and integer-centisecond frame schedule. Progress/results carry the job ID. Ignore stale jobs. Cancellation terminates the encoder realm; restart uses a fresh worker. Validate limits before allocation.
- Mutable record IDs and artifact hashes are distinct. Sharing serializes only an explicit validated recipe; it never serializes account session state or a private library. Revision/tombstone/conflict rules are defined in #10 before sync implementation.

Prospective source boundaries are `web/` for components/worker adapters, `shared/` for versioned contracts and pure rendering/frame logic, and `server/` for optional account/storage handlers. These paths do not exist yet. The foundation PR introduces actual startup/build/type/test commands and `make check`; feature PRs add real `test-render`, `test-ui`, `test-storage`, `test-export`, `test-animation`, and `test-account` targets as their behavior exists.

## Reproduce

```sh
npm ci --prefix research/browser-probe --ignore-scripts --no-audit --no-fund
research/browser-probe/node_modules/.bin/playwright install chromium firefox webkit
npm --prefix research/browser-probe run build
npm --prefix research/browser-probe run check
npm --prefix research/browser-probe test
```

Linux environments also need Playwright's documented system dependencies (`playwright install --with-deps ...`). The test owns a loopback server on an OS-assigned port and closes its browsers/server in `finally` blocks. Generated bundles and GIF/results artifacts are ignored. The Gitea research workflow runs the same contracts and browser probe on the PR head.

Primary documentation: [React](https://react.dev/learn), [Vite requirements](https://vite.dev/guide/), [FIGlet](https://github.com/patorjk/figlet.js/tree/v1.12.0), [gifenc API](https://github.com/mattdesl/gifenc), [Dexie transactions](https://dexie.org/docs/Dexie/Dexie.transaction()), [Hono on Node](https://hono.dev/docs/getting-started/nodejs), [Better Auth magic links](https://www.better-auth.com/docs/plugins/magic-link), and [Playwright browser/emulation limits](https://playwright.dev/docs/browsers).
