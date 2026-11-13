# Account library

Issue [#51](https://github.com/subculture-collective/aski/issues/51) adds a library stored in the visitor's account, using the record types of the [local library](library.md) and the wire protocol in the [account contract](account-sync-contract.md). Sign-in and sessions are described in [sessions.md](sessions.md). Issue [#55](https://github.com/subculture-collective/aski/issues/55) adds the explicit import of the browser library. Offline changes, conflict copies and image files are later work (#59, #63).

## In the studio

When a visitor is signed in, a **Library** choice appears above Saved work: **Account** (the default) or **This browser**. Saved work, favorites, collections and palettes all read from and write to the chosen library. Neither library is copied into the other unless the visitor imports, so work saved before sign-in stays in this browser and is not uploaded. Signing out shows the browser library again.

In the account library, Save text, Save design, rename, delete, favorites, collections and palettes work as they do locally. A design is saved with its recipe and exact text; image files are not stored in accounts yet, so the PNG/SVG options are hidden and **Save design with this GIF** saves the design without the GIF and says so. Another signed-in session for the same account sees the changes when it loads or comes back into view.

The page keeps no offline copy of the account library. A change that cannot be sent (offline, rate-limited, session ended) is reported and not retried; the draft is never affected. If an item changed in another session, the change is refused, the latest version is shown and the visitor can apply the change again.

## Import from this browser

When the account library is shown and this browser has records the account lacks, an **Import from this browser** panel says how many of each kind (for example "1 favorite, 1 design, 1 collection, 2 collection entries"). **Review import** lists that scope again with what will happen; nothing is sent until **Import into account**. **Not now** hides the panel until the next page load.

`shared/sync.ts` plans the import:

- Each browser record gets its own account UUID. The browser-to-account map is stored per account in IndexedDB (`imports` store, database version 3) before anything is sent. It holds UUIDs only.
- A record whose mapped UUID is already in the account, live or deleted, is not sent again. A repeated import adds nothing, an interrupted one resumes with the same UUIDs, and something deleted in the account is not brought back.
- Favorites the account already has (same family and variant) are reused instead of added. Collection entries are rewritten to the account UUIDs, reused when the account has the same entry, and left out when their collection or item was deleted in the account. Collections with equal names stay separate, and designs are always separate.
- Designs are imported with their recipe and exact text. Their image files stay in this browser, and the result says how many designs had them.
- Records go in reference order (text, palettes, favorites, designs, collections, entries) in batches of 100.

Before sending, the import reads the account again and plans from that. A Web Lock per account keeps two tabs from importing at once. After the last batch, it reads the account back and checks that every planned UUID is there. Only then does it report the import as done. The browser copies are never removed. If a batch fails or a reply is lost, the import stops, says nothing in this browser changed, and the next import finishes the job without duplicates: a committed batch is found on the fresh read, and a rolled-back one is planned again under the same account UUIDs.

## API

Both routes derive the owner from the session cookie. They return `401` without a valid session, including a session past its 7-day absolute lifetime. Responses are `no-store`.

`GET /api/library?cursor=…` returns `{ changes, cursor, more }`: up to 100 records changed after the cursor, oldest first, tombstones included. Without a cursor it starts at the beginning. A malformed cursor, or one ahead of the owner's latest change, returns `{ resync: true }` with an empty page, and the client starts again from the beginning. Reads are limited to 300 per session per minute.

`POST /api/library/mutations` takes `{ protocolVersion: 1, deviceId, mutations }` with 1–100 mutations, each `{ requestId, entityId, baseRevision, type, schemaVersion: 1, payload }` or `{ requestId, entityId, baseRevision, delete: true }`. Unknown fields, including any owner field, are refused. It requires the exact origin and JSON, like every other write, and the body may be up to 2 MiB (other routes allow 4 KiB). Writes are limited to 120 requests per owner per minute.

- The whole batch runs in one transaction. Any refusal rolls back every mutation in it.
- `baseRevision: 0` creates the record at revision 1. Otherwise the base must equal the stored revision, and the record must not be deleted; each accepted change adds 1. A stale base, a reused ID or a change to a deleted record returns `409` with the current record. A deleted ID is never brought back.
- Changing or deleting an ID the owner does not have returns `404`, whether the ID is unused or belongs to another owner. Two owners may use the same UUID without seeing each other's record.
- Payloads are validated with the same parser as the browser library: names 1–120 characters, known fonts, `#RRGGBB` colors, supported recipe versions. A design that lists image files is refused for now.
- A membership must name a live collection and a live favorite or design of the same owner, checked in the same transaction, so an earlier mutation in the batch counts. Favorites are unique by family and variant, and memberships by collection and item, among live records; a duplicate returns `409`.
- Deleting a collection, favorite or design also deletes the memberships that point at it, never the members. A tombstone keeps its envelope and drops its payload.
- `(owner, deviceId, requestId)` identifies a mutation. Sending the same mutation again returns its original result without writing; a different mutation under a used ID returns `409`. The device ID is a random per-browser UUID in localStorage; it scopes retries and is not an identity.

The response is `{ results, changes }`: one `{ requestId, entityId, revision }` per mutation and the current state of every record the batch touched.

## Storage

`npm run migrate:account` creates the tables next to Better Auth's. Every row has an `owner_id` that references the Better Auth user and is deleted with it.

- `aski_library_record` holds each record's envelope and JSON payload, keyed by owner and UUID. Each change stores the owner's next sequence number, which orders the change log.
- `aski_library_owner` holds each owner's latest sequence number. A write locks that row until it commits, so writes for one owner are serialized and a reader never sees a later change without the earlier ones.
- `aski_library_request` records each accepted mutation's hash and result for retries.

Tombstone expiry, request-record expiry and account deletion are not implemented yet.


## Tests

`make test-account` runs `server/library.test.ts` against the disposable database with two accounts. It covers create, list, rename and delete for every record type; collection deletion removing only memberships; refused edits, deletes and re-creation of a tombstone; cross-account reads, edits, deletes and references (identical `404`s for foreign and unknown IDs, whole-batch rollback); a stale revision returning the current record with nothing written; retries with the same and with changed bytes; payload, envelope and owner-field validation; favorite uniqueness; missing sessions, foreign origins, non-JSON and oversized bodies; sign-out ending access; paging and resync cursors; and the write limit.

`make test-account-ui` adds a browser case in Chromium, Firefox and the phone viewport. It saves text in the browser library, signs in, and checks that the account library is shown and the local text was not uploaded. It saves and renames a design in the account, signs in again in a second browser context and reopens it there, signs in as another account and finds nothing through the interface or the API, deletes the design from the second context, and checks that the first context no longer lists it and that its local text is still there under **This browser**. A second case seeds the browser library with a collection holding a favorite style and an exact design, signs in, and checks the import scope and that nothing is written before confirmation. It lets the account commit the import while the page never gets the reply, imports again and checks the account holds exactly five records, checks the browser copies are still there, then reopens the style and the design from the collection in a second signed-in session and checks that a later import offers nothing.

`make test-storage` runs `shared/sync.test.ts`: reference order and mapping, dropped image files, a repeated import that sends nothing, an interrupted import resuming with the same UUIDs, reuse of the account's equal favorites and entries, equally named collections kept apart, records deleted in the account not coming back, and deleted browser records not imported.

Each browser context sends its own test address through the preview proxy, which the capture server trusts, so the per-IP sign-in limits apply per context.
