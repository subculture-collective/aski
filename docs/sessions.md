# Sign-in links and sessions

Issue #47 adds link redemption, the session boundary and sign-out to the request service in [sign-in-requests.md](sign-in-requests.md). The policy comes from [account-sync-contract.md](account-sync-contract.md). Passwords and SSO are not part of this work; the account library is described in [account-library.md](account-library.md). Every local workflow works the same whether the visitor is signed in, signed out or the account service is down.

## Redemption

The email opens `/auth/confirm#token=…`. The page reads the token into memory, removes the fragment with `history.replaceState` before rendering, and shows a Continue button. It loads only first-party files and carries `<meta name="referrer" content="no-referrer">`. Nothing is sent until the visitor presses Continue. Continue sends `POST /api/sign-in/confirm` with the JSON body `{"token": …}` from the same origin. On success the page replaces itself with the studio. An invalid, expired or used link drops the token and tells the visitor to request a new link from the studio. A rate-limit or outage message keeps the token so Continue can be retried.

The handler:

- requires the exact configured `Origin`, rejects `Sec-Fetch-Site: cross-site`, requires `application/json` and limits the body to 4 KiB. The same checks now guard every write (`/api/sign-in/request`, `/api/sign-in/confirm`, `/api/sign-out`);
- reserves one attempt in the PostgreSQL limiter before reading the body: 10 attempts per client IP per 10 minutes, shared across instances, with `429` and `Retry-After` when exceeded. The IP comes from the same trusted-proxy rule as requests;
- accepts exactly one field, a 32–128 character alphanumeric token, and calls Better Auth's `magicLinkVerify` server API without a callback URL. Better Auth's GET route is still not mounted;
- maps Better Auth's error redirect (unknown, expired or used token) to `400`, and any other failure to `503`, which the page treats as retryable;
- on success returns a fixed message and forwards only the session `Set-Cookie`. Better Auth's JSON response, which contains the session token, is discarded. There is no redirect and no logging.

The installed Better Auth 1.7.18 source was inspected. `consumeVerificationValue` deletes the hashed verification row with a single `DELETE … WHERE id IN (SELECT … LIMIT 1) RETURNING`, so concurrent redemptions on different service instances cannot both receive the row. Rows past `expiresAt` are deleted and treated as invalid. A redeemed link creates the user on first use, as the magic-link plugin does by default.

## Sessions

The session cookie is `__Secure-better-auth.session_token`: signed, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and host-only (no `Domain`). The signature uses `BETTER_AUTH_SECRET`. Sessions live in the `session` table; the cookie cache is off, so every check reads the database.

`GET /api/session` returns `{"signedIn": false}` or `{"signedIn": true, "email": …, "subject": …}`, where `subject` is the account's user ID. The [account library](account-library.md) uses it to keep one account's records apart from another's in the page. The studio header calls it once on load and shows "Signed in as …" with a Sign out button. A failed call leaves the header in its signed-out state.

Better Auth and the contract disagree on lifetime. Better Auth refreshes a session at most once per `updateAge` (24 hours) by moving its expiry to now plus `expiresIn` (7 days), so an active session never expires. The contract sets a 7-day absolute lifetime with a 24-hour refresh interval. aski keeps Better Auth's 24-hour refresh, which updates `updatedAt` and re-issues the cookie, and then clamps it: the stored expiry becomes the creation time plus 7 days, and the re-issued cookie's `Max-Age` is the remaining lifetime. Better Auth decides when to refresh from the stored expiry, which the clamp pins, so it would refresh on every read after the first day. aski therefore reads the session with refresh disabled and lets Better Auth refresh only when `updatedAt` is at least 24 hours old. A session older than 7 days is revoked and its cookie cleared even if a refresh had moved its expiry. A row past its expiry is deleted by Better Auth.

## Sign-out and revocation

`POST /api/sign-out` takes an empty JSON object under the write checks above. It deletes the database session through Better Auth's `signOut` and clears the session cookies. It never touches IndexedDB or localStorage, so drafts, favorites, collections and saved work stay in the browser. A session deleted from the database by any route is rejected on the next check, and its cookie is cleared.

`server/http.ts` previously copied response headers with `Object.fromEntries`, which keeps only the last `Set-Cookie`. Sign-out sets several, so the adapter now passes every `Set-Cookie` through.

## Tests

`make test-account` adds cases for: one secure host-only session from a valid link with no token in the response; replayed, expired, malformed and extra-field links; eight simultaneous redemptions split across two service instances (exactly one session and one cookie); cross-origin, missing-origin, cross-site, form and GET confirmation attempts that leave the link usable; the 10-per-IP verification limit across instances; sign-out with origin and content-type rejection; revoked and forged sessions; and refresh after 24 hours, no further refresh on the next reads, a second refresh a day later, clamping to the absolute lifetime, and expiry.

`make test-account-ui` adds a browser case in Chromium, Firefox and the phone viewport. It saves a favorite and a collection, requests a link through the real form, reads that link from the capture server, opens it, and checks that the fragment is gone, no token is stored and only the page's origin was contacted. It then presses Continue, checks the cookie flags and that scripts cannot read the cookie, confirms the link fails when reused, signs out, reloads, and checks the favorite and collection are still there. The capture server's `/__test/inbox/link` route returns the newest link for one address; it exists only in the isolated loopback test server.

## Production evidence still needed

- The production ingress must serve `/auth/confirm` with a `Referrer-Policy: no-referrer` header and no third-party resources; the page's meta tag is the only control tested here.
- The cookies require HTTPS. Local tests use `http://127.0.0.1`, which Chromium and Firefox treat as secure; WebKit is not covered by the account UI run.
- `PUBLIC_ORIGIN`, `BETTER_AUTH_SECRET`, the trusted proxy CIDRs and the forwarded client address must be checked against the deployed ingress.
- The contract's limits for authenticated reads (300 per session per minute) and writes (120 per owner per minute) apply to the sync API and are not implemented here. Account deletion, which must revoke every session, is also later work.
