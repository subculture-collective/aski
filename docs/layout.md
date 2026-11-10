# Layout

Recipe version 3 adds `layout`: a horizontal spacing mode, an optional maximum width and an alignment. Older recipes open with the defaults (font default spacing, no width limit, left alignment). `RECIPE_VERSIONS` in `shared/recipe.ts` lists every version the recipe parser, drafts and saved designs accept.

**Spacing.** *Font default* uses the layout in the font header (shown in the label). *Full width* keeps each glyph's full width; *Fitted* moves glyphs together until they touch. *Smushed* merges touching edges using the font's own smushing rules, so it is offered only when the header defines them. The importer records each font's default and whether it has smushing rules in the catalog (`spacing`). None of the 19 approved fonts defines smushing rules, so Smushed is shown as unavailable with the reason. Universal smushing, which overlaps glyphs without rules, is not offered. Fitting never removes the space glyph, so words stay apart. Switching to a font that cannot smush resets Smushed to the font default; other modes carry over.

**Maximum width.** 20–1,000 columns, or no limit. Long lines wrap between words (figlet's `whitespaceBreak`). Invalid values show an error and leave the layout unchanged.

**Alignment.** Each input line, and each wrapped line, is a block of rows. Figlet pads every row to the widest block; alignment moves that padding to the left, right or both sides of each block. Characters within a block's visible width, including its spaces, are never changed. Rows stay the same length, and the displayed columns and rows are counted from the final text.

Layout changes re-render the text and are single undo steps. Gallery previews use the default layout.

`make test-render` checks the default layout against the recorded parity sample, full versus fitted width with a surviving word gap, wrapping with accurate dimensions, block alignment that keeps artwork and spaces, layout validation and the smushing capability. The browser suite covers capability labels, the disabled Smushed option, mode carry-over, widths, invalid input, alignment, keyboard selection, reload and undo.
