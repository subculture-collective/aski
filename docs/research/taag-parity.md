# TAAG parity and font provenance

Decision record for [#9](https://git.subcult.tv/subculture-collective/aski/issues/9), observed November 9, 2026. The Options panel and representative outputs were inspected in the actual [TAAG UI](https://patorjk.com/software/taag/). The browser reported 1,386 font choices. This is the site's count, not the size of aski's catalog.

## Existing controls form the baseline

| Surface | Observed behavior | aski treatment |
| --- | --- | --- |
| Font picker and input | Searchable font picker, live multiline input, deep-link settings | Preserve input and rendering; add confirmed family groupings and stable browsing anchors. |
| FIGlet Options | Horizontal and vertical kerning each expose Default, Full, Fitted, Controlled Smushing, and Universal Smushing | Preserve supported engine modes. Default means the font author's layout. |
| FIGlet width | Optional maximum output width, initially 80 columns | Preserve the width control and test its wrapping behavior. |
| Font information | View the selected font's header comment | Retain authorship, source, notices, and character coverage. |
| Preferences | Light/dark switch, browser-local favorites, and import/export/clear favorites | Treat local favorites as parity. Add named collections and optional sync. |
| Output filters | Color treatments, horizontal/vertical flips, and language-specific code-comment wrappers | Preserve these capabilities in the appropriate export/filter controls. |
| Still output | Copy, Save as image, and Share actions | Preserve these actions; aski specifies additional portable SVG and ANSI exports. |
| TheDraw output | Colored block art, color toggle, copy menu, image/save/share actions | Preserve format distinctions in the renderer contract; these are not FIGlet fonts. |
| TheDraw Options | Black/background handling and true-color ANSI preference | Use explicit palette indices and foreground/background cell roles for compatible formats. |
| Test all | Catalog-wide discovery with section, minimum/maximum height, and favorites-only controls | Preserve these filters. aski adds family grouping and uninterrupted browsing; previewing many fonts is not itself new. |

The FIGlet filter menu includes rainbow/chromostereopsis treatments, flips, sleek rendering, and code comments for Bash, C, C++, Fortran, LaTeX, Lua, MySQL, shell echo, and Visual Basic. Named accounts, collection sync, and GIF editing were not established by this inspection. Their absence from an inspected state is not a proof of absence from the entire site.

The observation JSON records the same `ASKI` newline `A🙂` input in Standard, Isometric1, and the colored TheDraw font Bleach. Standard and Isometric1 match the pinned engine's output hashes. Input containing the emoji remains in TAAG's editor even when the selected font cannot render it. aski must report unsupported code points explicitly instead of silently dropping them.

## Font formats and redistribution decisions

Use `figlet@1.12.0` as the reproducible FIGfont candidate source. Its published package has 332 `.flf` files, including converted TOIlet fonts. The engine is MIT-licensed. That engine license is not a substitute for each font's authorship and redistribution evidence.

The [reproducible audit](../../research/font-audit/catalog-audit.json) records every candidate's source URL, byte hash, header hash, height, and notice classification. Nineteen headers have explicit MIT or WTFPL redistribution language. The other 313 require review, including headers that permit modification without a complete redistribution statement. Classification is evidence triage, not a legal conclusion or an automatic shipping allowlist.

The catalog importer in #14 must retain the original notice, record the reviewed rights decision and its evidence hash, and ship only approved entries. Missing metadata can remain incomplete; unresolved redistribution permission keeps the font binary out of public output. Preserve the broad candidate inventory so review can expand the available catalog without changing identifiers.

The [TAAG author's TheDraw update](https://patorjk.com/blog/2026/07/17/adding-thedraw-fonts-to-taag/) distinguishes the format from FIGlet and notes unresolved redistribution rights for its legacy font files. The inspected `figlet@1.12.0` API has no TDF parser. Do not copy TAAG's bundled implementation or download its TDF collection into aski. Support a format adapter and explicit cell colors in the data contract; include TDF fonts only after a documented source, parser implementation, and rights decision exist. The site URL's public availability is not redistribution evidence.

Representative source headers identify Standard/Small/Slant as related designs, Isometric1–4 as conversions of the same author's work, and ANSI Shadow as having an unknown font author. The last is research evidence, not a cleared launch asset. Explicitly licensed colored/block candidates include ANSI Compact and the Linguaholic pixel fonts. These can support palette and seamless-block exploration while the larger catalog is reviewed.

## Stable catalog and capability contract

- Assign immutable namespaced IDs once, such as `figlet/isometric` for a confirmed family and `figlet/isometric1` for a variant. Maintain aliases when display names change.
- Keep variant identity separate from the font byte hash and renderer version. Saved outputs retain their original provenance and artifact bytes.
- Confirm family relationships from source headers or author records. Similar-looking unrelated fonts remain separate cards and share category filters.
- Store unknown tags, character coverage, and additional color mappings as unknown, rather than false or fabricated values.
- Give every render foreground/background roles. Add shadow/highlight slots only from a reviewed mapping. A slash or underscore does not identify a shadow.
- Track glyph coverage by Unicode code point. Compare it with input before rendering, retain the original input, and present unsupported characters to the user.
- Distinguish native font colors, palette slot assignments, letter kerning, and block-cell geometry. A generic cell-grid adapter must carry glyph, foreground/background slot, and coordinates.

## Reproduce and verify

From the repository root:

```sh
npm ci --prefix research/font-audit --ignore-scripts --no-audit --no-fund
npm --prefix research/font-audit run check
```

`audit.mjs` verifies the pinned inventory and representative render hashes against the checked-in report. To investigate an upstream change, regenerate with `npm --prefix research/font-audit run audit` and review the changed hashes/notices before accepting it. The research CI runs the drift check on each PR.

Primary sources: [FIGfont specification](https://github.com/patorjk/figlet.js/blob/v1.12.0/doc/figfont.txt), [pinned engine source and API](https://github.com/patorjk/figlet.js/tree/v1.12.0), [engine license](https://github.com/patorjk/figlet.js/blob/v1.12.0/LICENSE.txt), and each font URL in the audit. No production font import or complete browser parity claim is made by this research PR.
