#!/bin/sh
set -eu

STATE=/var/backups/sergey-architecture/offhost-last.json
ARCH=/var/backups/sergey-architecture
MISKA=/opt/miska-purchasing/backups

python3 - "$STATE" <<'PY'
import json, sys
from datetime import datetime, timezone
p=sys.argv[1]
data=json.load(open(p))
if data.get("status") != "ok":
    raise SystemExit("off-host status is not ok; refusing local backup cleanup")
stamp=data.get("checked_at","").replace("Z","+00:00")
ts=datetime.fromisoformat(stamp)
age=(datetime.now(timezone.utc)-ts).total_seconds()
if age < 0 or age > 30*3600:
    raise SystemExit(f"off-host confirmation is stale ({age/3600:.1f}h); refusing cleanup")
print(f"verified off-host backup age={age/3600:.1f}h")
PY

echo "Pruning automated local backups older than 7 days..."
find "$ARCH/stores-web" "$ARCH/business-kpi" "$ARCH/arthur-core" "$ARCH/runtime-config" -type f \
  \( -name 'postgres-*.dump' -o -name 'directus-uploads-*.tar.gz' -o -name 'runtime-config-*.tar.gz' \) -mtime +7 -print -delete
find "$MISKA" -maxdepth 1 -type f -name 'miska-purchasing-*.tar.gz' -mtime +7 -print -delete
find "$ARCH/offhost-staging" -mindepth 1 -maxdepth 1 -type d -mtime +1 -print -exec rm -rf {} +
echo "Storage housekeeping complete."
