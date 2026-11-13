#!/usr/bin/env bash
# aski backup on NUC (docs/runtime-recovery.md). Dumps the database and lists the image files' hashes.
#   backup.sh --local-only  before each release (run by the fleet-deploy receiver as its operator)
#   backup.sh               nightly (aski-backup.timer, as root): also an encrypted restic snapshot on Kvant
# Local dumps and snapshots are kept for 30 days at most, the contract's backup bound.
set -euo pipefail
data=/srv/apps/data/aski
config=/srv/apps/config/aski
backups="$data/backups"
exec 9>"$backups/.lock"
flock -w 600 9
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="$backups/aski-$stamp.dump"
manifest="$backups/aski-$stamp.artifacts.sha256"
docker exec aski-postgres-1 pg_dump -U aski -d aski -Fc --no-owner --no-acl > "$dump.partial"
# A dump that pg_restore cannot list is not kept.
docker exec -i aski-postgres-1 pg_restore --list > /dev/null < "$dump.partial"
mv "$dump.partial" "$dump"
if [[ -d "$data/artifacts/objects" ]]; then
  (cd "$data/artifacts/objects" && find . -type f -printf '%P\0' | sort -z | xargs -0 -r sha256sum) > "$manifest"
else
  : > "$manifest"
fi
if [[ "${1:-}" != --local-only ]]; then
  export RESTIC_PASSWORD_FILE=/etc/nuc-router-backup/restic-password
  repo=sftp:patrick@10.0.0.50:/mnt/data2/backups/nuc/restic
  sftp_args='-i /home/patrick/.ssh/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/root/.ssh/known_hosts'
  restic -r "$repo" -o "sftp.args=$sftp_args" backup --tag aski "$dump" "$manifest" "$data/artifacts" "$config" /srv/deploy/aski/compose.json /srv/deploy/aski/profile.json
  restic -r "$repo" -o "sftp.args=$sftp_args" forget --tag aski --group-by host,tags --keep-daily 30
fi
find "$backups" -maxdepth 1 -type f -name 'aski-*' -mtime +30 -delete
printf 'aski backup %s\n' "$stamp"
