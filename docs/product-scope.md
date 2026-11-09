# Product scope

The user approved the recommendations on November 9, 2026, and added a dedicated animation section with GIF export. This document describes the target behavior. It does not describe an implemented application.

## Product interview decisions

- Keep all three workflows central: browsing and collecting styles, creating static or animated graphics, and exporting developer-friendly text. The initial browsing preference did not exclude the other workflows.
- Group related font variants in one family card. Use filters for broader visual categories such as 3D lettering.
- Launch with a broad catalog. Group confirmed families and keep uncertain fonts separate while their metadata improves.
- Accept fewer discovery tags or color controls for some fonts initially. Show the controls each font supports.
- Launch as a free public tool. Editing and exports are free. Optional accounts add cross-device sync. Billing and paid feature boundaries are outside the first release.
- Animate a selected design through presets and adjustable controls. Font morphing and a multi-scene sequence editor are outside the first release.
- Use an expressive interface with bold colors, playful typography, and prominent animated previews.
- Provide favorites plus named collections for organizing styles and saved designs by project or mood. Keep reusable styles distinct from exact saved designs.
- Use the existing branding and design reference system to develop aski's identity and interface.
- Let people save favorites and named collections locally before signing in. Sign-in adds sync across devices.
- Provide the full studio on desktop, tablet, and phone at launch, including palettes, collections, animation, and GIF export.

The core product interview is complete. The owner selected Ink Arcade / Lilac and approved Fraunces for the wordmark/headings with Atkinson Hyperlegible Next for controls. Detailed control defaults in this document remain implementation proposals unless the user has explicitly settled them.

## Core workflow

Enter text once, browse font families, compare results, customize a result, and export or save it. Text editing remains available throughout the workflow.

The desktop layout has a sticky text editor, a family gallery, and a detail panel for the selected result. On small screens, the detail panel becomes a sheet. Opening the panel preserves the gallery position.

Desktop, tablet, and phone provide the same core capabilities. Adapt the controls to each screen while preserving the full workflow. Export limits must be measured on the supported devices, with GIF export available on all three device classes.

## Design and branding

The selected visual approach is an expressive creative tool: bold colors, playful interface typography, and prominent animated previews.

Use the [Studio reference library](https://subcult.tv/admin/studio/references) and its supporting studies to develop the identity. The library's local sources are under `studio/references/` in the `subcult-tv` repository on Kvant. Studio owns brand masters, guides, and tokens. This repository owns the product interface and its implementation.

The selected system is Ink Arcade / Lilac. The owner requested simpler copy and a distinctive replacement font, then approved the rendered Fraunces/Atkinson pairing. Canonical guides, tokens, masters, licenses and manifest hashes are in `subcult-tv/studio/brands/aski/`, tracked by [Studio PR #122](https://git.subcult.tv/subculture-collective/subcult-tv/pulls/122). Product integration remains a separate roadmap step.

Put the text input and artwork first. Use short control labels and contextual help instead of a promotional hero or repeated feature explanations in the studio.

## Font families and discovery

- Favor catalog breadth over requiring complete metadata for every font at launch.
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

Provide animation presets and adjustable controls for the chosen design. Font morphing and multi-scene sequencing are outside the first release.

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

The editor and exports are free and work without an account. Favorites and named collections save locally before sign-in. Optional accounts enable sync across devices. The proposed sign-in method is passwordless email. The first release has no payment system or paid feature tiers.

- Provide a favorites action for reusable styles and named collections for styles and saved designs.
- Restore local favorites and collections after a reload in the same browser.
- Explain that local-only data stays in that browser and may be lost if its stored data is cleared.
- Let a saved item appear in more than one collection without duplicating the underlying design.
- Keep a favorite style reusable with new text. Reopening a saved design restores its exact settings.
- Save inputs separately from rendered outputs so an input can be explored in other styles.
- Save reusable palettes.
- Save a result's text, family, variant, colors, spacing, dimensions, and animation settings as an editable recipe.
- For an individual saved output, retain the rendered artifact as well as its recipe. Future catalog changes must not silently alter the saved artifact.
- Allow the user to rename, organize, reopen, and delete saved work.
- Offer to import local drafts, favorites, collections, and saved designs into the account without overwriting existing saved work.
- Preserve local work when the account is offline. Make sync status and conflicts visible.

## Approved later additions

The earlier recommendations also included gradients, custom font uploads, and a public community gallery. These remain in the approved backlog. Animation and GIF export move into the first release.

Custom uploads need font validation and attribution handling. Public publishing needs an explicit publish action and reporting controls before the community gallery is released.

## Interview handoff

Goal: deliver a free public text-art studio for discovery, graphic creation, animation, and developer-friendly exports.

In scope: the broad grouped catalog, continuous editing, palettes, supported spacing and seamless-block controls, still exports, GIF effects, local saving, optional account sync, and full desktop, tablet, and phone workflows described above.

Out of scope for the first release: billing, paid feature tiers, font morphing, a multi-scene sequence editor, gradients, custom font uploads, and a public community gallery. The last three remain approved later additions.

Constraints and decisions: use the existing Studio references to develop an expressive identity. Preserve the distinction between reusable styles and saved designs. Sign-in is optional for local collecting.

Acceptance criteria:

- Browse confirmed font families and switch variants without losing the current text or gallery position.
- Apply a palette or custom color to every slot supported by the selected font.
- Favorite styles, organize named collections, and recover them after reloading without signing in.
- Sign in and bring local work into the account without overwriting existing saved work.
- Generate still exports and an animated GIF that agree with the corresponding preview, within each format's documented limits.
- Complete browsing, palette editing, collection saving, animation setup, and GIF export on desktop, tablet, and phone.

Verification: use the phased behavior checks in the [implementation plan](implementation-plan.md), including artifact inspection and complete workflows on the supported devices. No application behavior has been tested yet.

Open questions and research: select specific Studio references and the resulting aski identity, complete the TAAG Options inventory, select the application and account stack, establish the supported browser matrix and export budgets, and confirm the runtime host and public endpoint before deployment. These are not additional first-release features.

Recommended route: full implementation plan, refined with reference and technical findings before the affected work begins. The interview itself does not start implementation or deploy a service.

## Reference baseline and evidence

The reference is [TAAG](https://patorjk.com/software/taag/). A text fetch on November 9, 2026 exposed font selection, an Options entry, Test all, filters, color controls for a displayed style, copying, image saving, and sharing.

The user noted that several recommendations already exist in TAAG's Options. The initial text fetch did not expose that panel, and a direct HTML request returned HTTP 403. Wave 1 subsequently inspected the actual browser UI. The [parity and provenance record](research/taag-parity.md) now distinguishes FIGlet controls, TheDraw controls, existing favorites and filters, and catalog licensing limits. Existing features are parity requirements rather than new inventions.

The author's [figlet.js documentation](https://github.com/patorjk/figlet.js/blob/main/README.md) describes horizontal and vertical layout modes and width controls. These engine capabilities are useful candidates, but do not establish which controls TAAG currently exposes.
