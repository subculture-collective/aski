# Export qualification

Issue [#64](https://github.com/subculture-collective/aski/issues/64). This record has two parts: engine measurements taken on 2026-11-13, and real-device results, which are still missing. The issue is not complete until the device table below is filled in.

## How the measurements were taken

`make qualify-export` builds the site and runs `tests/qualify.spec.ts` with `ASKI_QUALIFY=1` in all five Playwright projects. Ordinary test runs skip it. Each project writes `docs/research/export-qualification/<project>.json`. The run used one host: AMD Ryzen 9 9900X, 24 threads, 60 GiB. The tablet and phone projects are viewport sizes on the same desktop engines (WebKit 27.2 at 768 × 1024, Chromium 158 at 390 × 844). They show layout and engine behaviour, not phone or tablet hardware, memory or download handling.

Encoder memory was not measured. The browsers expose no worker memory figure that is comparable across engines, and a desktop figure would not answer the device question anyway.

## Engine results

| Project | Engine | Typing p50 / p95 ms (compact, 8-row font) | Typical GIF ms | Largest allowed GIF ms | Idle after Cancel ms | Next small GIF ms |
| --- | --- | --- | --- | --- | --- | --- |
| chromium | Chromium 158 | 17 / 76, 18 / 84 | 123 (115 transparent) | 3,957 | 16 | 96 |
| firefox | Firefox 159 | 19 / 24, 31 / 44 | 433 (432) | 6,710 | 16 | 286 |
| webkit | WebKit 27.2 | 16 / 83, 23 / 89 | 143 (191) | 3,568 | 55 | 147 |
| tablet | WebKit 27.2, 768 × 1024 | 15 / 84, 23 / 87 | 136 (173) | 3,552 | 23 | 110 |
| phone | Chromium 158, 390 × 844 | 12 / 75, 24 / 86 | 172 (153) | 3,963 | 17 | 107 |

- **Typing** is the time from each `input` event to the next change of the rendered output, over 39 keystrokes at 60 ms intervals into ten lines of text. It was measured in ANSI Compact (6 rows) and Linguaholic Shadow 3D (8 rows). Every keystroke rendered within 127 ms in every engine.
- **Typical GIF**: "HELLO", Reveal, 2 s plus 1 s hold at 12 fps, scale 1: 296 × 112 pixels, 36 frames. Identical neighbours merge to 4 stored frames.
- **Largest allowed GIF**: "ASKI STUDIO", Glitch, 17 s plus 1 s hold at 30 fps, scale 2: 1040 × 208 pixels, 540 frames, about 117 million pixel-frames against the 120 million budget. The result is 1,912.4 KB with 494 stored frames in every engine.
- **Cancellation** is pressed inside the page once 20 frames of the largest GIF are done. The figures are the time until Create GIF is offered again, then the time to encode a 1 s, 10-frame GIF.

## Fidelity

Every project downloaded the same seamless-block design (`"  A B"` and `"CD  "` in ANSI Compact) in all five formats and checked:

- **Text**: the file equals the on-screen output, including leading and trailing spaces and the line break.
- **ANSI**: 24-bit color sequences are present, and with them removed the text equals the on-screen output.
- **PNG and SVG**: both are 352 × 416 pixels, matching each other and the image settings. The SVG contains no scripts, `href`, `url()`, `foreignObject` or declarations.
- **GIF**: total time 3,000 ms as configured, NETSCAPE looping present, disposal 1 for solid frames and disposal 2 for transparent ones, canvas 296 × 112.

Partial-block seams, transparent PNG and SVG backgrounds, and GIF frame contents are covered by the existing regression suites rather than this harness: `tests/seamless.spec.ts`, `tests/image.spec.ts`, `tests/gif.spec.ts`, and `make test-export` / `make test-animation`, which decode GIFs with `gifuct-js`.

## Limits

The budgets stay as they are:

| Limit | Value | Where it is checked |
| --- | --- | --- |
| GIF side | 2,048 pixels | Panel before any canvas is created, and again in the worker |
| GIF frames | 600 | Same |
| GIF pixel-frames | 120 million | Same |
| Animation duration | 0.5–20 s, hold 0–10 s, 1–30 fps | Recipe parser |
| Text | 2,000 characters | Editor and recipe parser |

At the largest allowed size, every engine on this host finished in under 7 s, with working progress and cancellation. That is no reason to lower the budgets. It is not evidence for raising them either: a phone may be several times slower and has far less memory. The real-device results decide whether the 120 million pixel-frame budget holds on phones.

When a setting is over a budget, Create GIF is disabled and the panel names the setting to lower. For example, at scale 2 with 600 frames it reads: "This GIF is too large to encode on most devices (1040 × 208 × 600 frames). Lower the scale, frame rate or duration."

Known format differences, unchanged: GIF keeps at most 256 colors per frame and on/off transparency, so soft edges can look harder than the preview (the panel says so). Plain text and code blocks keep no colors. ANSI needs a terminal with 24-bit color.

## Real devices (not done)

These need hands-on testing and are not claimed by the measurements above. For each device, record the device, OS version and browser version, then:

1. Type into a ten-line text and note whether the output keeps up.
2. Download text, ANSI, PNG, SVG and GIF, and confirm each file arrives where the device stores downloads and opens.
3. Create the typical GIF and the largest allowed GIF (settings above), note the time each takes, and play them in a viewer outside the browser (Photos, Files or a desktop image viewer).
4. Cancel the largest GIF midway, then create a small one.

| Device | OS | Browser | Typing | Downloads | Typical GIF | Largest GIF | Cancel | GIF plays outside the browser |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Phone (iOS) | | Safari | | | | | | |
| Phone (Android) | | Chrome | | | | | | |
| Tablet | | | | | | | | |
| Desktop | | Firefox | | | | | | |

If the largest GIF fails or takes longer than about a minute on a supported phone, lower `GIF_LIMITS.pixelFrames` in `shared/gif.ts` to the largest size that worked, and update this record and `docs/gif.md`.
