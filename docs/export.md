# Text and ANSI export

The artwork panel's Export group and the header's **Copy text** button produce text from the result on screen.

- **Copy text** and **Download text** use the rendered text exactly: leading and internal spaces, line breaks and no trailing additions. Downloads are UTF-8 without a byte-order mark, named `aski-<style>-<text>.txt`.
- **Copy as code block** wraps that text in a Markdown fence tagged `text`. The fence is one backtick longer than any backtick run in the text, so the block cannot close early.
- **Download ANSI** (`.ans`) writes 24-bit SGR colors from the design's slots. Each line starts with the background color and ends with a reset (`ESC[0m`), so colors do not leak past the artwork or into the next line. Spaces keep the background. Any C0/C1 control character becomes U+FFFD before writing, so input cannot send its own escape sequences to a terminal. (Figlet already drops control characters from input; this is a second guard.)

Plain text and code blocks have no colors or animation; the panel says so. If the clipboard is unavailable or denied, a dialog shows the exact text to select and copy, and the button can be used again.

`make test-export` checks exact plain-text bytes against the multiline fixture, fence escalation, that stripping the SGR codes from ANSI output returns the plain text, per-line background and reset, mapped-slot colors, control-character replacement and safe file names. The browser suite downloads both files and compares bytes, and covers code-block copy with clipboard access and the manual fallback twice in a row.
