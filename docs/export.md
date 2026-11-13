# Text and ANSI export

The artwork panel's Export group and the header's **Copy text** button produce text from the result on screen.

- **Copy text** and **Download text** use the rendered text exactly: leading and internal spaces, line breaks and no trailing additions. Downloads are UTF-8 without a byte-order mark, named `aski-<style>-<text>.txt`.
- **Copy as code block** wraps that text in a Markdown fence tagged `text`. The fence is one backtick longer than any backtick run in the text, so the block cannot close early.
- **Download ANSI** (`.ans`) writes 24-bit SGR colors from the design's slots. Each line starts with the background color and ends with a reset (`ESC[0m`), so colors do not leak past the artwork or into the next line. Spaces keep the background. Any C0/C1 control character becomes U+FFFD before writing, so input cannot send its own escape sequences to a terminal. (Figlet already drops control characters from input; this is a second guard.)

Plain text and code blocks have no colors or animation; the panel says so. If the clipboard is unavailable or denied, a dialog shows the exact text to select and copy, and the button can be used again.

`make test-export` checks exact plain-text bytes against the multiline fixture, fence escalation, that stripping the SGR codes from ANSI output returns the plain text, per-line background and reset, mapped-slot colors, control-character replacement and safe file names. The browser suite downloads both files and compares bytes, and covers code-block copy with clipboard access and the manual fallback twice in a row.

## PNG and SVG

The Image export settings choose a scale (1–8, giving 8 × 16 to 64 × 128 pixel cells), padding (0–256 pixels) and a solid or transparent background, and show the resulting size before export. Images over 8,192 pixels on a side or 16 megapixels are refused with a message, because phone browsers cannot draw larger canvases. Export never changes the draft; a failure shows a message and leaves the design as it was.

Both formats use the same cell grid and color runs as the preview. With **Seamless blocks** on, blocks are rectangles from `shared/cells.ts`, so joins match the seamless preview at every scale. Otherwise each visible character is drawn at its own cell position at 80% of the cell height.

- **SVG** is self-contained: no scripts, external references, `foreignObject`, DTDs or embedded fonts. Text mode sets an explicit `x` for every character, so columns stay aligned whatever monospace font the viewer has; only glyph shapes depend on that font (stack: aski Art Mono, `ui-monospace`, Cascadia Mono, Liberation Mono, Menlo, Consolas, `monospace`). The SVG names aski Art Mono but does not embed it, so a viewer without it uses its own monospace font. Text is XML-escaped and characters XML cannot hold become U+FFFD.
- **PNG** and **GIF** frames are drawn on a canvas with aski Art Mono, the bundled lettering face, once it has loaded, and encoded in the browser. Characters it lacks (fullwidth forms, CJK and Hangul) and a failed font load fall back to the device's monospace font.

**aski Art Mono** is JuliaMono v0.63.2 Regular, subset to the characters the bundled FIGlet fonts draw (417 of them, 29 KB as WOFF2) and renamed because JuliaMono's OFL reserves its name. `scripts/art-font.py` rebuilds it from the release file and records its source, hashes and coverage in `shared/art-font.json`; its license ships as `/fonts/art/OFL.txt`. `shared/art-font.test.ts` fails if a FIGlet font draws a character that is neither covered nor on the recorded fallback list.

`make test-export` checks image sizes and limits, one `x` position per character, escaping, transparency and block geometry. The browser suite decodes downloaded PNGs (signature, size, padding and transparent pixels, and the seam between two full blocks), parses SVGs with `DOMParser`, rasterizes a block SVG at the same seam, checks escaped markup, and checks the over-budget message. Opening exports in other viewers and on phones is part of #42.
