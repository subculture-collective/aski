# Implementation plan

This plan implements the [approved scope](product-scope.md). Each phase has a commit checkpoint and behavior that must pass before the next phase depends on it.

## Interview constraints

Keep browsing, graphic creation, and developer-friendly exports in the first release. Start with a broad catalog, grouping confirmed relatives and exposing color controls according to each font's supported mappings. Complete metadata is not a prerequisite for including a font.

Editing and exports are free. Optional accounts provide saving and sync. Exclude billing and paid feature tiers from this plan.

Animation uses presets and adjustable effects on a selected design. Exclude font morphing and a multi-scene sequence editor from the first release.

The product interview is ongoing. Resolve visual direction and collection behavior before committing to their interfaces.

## Starting state

On November 9, 2026, the workspace contained an empty Git repository on an unborn `main` branch. No remote, application code, framework, or deployment configuration was present. The earlier worktree preparation reported `ref_not_found`, consistent with the absence of a base commit.

The initial documentation commit establishes a local base. Worktree provisioning through T3 has not been retested. No hosted repository or deployment is implied by that commit.

## 1. Establish baseline and application foundation

Inventory TAAG's Options and representative font families. Record existing behavior separately from the improvements in the approved scope.

Select the frontend, rendering engine, GIF encoder, and account service using current documentation. Check browser support, font licenses, encoder behavior, and hosting requirements before adding dependencies. Confirm the intended runtime host before provisioning services.

Create the responsive editor, gallery, and selected-result panel. Use stable family and variant identifiers. Keep text generation separate from color application, animation frames, and export encoding.

Acceptance checks:

- Render representative ASCII and block-character fonts from a recorded catalog.
- Preserve multiline input and report unsupported characters.
- Keep the text editor accessible by keyboard on desktop and mobile layouts.
- Record build, type-check, and relevant test commands in the README.

Commit checkpoint: application shell, catalog, and rendering foundation.

## 2. Complete browsing and continuous editing

Add grouped variants, filters, pin-and-compare, dimensions, width controls, undo, redo, and local draft recovery.

Acceptance checks:

- Scroll to a family, choose a variant, change the input, and confirm that the same family remains anchored in view.
- Confirm that selected variants, filters, pins, and open panels survive input changes.
- Reload a draft and recover its text and settings.
- Compare several pinned results and confirm that all use the current input.
- Change output height substantially without losing the gallery position.

Commit checkpoint: browsing and draft workflow.

## 3. Add color, spacing, still exports, and share links

Implement color-slot mappings, palette presets, custom colors, supported spacing modes, and seamless rendering for compatible blocks. Add text, ANSI, SVG, and PNG export through shared rendering data.

Acceptance checks:

- Change each slot using a swatch and a custom hex value. Reject invalid colors without losing the last valid value.
- Confirm that copied text retains leading spaces, internal spaces, and line breaks.
- Inspect exported PNG and SVG artifacts for matching dimensions, colors, and block joins.
- Confirm that tightening preserves letter shapes and intentional word spacing.
- Open a share link in a fresh session and recover the same input and editing settings.
- Keep normal character rendering available for styles that cannot use seamless mode.

Commit checkpoint: color controls and still exports.

## 4. Add animation and GIF export

Implement typewriter, reveal, palette cycle, shimmer, and glitch as deterministic transformations of the selected artwork. Use a shared frame function for preview and export.

Run encoding away from the main interaction loop. Choose initial export limits after measuring representative desktop and mobile cases. Keep cancellation and progress available throughout encoding.

Acceptance checks:

- Seek to the same timestamp twice and obtain the same frame, including for glitch effects.
- Confirm that changing text preserves animation controls and the selected effect.
- Decode exported GIFs and inspect frame count, frame timing, loop behavior, canvas size, and sampled frame appearance.
- Check color reduction and transparent frame disposal for trails or flicker.
- Play an exported GIF in an independent viewer.
- Cancel an export and start another without reloading or losing the draft.
- Reject exports over the supported budget before allocating all frames.
- Honor reduced motion for preview playback without disabling export.

Commit checkpoint: animation section and verified GIF artifacts.

## 5. Add passwordless accounts and saved artifacts

Select the account and persistence services for the confirmed runtime. Configure email delivery without logging sign-in tokens. Store private saved inputs, palettes, recipes, and rendered artifacts under the authenticated owner.

Acceptance checks:

- Send and redeem a sign-in link through a test mail service. Reject expired and reused links.
- Confirm that one account cannot read, update, or delete another account's saved work.
- Save an input and a specific output, then reopen each from a second session.
- Reopen an animated output with its effect settings and retrieve its saved GIF artifact.
- Confirm that an updated catalog does not alter a previously saved artifact.
- Import a local draft without overwriting an existing saved result.
- Recover from a failed sync without losing the local draft.

Commit checkpoint: account saving and sync.

## 6. Verify and release the first version

Complete keyboard, responsive layout, accessibility, rendering, account, and export checks. Measure typing responsiveness and export limits with representative inputs and device sizes.

Document configuration, backup and restore of saved work, and release rollback. Provision a runtime only after its host and public endpoint are established. Check the live release and repeat a save-and-export workflow before reporting deployment as complete.

Commit checkpoint: release candidate with recorded checks and remaining limitations.

## Later releases

Implement gradients, custom font uploads, and the public community gallery after the first version passes its acceptance checks. Retain the same editable recipe format and explicit public-sharing behavior.

## Rollout and recovery

Keep each phase in a separate reviewable commit. Preserve saved recipes with a schema version and migrate copies before replacing stored data. Back up persisted artifacts before storage migrations. Retain the previous runnable release for rollback.

Do not discard local drafts after a failed import or sync. Remove a draft only after its saved replacement has been read back successfully.
