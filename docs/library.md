# Local library

Favorites (and later saved inputs, designs, palettes and collections) are stored in the browser's IndexedDB database `aski-library`, object store `records`. It is separate from the `aski:draft` key in localStorage. IndexedDB can also hold artifact bytes later, which localStorage cannot.

Each record uses the envelope from the [account contract](account-sync-contract.md): `namespace`, UUID `id`, `type`, `schemaVersion: 1`, `payload`, `revision`, `deletedAt`, `createdAt` and `updatedAt`. Records made before sign-in use the `anonymous` namespace and revision 0, meaning no server has acknowledged them. Removing an anonymous record deletes it; tombstones begin with account sync.

A favorite payload is a stable `familyId` and optional `variantId`. It holds no text or rendered output, so applying it changes only the style of the current design. Favorites are unique by family and variant.

Records with an unknown schema version, type or font are counted in a warning and left unchanged in storage. If IndexedDB is unavailable or a write fails, favorites still work until the page closes and a warning says so. Favorites never contact the account service.

`make test-storage` covers record validation, favorite uniqueness and unreadable records. The browser suite covers favorite/unfavorite, reload, applying a favorite to new text with the account API unreachable, unreadable records kept in place, and touch use.
