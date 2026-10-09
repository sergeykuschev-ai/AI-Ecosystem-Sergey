#!/usr/bin/env bash
set -euo pipefail
umask 077
base=/opt/stores-web/monitoring/arthur-vozdooh-notifications
mkdir -p "$base/reports"
exec 9>"$base/.lock"
flock -n 9 || exit 0
tmp=$(mktemp "$base/.new.XXXXXXXX")
trap 'rm -f "$tmp"' EXIT
if ! docker exec -i vozdooh-commerce-worker node - < "$base/observer.cjs" > "$tmp"; then
  echo 'VOZDOOH_OUTBOX_OBSERVER_EXEC_FAILED' >&2
  exit 1
fi
node - "$tmp" <<'CHECK'
'use strict';
const fs=require('node:fs');
const o=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(o.schemaVersion!==1||!['ok','attention','not_checked'].includes(o.state))
  process.exit(2);
if(!/^[0-9TZ:.-]{20,30}$/.test(o.checkedAt))
  process.exit(3);
if(o.state==='not_checked')
  process.exit(4);
CHECK
ts=$(date -u +%Y-%m-%dT%H-%M-%SZ)
cp "$tmp" "$base/reports/outbox-$ts.json"
mv -f "$tmp" "$base/status.json"
trap - EXIT
find "$base/reports" -type f -name 'outbox-*.json' -mtime +14 -delete
echo "VOZDOOH_OUTBOX_OBSERVER_OK"
