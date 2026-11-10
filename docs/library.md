# Local library

Favorites, saved text and saved designs (and later palettes and collections) are stored in the browser's IndexedDB database `aski-library`, object store `records`. It is separate from the `aski:draft` key in localStorage. IndexedDB can also hold artifact bytes later, which localStorage cannot.

Each record uses the envelope from the [account contract](account-sync-contract.md): `namespace`, UUID `id`, `type`, `schemaVersion: 1`, `payload`, `revision`, `deletedAt`, `createdAt` and `updatedAt`. Records made before sign-in use the `anonymous` namespace and revision 0, meaning no server has acknowledged them. Removing an anonymous record deletes it; tombstones begin with account sync.

A favorite payload is a stable `familyId` and optional `variantId`. It holds no text or rendered output, so applying it changes only the style of the current design. Favorites are unique by family and variant.

Saved text (`input`) holds the original text and a name. Opening it replaces the editor text and keeps the current style, so the same words can be tried in another font. A saved design holds a name, a full version-1 recipe with its own recipe UUID, font SHA-256 and renderer version, and a snapshot of the exact output text with its columns and rows. The snapshot is never re-rendered. Opening a design restores its recipe as one undoable edit. If this build lacks the design's font or renderer version, the current work is left alone, an explanation appears, and **Copy saved text** still copies the snapshot. If the restored recipe renders differently from its snapshot, the studio says so. Names are 1–120 characters; defaults come from the first line of text. Rename and delete (with confirmation) apply to both kinds.

Records with an unknown schema version, type or font are counted in a warning and left unchanged in storage. If IndexedDB is unavailable or a write fails, favorites still work until the page closes and a warning says so. Favorites never contact the account service.

`make test-storage` covers record validation, favorite uniqueness, name limits, unreadable records and a design whose renderer changed after saving. The browser suite covers favorite/unfavorite, reload, applying a favorite to new text with the account API unreachable, unreadable records kept in place, touch use, two designs from one text restoring their own variants and snapshots, saved text reopening in the current style, rename/delete across reloads, and a design from an unavailable renderer.
