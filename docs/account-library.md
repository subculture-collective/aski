# Account library

Issue [#51](https://github.com/subculture-collective/aski/issues/51) adds a library stored in the visitor's account, using the record types of the [local library](library.md) and the wire protocol in the [account contract](account-sync-contract.md). Sign-in and sessions are described in [sessions.md](sessions.md). Issue [#55](https://github.com/subculture-collective/aski/issues/55) adds the explicit import of the browser library. Issue [#59](https://github.com/subculture-collective/aski/issues/59) adds the offline copy, the queue of unsent changes and conflict handling. Issue [#63](https://github.com/subculture-collective/aski/issues/63) adds image files.

## In the studio

When a visitor is signed in, a **Library** choice appears above Saved work: **Account** (the default) or **This browser**. Saved work, favorites, collections and palettes all read from and write to the chosen library. Neither library is copied into the other unless the visitor imports, so work saved before sign-in stays in this browser and is not uploaded. Signing out shows the browser library again.

In the account library, Save text, Save design, rename, delete, favorites, collections and palettes work as they do locally. A design is saved with its recipe, its exact text and any PNG, SVG or GIF chosen with it, as described under Image files. Another signed-in session for the same account sees the changes when it loads or comes back into view.

## Offline copy and unsent changes

This browser keeps a copy of the signed-in account's records and a queue of its unsent changes, both under that account's user ID. A change shows at once, is written to the queue in IndexedDB, and only then is sent. The queue is sent in order, one batch at a time. The status line under **Library** says whether everything is saved, how many changes are being sent, or that the account cannot be reached and how many changes are kept in this browser.

- **Retries.** A batch keeps the exact bytes it was first sent with until the server acknowledges it, so a retry after a lost reply returns the original result instead of writing twice. Network failures and server errors retry after 2, 5, 15, 30 and then every 60 seconds, and at once when the browser comes back online or the page comes back into view. A rate limit waits for its `Retry-After`.
- **Revisions.** The server adds exactly one revision per accepted change, so a queued change's base revision is the last acknowledged revision plus the changes already queued for that record. Several offline edits to one item therefore apply in order.
- **Offline reload.** The last signed-in account's user ID and address are kept in localStorage (`aski:account`; never a token). If the session check fails because the service cannot be reached, the studio shows that account as "(offline)" with its copy and queue, keeps queueing changes, and checks again every 30 seconds and when the browser comes back online. A signed-out answer, a different account or sign-out removes that entry.
- **Session ends.** If the server answers `401`, the page signs out. The account's copy is removed from this browser; its unsent changes stay, bound to that account.
- **Resync.** When the server asks for a full resync, the copy is rebuilt from the start and the queue is kept and checked against the fresh copy when it is sent.

Drafts, the browser library and exports never depend on any of this.

## Conflicts and deletions

When the server refuses a batch it keeps nothing from it and names the refused change (`entityId`, plus the current `record` for `409`). The page rewrites only that change, following `shared/outbox.ts`, and sends the batch again:

| Situation | Result |
| --- | --- |
| The item was edited in another session | The other session's version stays. The local edit is saved as a new item named "… (conflicting copy)". |
| The item was deleted in another session, or the account does not have it | The deletion stays. The local edit is saved as a new item named "… (recovered)". A deleted UUID is never reused. |
| A local delete of an item edited elsewhere | The edited version is kept and the visitor is told. A delete is never turned into a create. |
| A local delete of an item already deleted | Nothing more to do. |
| A new favorite or collection entry the account already has | The account's existing one is used. |
| Any other refusal (for example, an invalid name) | That change is dropped and the message is shown. |

Queued changes that come later and refer to the same item, including collection entries, follow it to its new UUID with matching revisions. Nothing behind the refused batch has been sent yet, so rewriting them is safe.

The contract asks for a conflict copy to carry `conflictOf`. Record payloads have no such field and the server refuses unknown fields, so the copy is marked by its name instead. Adding the field means a new payload schema version; that is left for review.

## Image files

PNG, SVG and GIF files saved with an account design are uploaded and kept exactly as exported; they are never regenerated.

- **Saving.** The files are hashed and kept in this browser under the account's namespace, then queued as uploads ahead of the design that lists them. The design shows at once with its files. If the browser has no room for them, the design is saved without them and the visitor is told.
- **Upload.** `PUT /api/artifacts/:id?sha256=…&width=…&height=…&variantId=…&fontSha256=…&rendererVersion=…` sends the bytes with the file's own content type, from the studio's origin only, up to 32 MiB. The server checks the SHA-256, the size, the PNG or GIF signature and pixel size, and for SVG an allow-list of exactly what aski's export writes (`svg`, `g`, `rect`, `text` and their attributes). It refuses declarations, comments, scripts, event handlers, external references and unknown entities. It writes the bytes under `ARTIFACT_ROOT` with a random storage key, then records the owner-scoped details. Repeating the same upload is acknowledged; different bytes under a used ID return `409`.
- **Download.** `GET /api/artifacts` lists the owner's files and `GET /api/artifacts/:id` returns one file as a private, `no-store`, `nosniff`, sandboxed attachment. The server checks the hash on every read and reports damage instead of serving it. **Download original** uses this browser's copy if it has one, otherwise downloads the file, checks its hash and keeps a copy. Another owner's file ID returns the same `404` as an unused one.
- **Refusals and retries.** A failed upload waits and retries like any queued change. If the account refuses a file, or its bytes are gone from this browser, the file is taken out of the queued designs; the designs are still saved, and the file stays in this browser. A design refused because the account lacks one of its files is saved without its files.
- **Deletion.** Deleting a design queues the removal of files no other design uses. `DELETE /api/artifacts/:id` refuses with `409` while a live design lists the file. A removed file stops being readable or listable at once. Its bytes stay recoverable for 30 days, and then the hourly sweep in `server/main.ts` deletes them. The sweep also removes temporary uploads older than 24 hours and bytes left without details (for example after account deletion) once they are older than 24 hours.
- **Signing out** removes downloaded copies from this browser but keeps files that unsent changes still need. **Copy to this browser** copies a waiting design's files into the browser library under new IDs.

Importing from this browser does not upload files yet.

## Unsent changes for another account

While a different account, or none, is signed in, an **Unsent account changes** panel lists each other account's queue with its address. Those changes are sent when that account signs in here again and never to a different account. **Copy to this browser** turns them into new items in the browser library (deletions are not copied; favorites already here are reused; collection entries are kept when both ends were copied) and clears the queue in the same transaction. **Discard** asks for confirmation, then clears it.


## Import from this browser

When the account library is shown and this browser has records the account lacks, an **Import from this browser** panel says how many of each kind (for example "1 favorite, 1 design, 1 collection, 2 collection entries"). **Review import** lists that scope again with what will happen; nothing is sent until **Import into account**. **Not now** hides the panel until the next page load.

`shared/sync.ts` plans the import:

- Each browser record gets its own account UUID. The browser-to-account map is stored per account in IndexedDB (`imports` store, database version 3) before anything is sent. It holds UUIDs only.
- A record whose mapped UUID is already in the account, live or deleted, is not sent again. A repeated import adds nothing, an interrupted one resumes with the same UUIDs, and something deleted in the account is not brought back.
- Favorites the account already has (same family and variant) are reused instead of added. Collection entries are rewritten to the account UUIDs, reused when the account has the same entry, and left out when their collection or item was deleted in the account. Collections with equal names stay separate, and designs are always separate.
- Designs are imported with their recipe and exact text. Their image files are not imported and stay in this browser; the result says how many designs had them.
- Records go in reference order (text, palettes, favorites, designs, collections, entries) in batches of 100.

Before sending, the import reads the account again and plans from that. A Web Lock per account keeps two tabs from importing at once. After the last batch, it reads the account back and checks that every planned UUID is there. Only then does it report the import as done. The browser copies are never removed. If a batch fails or a reply is lost, the import stops, says nothing in this browser changed, and the next import finishes the job without duplicates: a committed batch is found on the fresh read, and a rolled-back one is planned again under the same account UUIDs.

## API

Both routes derive the owner from the session cookie. They return `401` without a valid session, including a session past its 7-day absolute lifetime. Responses are `no-store`.

`GET /api/library?cursor=…` returns `{ changes, cursor, more }`: up to 100 records changed after the cursor, oldest first, tombstones included. Without a cursor it starts at the beginning. A malformed cursor, or one ahead of the owner's latest change, returns `{ resync: true }` with an empty page, and the client starts again from the beginning. Reads are limited to 300 per session per minute.

`POST /api/library/mutations` takes `{ protocolVersion: 1, deviceId, mutations }` with 1–100 mutations, each `{ requestId, entityId, baseRevision, type, schemaVersion: 1, payload }` or `{ requestId, entityId, baseRevision, delete: true }`. Unknown fields, including any owner field, are refused. It requires the exact origin and JSON, like every other write, and the body may be up to 2 MiB (other routes allow 4 KiB). Writes are limited to 120 requests per owner per minute.

- The whole batch runs in one transaction. Any refusal rolls back every mutation in it.
- `baseRevision: 0` creates the record at revision 1. Otherwise the base must equal the stored revision, and the record must not be deleted; each accepted change adds 1. A stale base, a reused ID or a change to a deleted record returns `409` with the current record. A deleted ID is never brought back.
- Changing or deleting an ID the owner does not have returns `404`, whether the ID is unused or belongs to another owner. Two owners may use the same UUID without seeing each other's record.
- Payloads are validated with the same parser as the browser library: names 1–120 characters, known fonts, `#RRGGBB` colors, supported recipe versions. A design may list only image files its owner has uploaded and not deleted; otherwise it is refused with `code: "artifact"`.
- A membership must name a live collection and a live favorite or design of the same owner, checked in the same transaction, so an earlier mutation in the batch counts. Favorites are unique by family and variant, and memberships by collection and item, among live records; a duplicate returns `409`.
- Deleting a collection, favorite or design also deletes the memberships that point at it, never the members. A tombstone keeps its envelope and drops its payload.
- `(owner, deviceId, requestId)` identifies a mutation. Sending the same mutation again returns its original result without writing; a different mutation under a used ID returns `409`. The device ID is a random per-browser UUID in localStorage; it scopes retries and is not an identity.

The response is `{ results, changes }`: one `{ requestId, entityId, revision }` per mutation and the current state of every record the batch touched.

## Storage

`npm run migrate:account` creates the tables next to Better Auth's. Every row has an `owner_id` that references the Better Auth user and is deleted with it.

- `aski_library_record` holds each record's envelope and JSON payload, keyed by owner and UUID. Each change stores the owner's next sequence number, which orders the change log.
- `aski_library_owner` holds each owner's latest sequence number. A write locks that row until it commits, so writes for one owner are serialized and a reader never sees a later change without the earlier ones.
- `aski_library_request` records each accepted mutation's hash and result for retries.
- `aski_artifact` holds each image file's owner, UUID, SHA-256, type, byte length, pixel size, provenance, storage key and deletion time. The bytes are files named by storage key in `ARTIFACT_ROOT/objects`; uploads are written to `ARTIFACT_ROOT/tmp` first. Without `ARTIFACT_ROOT`, file routes answer `503` and designs with files are saved without them.

A refusal names the change it is about with `entityId`. A new favorite or collection entry equal to a live one returns `409` with `duplicate: true` and the existing record.

Tombstone expiry, request-record expiry and account deletion are not implemented yet.


## Tests

`make test-account` runs `server/library.test.ts` against the disposable database with two accounts. It covers create, list, rename and delete for every record type; collection deletion removing only memberships; refused edits, deletes and re-creation of a tombstone; cross-account reads, edits, deletes and references (identical `404`s for foreign and unknown IDs, whole-batch rollback); a stale revision returning the current record with nothing written; retries with the same and with changed bytes; payload, envelope and owner-field validation; favorite uniqueness; missing sessions, foreign origins, non-JSON and oversized bodies; sign-out ending access; paging and resync cursors; and the write limit.

`make test-account-ui` adds a browser case in Chromium, Firefox and the phone viewport. It saves text in the browser library, signs in, and checks that the account library is shown and the local text was not uploaded. It saves and renames a design in the account, signs in again in a second browser context and reopens it there, signs in as another account and finds nothing through the interface or the API, deletes the design from the second context, and checks that the first context no longer lists it and that its local text is still there under **This browser**. A second case seeds the browser library with a collection holding a favorite style and an exact design, signs in, and checks the import scope and that nothing is written before confirmation. It lets the account commit the import while the page never gets the reply, imports again and checks the account holds exactly five records, checks the browser copies are still there, then reopens the style and the design from the collection in a second signed-in session and checks that a later import offers nothing.

`make test-account` also runs `server/artifacts.test.ts`: upload, listing and exact download with private headers; another account's identical `404`, refused references and its own file under the same ID; hash, size, type, signature, SVG, owner-field, origin, session and size-limit refusals that leave nothing on disk; repeated and conflicting uploads; deletion refused while a design uses the file, then the file unreadable and unreferable; damaged bytes reported rather than served; a service without an artifact root refusing files; and the sweep keeping recent files and removing old temporary uploads, long-deleted bytes and unowned bytes. `make test-export` runs `shared/artifact.test.ts`, which checks that aski's SVG exports pass and that active, external and malformed SVG and mismatched PNG and GIF files are refused.

`make test-storage` runs `shared/outbox.test.ts`: chained revisions and the pending view, a queued delete hiding collection entries, a concurrent edit becoming a named copy with later edits and entries following it, edits of deleted or unknown items recovered as new items, deletes never replayed as creates, duplicate favorites reusing the account's, refusals with and without a named change, and designs kept without refused or missing files. It also runs `shared/sync.test.ts`: reference order and mapping, dropped image files, a repeated import that sends nothing, an interrupted import resuming with the same UUIDs, reuse of the account's equal favorites and entries, equally named collections kept apart, records deleted in the account not coming back, and deleted browser records not imported.

Three more cases cover #59. With every account request failing, a saved text waits, survives a reload that shows the account as offline, drafting still works, and the change is sent once the service returns. Two sessions of one account edit while the second cannot send: the first renames one text and deletes another, the second renames both; afterwards both sessions and the API show the first session's name, the second's as a conflicting copy and its other edit as a recovered item. A session that ends with a change waiting signs out, lists the change under its address, does not send it after another account signs in, and copies it into the browser library.

A case for #63 saves a glitch animation with its GIF in one session, checks the account holds a file with the GIF's hash, reopens the design in a second session and downloads a GIF with the same hash, gets the same `404` for the file and an unused ID from another account, and checks the file is removed from the account when the design is deleted.

Each browser context sends its own test address through the preview proxy, which the capture server trusts, so the per-IP sign-in limits apply per context.
