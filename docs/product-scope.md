# Product scope

The user approved the recommendations on November 9, 2026, and added a dedicated animation section with GIF export. This document describes the target behavior. It does not describe an implemented application.

## Core workflow

Enter text once, browse font families, compare results, customize a result, and export or save it. Text editing remains available throughout the workflow.

The desktop layout has a sticky text editor, a family gallery, and a detail panel for the selected result. On small screens, the detail panel becomes a sheet. Opening the panel preserves the gallery position.

## Font families and discovery

- Show one gallery card per font family, with toggles for its available variants.
- Give families and variants stable identifiers. Curate groupings rather than assuming that similar names imply a shared family.
- Preserve each card's selected variant while the user edits text or browses elsewhere.
- Provide search and filters for appearance, output dimensions, and character support.
- Pin several results for comparison. Update all pinned previews from the same input.
- Show output width in columns and height in rows. Provide maximum-width, alignment, and multiline controls.
- Identify unsupported input characters. Keep the original input available for correction.
- Retain font attribution and available license information with the catalog.

## Continuous editing

- Preserve scroll position, selected variants, filters, pins, and open panels during text changes.
- Keep cards anchored when a new input changes preview dimensions.
- Provide undo and redo for text, style, palette, spacing, and animation changes.
- Recover drafts locally after a reload, including drafts created without an account.
- Keep typing and navigation responsive while previews or exports are generated.

## Palettes and color slots

- Present palette swatches alongside the selected result's editable color slots.
- Let the user select a slot, assign a palette swatch, or enter a custom hex color.
- Show foreground and background slots for every style. Show shadow, highlight, and additional slots where the style supports them.
- Define slot assignments for each supported style. Do not infer a shadow solely from a character such as a slash or underscore.
- Preserve whitespace and character alignment when applying colors.
- Support palette presets, saved palettes, palette reset, and a transparent background for compatible exports.
- Include a background preview so transparent output remains visible during editing.

## Spacing and seamless blocks

Letter spacing and gaps between rendered character cells are separate controls.

- Offer the font's default spacing, full spacing, fitted spacing, and supported merging modes.
- Preserve spaces that form the artwork or separate words. Removing every space is not a valid tightening operation.
- Offer a seamless mode for compatible block-character styles. Draw supported blocks as adjoining shapes in image and vector exports.
- Keep punctuation-based styles in their normal character form unless a supported conversion exists.
- Explain when a selected style cannot use seamless mode.
- Preserve aspect ratio and show the export dimensions.

Plain-text appearance depends on the destination's font and spacing. Seamless image rendering cannot guarantee seamless appearance after copying plain text.

## Animation section

Animation is part of the first release. A selected result opens in a dedicated animation section with its text, style, colors, and spacing intact.

### Initial effects

| Effect | Behavior |
| --- | --- |
| Typewriter | Reveal the input one character at a time while keeping the final artwork's canvas dimensions fixed. |
| Reveal | Wipe the completed artwork into view by row or column. |
| Palette cycle | Cycle colors through the assigned slots without moving the artwork. |
| Shimmer | Move a highlight across the artwork. |
| Glitch | Apply bounded character substitutions or row offsets, then restore the original artwork. |

Use one effect at a time in the first release. Combining effects remains a later extension.

### Controls and playback

- Provide effect selection, duration, frame rate, intensity where applicable, and effect-specific direction.
- Provide play, pause, restart, and a scrubber for inspecting individual frames.
- Offer continuous looping and play-once behavior. Include an end hold for effects such as typewriter.
- Keep the preview paused initially when the device requests reduced motion. Export remains available.
- Keep random effects repeatable so the exported glitch matches the preview.
- Retain animation settings while the user edits text, changes variants, or adjusts a color.

### GIF export

- Export the selected animation as a downloadable GIF with the configured size, timing, and loop behavior.
- Keep the output canvas fixed across frames to avoid unwanted shifting or cropping.
- Generate export frames from the same artwork and animation logic used by the preview.
- Show export progress and allow cancellation. Preserve the draft if export fails or is cancelled.
- Validate dimensions, duration, and frame count before export. Display an actionable limit message instead of starting an export that exceeds the supported budget.
- Show dimensions and frame count before export. Show the actual file size when encoding finishes.
- Provide a solid background by default and a transparent option where the effect supports it.
- Account for GIF's indexed colors, binary transparency, and timing precision. Preview an encoded sample when these limits change the appearance.
- Let the user export the current animation frame through the still-image controls.

## Still exports and sharing

- Export plain text, ANSI-colored text, SVG, and PNG.
- Copy whitespace-safe plain text and provide a code-block copy option.
- Offer transparent backgrounds for PNG and SVG.
- Preserve colors in compatible formats. Explain that plain text does not carry colors or animation.
- Provide shareable links that restore the input and editing settings, including animation settings.
- Keep account libraries private. Creating a share link is an explicit user action.

## Accounts and saved work

The editor and exports work without an account. Passwordless email sign-in enables saving across devices.

- Save inputs separately from rendered outputs so an input can be explored in other styles.
- Save reusable palettes.
- Save a result's text, family, variant, colors, spacing, dimensions, and animation settings as an editable recipe.
- For an individual saved output, retain the rendered artifact as well as its recipe. Future catalog changes must not silently alter the saved artifact.
- Allow the user to rename, organize, reopen, and delete saved work.
- Offer to import local drafts into the account without overwriting existing saved work.
- Preserve local work when the account is offline. Make sync status and conflicts visible.

## Approved later additions

The earlier recommendations also included gradients, custom font uploads, and a public community gallery. These remain in the approved backlog. Animation and GIF export move into the first release.

Custom uploads need font validation and attribution handling. Public publishing needs an explicit publish action and reporting controls before the community gallery is released.

## Reference baseline and evidence

The reference is [TAAG](https://patorjk.com/software/taag/). A text fetch on November 9, 2026 exposed font selection, an Options entry, Test all, filters, color controls for a displayed style, copying, image saving, and sharing.

The user noted that several recommendations already exist in TAAG's Options. The text fetch did not expose that panel's contents. A direct HTML request returned HTTP 403. The complete Options inventory remains an implementation prerequisite. Existing features must be recorded as parity requirements rather than described as new inventions.

The author's [figlet.js documentation](https://github.com/patorjk/figlet.js/blob/main/README.md) describes horizontal and vertical layout modes and width controls. These engine capabilities are useful candidates, but do not establish which controls TAAG currently exposes.
