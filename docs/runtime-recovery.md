# Runtime placement and recovery

Decision for [#34](https://github.com/subculture-collective/aski/issues/34), 2026-11-09. Recommend NUC for the application and private persistence, Almaz for the existing ingress boundary, and Kvant for source/build work. Soyuz remains a client. This record and its rehearsal do not provision or deploy aski.

## Current deployment, 2026-11-14

https://aski.subcult.tv serves the studio, the about page and the account API (sign-in, account library and image files). Three containers run on NUC in the Compose project `aski`:

| Service | Container | Image | Networks | Notes |
| --- | --- | --- | --- | --- |
| web | `aski-web-1` | `fleet-deploy/aski/web:<revision>` (`Dockerfile`, default target) | `default` (published `10.0.0.56:3096`), `private` | nginx as UID 101, read-only, `/tmp` tmpfs. Serves the static files and proxies `/api/` to `api:4181`; if the API does not answer, `/api/` returns 503 and the studio hides sign-in. Trusts `X-Forwarded-For` only from Almaz (`10.0.0.200`) and passes the client address to the API as `X-Real-IP`. |
| api | `aski-api-1` | `fleet-deploy/aski/api:<revision>` (`--target api`) | `private`, `egress` | Node 24 as UID 10001, read-only, `/tmp` tmpfs, 512 MiB. Applies migrations at start, then serves `/api/*`; `/api/readyz` checks the database and the file root. Reads `/srv/apps/config/aski/runtime.env`; image files in `/srv/apps/data/aski/artifacts` (mounted at `/data/artifacts`). |
| postgres | `aski-postgres-1` | `postgres:17-alpine` (`sha256:266d3c25…`) | `private` | Data in `/srv/apps/data/aski/postgres`; password from `/srv/apps/config/aski/secrets/postgres_password`. No published port. Not part of releases. |

`private` (`10.252.86.0/28`) is internal; the API trusts `X-Real-IP` only from that subnet. `egress` (`10.252.87.0/28`) lets the API reach Brevo.

| Piece | Where |
| --- | --- |
| Ingress guard | `aski-ingress-guard.service` adds `ASKI-INGRESS` to DOCKER-USER: only Almaz (`10.0.0.200`) reaches port 3096. |
| Edge | Almaz `/opt/server/management/config/caddy/sites/aski.Caddyfile`, imported after Byl's in the main Caddyfile. Request bodies are limited to 34 MB for `/api/*` and 64 KB for everything else. |
| Runtime configuration | `/srv/apps/config/aski/runtime.env` (owner `patrick`, 0600) holds `DATABASE_URL`, `BETTER_AUTH_SECRET`, `PUBLIC_ORIGIN`, `TRUSTED_PROXY_CIDRS`, `BREVO_API_KEY`, `MAIL_FROM_EMAIL` (`noreply@subcult.tv`), `MAIL_FROM_NAME` and `ARTIFACT_ROOT`. The database password and auth secret were generated on NUC. |
| Mail | Brevo transactional API. The key is the one the subcult.tv API on NUC already uses (`/srv/deploy/subcult-tv-api/api.env`); `subcult.tv` is an authenticated Brevo domain. A dedicated aski key, created in the Brevo dashboard, would let this one be revoked separately. |
| Deployer | fleet-deploy receiver `ecc088d` as `patrick`, profile and Compose baseline in `/srv/deploy/aski/`, registration in `/srv/apps/projects/aski/registration.json`. The profile manages `web` and `api`; `postgres` is in the baseline but never redeployed by a release. |
| Releases | `.github/workflows/deploy.yml` on every push to `main`, through the GitHub `production` environment (main only) with `HOMELAB_DEPLOY_KEY`, `HOMELAB_KNOWN_HOSTS` and `DEPLOY_TARGET`. The key, `github-actions:aski:20261113-env`, works only from tailnet addresses and only runs the receiver; rotate it by 2027-02-13. |
| Backups | `/srv/apps/projects/aski/operations/backup.sh` (from `ops/backup.sh`). Before each release the receiver runs it with `--local-only`: a `pg_dump -Fc` that `pg_restore --list` must read, plus a SHA-256 manifest of the image files, in `/srv/apps/data/aski/backups`. `aski-backup.timer` runs it nightly at 04:20 without `--local-only`, adding an encrypted restic snapshot (tag `aski`: dump, manifest, image files, runtime configuration, Compose baseline and profile) to Kvant's `/mnt/data2/backups/nuc/restic`, kept 30 days; the shared NUC job prunes the repository. Local files older than 30 days are deleted. |

A release builds and smoke-tests both images, sends them to the receiver, which accepts them only when their revision is Gitea's current `main` (Kvant mirrors GitHub within minutes), runs the local backup, activates both, checks that the public `/` and `/about/` match the web image's files and that `/api/readyz` and `/api/session` answer, and restores the previous images if any check fails. Each deployment's receipt and exact rollback command are under `/srv/deploy/aski/state/releases/`. A rollback restores images only; migrations only add tables and indexes, so an older API runs against the newer schema.

To withdraw accounts but keep the site, stop `aski-api-1`: `/api/` then answers 503 and the studio hides sign-in. To withdraw the site, remove the aski import from the Almaz Caddyfile and reload Caddy, then stop the containers with the Compose command in a receipt.

To restore the database, start a new PostgreSQL container on an empty directory, `pg_restore` the chosen dump into it, check row counts and the deletion journal, then switch `aski-postgres-1` to that directory. Never restore over the running database.

## Observed inventory

NUC's maintained host briefing identifies the existing application/ingress split and recent off-host backup recovery. Live readback found `/srv/apps/AGENTS.md`, application roots under `/srv/apps/projects/`, Docker Compose 5.7.0, 164 GiB free on `/srv`, and running SUBCULT frontend/API, Node applications and independent PostgreSQL 16/17 containers. The current SUBCULT frontend binds `10.0.0.56:3011`, while the API binds port 3012. Existing container names, images and ports were inspected without reading credentials.

Port 3095 was not listening during this session. Recommend `10.0.0.56:3095` as the future edge-only web bind and `https://aski.subcult.tv` as the public origin. Neither is reserved or published by this PR. Confirm port ownership, DNS, Caddy routing and firewall admission from Almaz immediately before provisioning. Database and artifact services receive no host ports. Do not change existing fleet services to make room.

## Configuration and ownership

Use separate immutable web and Node 24 API images plus a dedicated PostgreSQL 17 database. The web gateway serves the static studio and proxies `/api` on the same public origin; anonymous rendering does not depend on API availability. PostgreSQL has a private internal network. The API has a separate egress network for transactional email, with no published API port.

`ops/compose.release.yml` is a guarded release blueprint. It requires explicit immutable image references and private path settings. It is not a runnable release with placeholder application images. Its syntax was validated using the existing PostgreSQL image as a synthetic value for image fields, without starting any blueprint service. The rehearsal containers use a separate network-free command, not this Compose project.

| Boundary | Planned ownership/path |
| --- | --- |
| Versioned release manifests | `/srv/apps/projects/aski/releases/`; record source SHA, exact image digests, schema compatibility and asset hashes. |
| Active release pointer | `/srv/apps/projects/aski/current`; only the scoped deployment operator switches it. |
| Database bytes | `/srv/apps/data/aski/postgres/`; dedicated database/role, never an existing product database. |
| Private artifact bytes | `/srv/apps/data/aski/artifacts/`; API UID 10001; no static-server mount. |
| Runtime environment | `/srv/apps/config/aski/runtime.env`, root/deployment-operator owned, mode 0600. |
| Database password file | `/srv/apps/config/aski/secrets/postgres_password`, mode 0600, mounted as a Compose secret. |
| Email | Brevo transactional API with a separately provisioned application credential and verified SUBCULT sender; no marketing enrollment. |
| Backup operator | Existing fleet operator; a dedicated aski backup manifest and retention policy must be admitted before launch. |

Required API key names are `BETTER_AUTH_SECRET`, `DATABASE_URL`, `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME`, `PUBLIC_ORIGIN`, `TRUSTED_PROXY_CIDRS` and `ARTIFACT_ROOT`. They are names, not provisioned values. The deployment operator obtains narrowly scoped credentials from the existing private credential store; no key is copied from another application. `PUBLIC_ORIGIN` is exactly `https://aski.subcult.tv`; development and capture-mail tests have separate credentials and origins. Match the session/ownership protocol in [PR #47](https://git.subcult.tv/subculture-collective/aski/pulls/47).

Run web/API containers with no added capabilities, no-new-privileges, read-only root filesystems and explicit temporary directories. Apply the edge-only firewall rule and verify it from an allowed and a denied peer before opening ingress. Confirm that only configured proxy peers can supply client-address headers. Keep secrets, SQL values, sign-in tokens and uploaded artifacts out of logs. Do not print an expanded Compose configuration; use `config --quiet`.

## Build identity, backup and rollback

The future web build exposes a non-secret source/build identity. `/api/healthz` reports process health; `/api/readyz` stays closed until database schema, artifact root and the deletion journal are ready. Compare the live identity to the release manifest and verify an actual anonymous render/copy and authenticated save/read after deployment. HTTP 200 alone is insufficient.

Before a release, quiesce library and artifact mutations, finish or abort uploads, record the schema version, dump the dedicated database with `pg_dump -Fc --no-owner --no-acl`, and snapshot committed artifact bytes plus a SHA-256 manifest. Auth tables and the deletion journal are part of the same backup. Resume writes only after the consistent backup is captured. Encrypt off-host copies through the admitted fleet backup path; the rehearsal below does not prove encryption, off-host transport or credential recovery.

Set aski's backup retention to at most 30 days, and inspect broader fleet includes/excludes so an older shared snapshot does not silently retain these paths longer. Retain unreferenced artifact bytes for 30 days and sync tombstones for 90 days. A recovered account-deletion journal must be applied before readiness; deletion metadata contains only the minimum identifiers needed to prevent restoration of deleted data. Record actual backup identity, completion time, size, manifest hash and verified restore time without secret values.

Restore into isolated storage and a new database first. Verify the dump, row/content checksums, artifact manifests, owner relationships, schema and deletion journal. Restore credentials separately through the credential owner. Never test restoration over the active database or writable artifact root. Production admission requires an independently restored encrypted off-host snapshot, not just the synthetic result here.

Rollback the application by switching to the previous exact image/release manifest after compatibility checks. Never automatically downgrade a migrated database. If the old binary is incompatible, hold writes and choose a forward fix or a separately approved restore of a known consistent snapshot. Backups do not authorize discarding new writes.

## Reproduce the bounded rehearsal

From a checkout on NUC, with the existing Docker image available:

```sh
python3 ops/rehearse_recovery.py --image postgres:17-alpine --output /tmp/aski-recovery-results.json
```

The script resolves the local image ID first. It creates only uniquely named, network-free containers, with no ports or host data mounts, and synthetic PostgreSQL data. It checks Compose syntax, dumps/restores two synthetic owners, verifies a separate artifact hash, rejects corrupted bytes, reapplies a synthetic deletion, and switches a temporary release pointer forward and back. Every recorded container ID is removed in `finally`, and temporary files are scoped to a newly created directory. No image is pulled or production container stopped.

[Recorded results](research/recovery-results.json) used image ID `sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b`. Two rows restored exactly; the synthetic deletion left one; the artifact SHA-256 matched; corruption and rollback checks passed; all rehearsal containers were removed. A startup guard waits for PostgreSQL to become PID 1 as well as accept connections, avoiding the image's temporary initialization server.

The live application, actual auth/mail delivery, DNS/ingress/firewall rules, immutable app images, encrypted off-host recovery and migration compatibility remain release work. The hosting recommendation is ready for provisioning review; none of those production actions occurred in this spike.
