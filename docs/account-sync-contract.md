# Optional accounts and local sync

Decision for [#32](https://github.com/subculture-collective/aski/issues/32), 2026-11-09. Anonymous editing, collecting and exports remain local and free. This record defines the service contract; it does not implement authentication or provision credentials.

## Authentication boundary

Use Better Auth on the selected Node/Hono service, with PostgreSQL-backed sessions and verification records. Pin and inspect the implementation release when adding it. Configure magic-link `storeToken: "hashed"` explicitly: upstream documents a plain-token default. Use atomic token consumption, including a simultaneous-redemption test. No secondary verification store is needed initially.

Send sign-in mail through Brevo's transactional API, using a separately provisioned application credential and a verified SUBCULT sender. Test through an isolated capture transport. Sending a sign-in message must not subscribe the address to marketing. Sender verification and actual delivery are release evidence, not outcomes of this contract.

Links expire after 10 minutes and mint at most one session. The email opens `/auth/confirm#token=…`; this page has no third-party resources or analytics and sets `Referrer-Policy: no-referrer`. A deliberate Continue action submits the token to a same-origin handler. The handler performs origin/CSRF checks and redeems through the pinned Better Auth adapter. Do not email Better Auth's consuming GET endpoint directly: email scanners can follow GET links. Remove the fragment after capturing it in memory. Never put tokens in application logs, telemetry, browser persistence or redirects.

Session cookies are Secure, HttpOnly, SameSite=Lax and host-only, with a 7-day absolute lifetime and 24-hour refresh interval. Logout revokes the database session; account deletion revokes every session. Reject cross-origin mutations, require JSON for application writes, validate exact trusted origins and accept callback paths only from an allowlist. Public CORS and wildcard credentialed origins are excluded. Proxy forwarding is trusted only from the configured ingress, never from arbitrary client headers.

Rate limits are server-side: sign-in requests 5/address/hour and 20/IP/hour; verification 10/IP/10 minutes; authenticated writes 120/owner/minute; ordinary API reads 300/session/minute. Apply distributed/database-backed counters if more than one API instance runs. Return a generic sign-in acknowledgement for new and existing addresses, and `429` with Retry-After for limits. Rate-limit failures preserve local work. The implementation must inspect Better Auth's built-in limits as well as these application limits.

## Identity and records

Local database schema version 1 has independent namespaces: anonymous library and one cache/outbox per authenticated subject. A device UUID is not an owner identity. Never persist bearer/session tokens in localStorage or IndexedDB. Local-only records remain available without a request to the API.

Every mutable entity has a UUID, type, schemaVersion, payload, revision, deletedAt and server timestamps. Entity types are input, palette, design, favorite, collection and membership. Recipes retain their original text and stable font family/variant IDs, font hash and renderer version. Artifact bytes are immutable and distinct from mutable recipes; local records use Uint8Array plus MIME/hash metadata as required by the WebKit probe.

Every endpoint derives the owner from the session. SQL queries include that owner for reads, writes, references and uniqueness checks. A client-supplied owner is rejected. Missing and foreign UUIDs return the same `404`. Foreign collection/design/artifact references are rejected within the same transaction. Artifact hashes are not authorization tokens, and cross-account deduplication must not reveal whether another owner has a hash.

Version 1 record payloads are:

| Type | Payload |
| --- | --- |
| input | Original UTF-8 text and an optional name. |
| palette | Name and named slot assignments, each a validated `#RRGGBB` value. Transparency is a separate export setting. |
| design | Recipe schemaVersion, input, stable familyId/variantId, font SHA-256, renderer version, palette/layout/animation settings supported by that recipe version, and owned artifact UUID references. |
| favorite | Stable familyId and optional variantId; unique within the owner. |
| collection | Name, without name-based identity or implicit uniqueness. |
| membership | collectionId, itemType and itemId; unique as an owner-scoped tuple. |
| artifact | Immutable metadata UUID, SHA-256, MIME, byte length, dimensions, recipe/font/renderer provenance and owned byte-store key. |

Mutation envelopes have `protocolVersion: 1`, deviceId and an array of operations. Every operation has its own requestId, entityId and baseRevision; creating an entity uses revision 0. IDs are UUIDs and revisions are nonnegative server-issued integers. A local outbox stores the exact request bytes until acknowledged. Names are 1–120 characters. Validate referenced recipe versions before accepting a design; the initial skeleton's supported subset does not authorize unknown future settings.

## Wire protocol

| Operation | Contract |
| --- | --- |
| `GET /api/library?cursor=…` | Owner-scoped, monotonically ordered change log, including tombstones; up to 100 changes and an opaque next cursor. Advance the local cursor only in the transaction that applies the page. |
| `POST /api/library/mutations` | Up to 100 mutations; each has deviceId, requestId, entityId, baseRevision and payload or delete. Validate the whole batch, then commit changes and idempotency results atomically. |
| Conflict | A stale baseRevision returns `409` with the current owner-scoped record. No accepted writes from that batch and no silent timestamp-based winner. |
| Retry | `(owner, deviceId, requestId)` identifies a request. Repeating identical bytes returns its original result; changed bytes with that key return `409`. Never overwrite the outbox before acknowledgement. |
| Full resync | An expired/invalid cursor returns a resync response. Preserve pending local edits, fetch a fresh snapshot and reconcile against the pending edits before changing the visible library. |
| Artifact upload | Authenticated streaming upload, declared hash and MIME, verified actual hash/size/content, owner-scoped metadata and immutable bytes. A temporary upload becomes visible only after verification. Failed/uncommitted uploads expire within 24 hours. |
| Artifact fetch/delete | Authenticated owner-scoped handler; private/no-store responses, nosniff and attachment disposition. No public bucket URLs. Delete metadata only when no owned design references it. |

Bound JSON requests to 2 MiB and artifacts to 32 MiB initially, with explicit errors before allocation and streaming limits during upload. Revisit these operational limits against release qualification. Limits never disable anonymous editing or local export. Reject unknown schema versions without rewriting the local database; migrations run transactionally on a preserved copy and retain the old copy until verification succeeds.

Allowed artifact types are plain text, ANSI text, PNG, GIF and a restricted SVG subset. Validate file signatures, dimensions and resource budgets; reject active SVG elements, scripts, external references, foreignObject, DTDs and entities. Escape filenames. Treat all uploaded bytes as untrusted, including bytes from aski's own client.

## Import, conflicts and deletion

Signing in offers an explicit local import. It does not replace or silently attach the anonymous library. Persist an import session and local-to-remote UUID map before uploading. Retries reuse that map. Deduplicate favorite family/variant keys within the owner; allow equal collection names and preserve separate designs. Equal artifact hashes may reuse an owned artifact. Confirm import results before offering to remove local copies.

For concurrent edits, retain the acknowledged server record and a new local conflict copy with a new UUID and `conflictOf`; let the user choose later. For edit-versus-delete, keep the original tombstone and recover the edit as a new item. Never resurrect a deleted UUID automatically. Collection deletion removes membership records, not the contained designs. Membership changes and their referenced entities are checked in one transaction.

Tombstones remain for 90 days; older clients must perform a full resync. Unreferenced artifact bytes have a 30-day recovery window before garbage collection. Account deletion revokes sessions immediately and removes active account data within 7 days. Encrypted backup retention must be documented before launch and bounded to 30 days for aski; a deletion journal is reapplied before a restored service accepts traffic. Existing fleet backup inclusion must be checked so a longer shared retention policy is not silently inherited.

Logout revokes the session and hides the account cache. Keep an unsent outbox in a subject-bound recovery namespace until that subject returns or the user explicitly discards it. Never merge it into a different account. The user may explicitly copy it into the anonymous library. Clearing browser storage can still lose local work; make that limit clear in the saving interface.

## Scenario review and implementation evidence

The following design review accepts owner-scoped revisions, atomic batches, explicit import and conflict copies as the implementation contract. These are expected results, not tests of a running auth service.

| Scenario | Required result |
| --- | --- |
| A creates a design; B guesses its UUID or hash | B receives 404; no bytes or existence signal. |
| A references B's collection or artifact | Entire mutation batch fails with no partial write. |
| Two devices rename the same item from revision 3 | First reaches revision 4; second retains an explicit conflict copy. |
| One device edits while another deletes | Tombstone remains; unsent edit is recovered under a new UUID. |
| Network drops after a committed mutation | Same request returns the same acknowledgement, without a duplicate. |
| A request UUID is replayed with different content | Reject the replay; preserve original result. |
| Import retries after half the artifacts upload | Stable ID map resumes; account records are not overwritten. |
| Two equally named local/server collections | Preserve both unless the user explicitly combines them. |
| A signs out with pending work; B signs in | B never sees or submits A's cache/outbox. |
| Client returns after tombstone expiry | Preserve its outbox and reconcile against a full snapshot. |
| Two clients redeem one magic link simultaneously | Exactly one session is minted. |
| Mail scanner follows the email link | No consuming GET; deliberate confirmation is still required. |
| Expired link, foreign callback, forged origin or CSRF | No session or mutation; generic actionable failure. |
| Invalid SVG, hash mismatch or oversized upload | Reject it and expire temporary bytes; recipe remains local. |
| Restore includes a deleted account | Apply the deletion journal before opening readiness. |

Implementation PRs must introduce `make test-account` and `make test-storage`, then pass `make check`. Use two isolated test accounts, two independent browser contexts, an isolated database/artifact root and a local capture mailer. Tests must verify token expiry/reuse/races, cookie flags, origin and CSRF failures, the table above, rollback after failed batches, restart/retry, and migration failure without data loss. Browser evidence must cover a real sign-in through captured mail and owner isolation; a mocked session is insufficient. Before production, inspect actual sender verification, delivery, secret ownership, proxy headers and backup retention against [#34](https://github.com/subculture-collective/aski/issues/34).

Primary sources checked: [Better Auth magic links](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/magic-link.mdx), [magic-link implementation](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/magic-link/index.ts), [rate limits](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/rate-limit.mdx). Verify these behaviors against the pinned implementation release rather than assuming a future upgrade preserves them.
