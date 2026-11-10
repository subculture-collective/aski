# Colors

Recipe version 2 adds `colors`, a `#RRGGBB` assignment for each known slot: foreground, background, shadow and highlight. A font uses the slots it supports; the others are kept, so switching fonts and back does not lose them. Version-1 recipes (older drafts and saved designs) open with the Lilac defaults. Unknown slots and malformed colors are rejected.

Slots come from the catalog. Every font has foreground and background. Extra slots need a reviewed entry in `catalog/color-mappings.json` naming the characters the font draws for that role. Slot roles are never guessed from punctuation: Emboss and Future also use box-drawing characters but have no reviewed mapping, so they offer only foreground and background. Linguaholic Shadow 3D draws faces with `█` and a separate box-drawing shadow (`╔╗╚╝═║`), so it offers a shadow slot.

`shared/color.ts` splits rendered text into runs without changing a character. Mapped characters take their slot, other visible characters are foreground, and spaces and line breaks carry no color so the background shows behind them. The studio displays these runs inside the same `<pre>`, so columns, rows and copied text are unchanged. Color changes do not re-render the text.

The Colors panel offers swatches, a custom hex field (invalid input shows an error and keeps the last valid color), the browser's color picker (one undo step per pick), presets, reset and saved palettes. A saved palette is a `palette` library record with a name and a color for every slot. Gallery previews stay in the default colors.

`make test-export` checks slot lists against mappings, that colorized runs keep every character, the mapped shadow, color validation and version-1 migration. The browser suite covers slot visibility for mapped and unmapped fonts, swatches, custom and invalid input, presets, reset, undo/redo, reload and saved palettes.
