#!/bin/sh
set -eu
BASE=/var/backups/sergey-architecture
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BASE/stores-web" "$BASE/business-kpi" "$BASE/arthur-core" "$BASE/runtime-config" "$BASE/vozdooh-state"
chmod 700 "$BASE" "$BASE/stores-web" "$BASE/business-kpi" "$BASE/arthur-core" "$BASE/runtime-config" "$BASE/vozdooh-state"

find_container() {
  docker ps --filter "label=com.docker.compose.project=$1" \
    --filter "label=com.docker.compose.service=postgres" \
    --format '{{.Names}}' | head -1
}

backup_db() {
  project=$1; outdir=$2
  container=$(find_container "$project")
  [ -n "$container" ] || { echo "postgres container missing: $project" >&2; exit 1; }
  tmp="$outdir/postgres-$STAMP.dump.tmp"
  final="$outdir/postgres-$STAMP.dump"
  docker exec "$container" sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$tmp"
  [ -s "$tmp" ] || { rm -f "$tmp"; echo "empty dump: $project" >&2; exit 1; }
  docker exec -i "$container" pg_restore -l < "$tmp" >/dev/null || {
    rm -f "$tmp"
    echo "invalid PostgreSQL dump: $project" >&2
    exit 1
  }
  mv "$tmp" "$final"
  chmod 600 "$final"
  echo "$final"
}
backup_db app "$BASE/stores-web"
backup_db business-kpi "$BASE/business-kpi"
backup_db arthur-core "$BASE/arthur-core"

uploads_tmp="$BASE/stores-web/directus-uploads-$STAMP.tar.gz.tmp"
uploads_final="$BASE/stores-web/directus-uploads-$STAMP.tar.gz"
tar -C /opt/stores-web/data/directus -czf "$uploads_tmp" uploads
[ -s "$uploads_tmp" ] || { rm -f "$uploads_tmp"; echo "empty Directus uploads backup" >&2; exit 1; }
tar -tzf "$uploads_tmp" >/dev/null
mv "$uploads_tmp" "$uploads_final"
chmod 600 "$uploads_final"

voz_tmp="$BASE/vozdooh-state/vozdooh-state-$STAMP.tar.gz.tmp"
voz_final="$BASE/vozdooh-state/vozdooh-state-$STAMP.tar.gz"
tar -C /opt/vozdooh/data -czf "$voz_tmp" \
  order-requests \
  email-outbox \
  arthur-notification-outbox \
  catalog-staged.json \
  catalog-staging-report.json \
  onec-freshness.json
[ -s "$voz_tmp" ] || { rm -f "$voz_tmp"; echo "empty VOZDOOH state backup" >&2; exit 1; }
tar -tzf "$voz_tmp" >/dev/null
mv "$voz_tmp" "$voz_final"
chmod 600 "$voz_final"

config_tmp="$BASE/runtime-config/runtime-config-$STAMP.tar.gz.tmp"
config_final="$BASE/runtime-config/runtime-config-$STAMP.tar.gz"
tar -C / -czf "$config_tmp" \
  opt/stores-web/app/Caddyfile \
  opt/stores-web/app/compose.production.yml \
  opt/vozdooh/runtime/compose.yml \
  opt/vozdooh/runtime/current_release_path \
  opt/business-kpi/runtime/compose.production.yml \
  opt/miska-purchasing/runtime/compose.yml \
  opt/stores-web/worktrees/arthur-prod-main-20260918/docker/arthur/compose.yml \
  etc/systemd/system/vozdooh-stage-catalog.service \
  etc/systemd/system/vozdooh-stage-catalog.service.d/price.conf \
  etc/systemd/system/vozdooh-stage-catalog.timer \
  etc/systemd/system/vozdooh-onec-freshness.service \
  etc/systemd/system/vozdooh-onec-freshness.timer \
  etc/systemd/system/stores-onec-freshness.service \
  etc/systemd/system/stores-onec-freshness.timer \
  etc/systemd/system/stores-public-health.service \
  etc/systemd/system/stores-public-health.timer \
  etc/systemd/system/vozdooh-public-health.service \
  etc/systemd/system/vozdooh-public-health.timer \
  usr/local/sbin/stores-public-health \
  usr/local/sbin/vozdooh-public-health \
  usr/local/sbin/vozdooh-onec-freshness \
  usr/local/sbin/stores-onec-freshness \
  usr/local/sbin/sergey-architecture-backup \
  usr/local/sbin/sergey-offhost-backup \
  usr/local/sbin/sergey-architecture-health \
  etc/systemd/system/sergey-architecture-backup.service \
  etc/systemd/system/sergey-architecture-backup.timer \
  etc/systemd/system/sergey-offhost-backup.service \
  etc/systemd/system/sergey-offhost-backup.timer \
  etc/systemd/system/sergey-architecture-health.service \
  etc/systemd/system/sergey-architecture-health.timer \
  etc/systemd/system/sergey-worktree-housekeeping.service \
  etc/systemd/system/sergey-worktree-housekeeping.timer
[ -s "$config_tmp" ] || { rm -f "$config_tmp"; echo "empty runtime config backup" >&2; exit 1; }
tar -tzf "$config_tmp" >/dev/null
mv "$config_tmp" "$config_final"
chmod 600 "$config_final"

# Retention is handled only after verified off-host backup by sergey-storage-housekeeping.
printf '{"checked_at":"%s","status":"ok","stores_web":"%s","business_kpi":"%s","arthur_core":"%s","uploads":"%s","vozdooh_state":"%s","runtime_config":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$(ls -1t "$BASE/stores-web"/postgres-*.dump | head -1)" \
  "$(ls -1t "$BASE/business-kpi"/postgres-*.dump | head -1)" \
  "$(ls -1t "$BASE/arthur-core"/postgres-*.dump | head -1)" \
  "$uploads_final" \
  "$voz_final" \
  "$config_final" > "$BASE/last.json.tmp"
mv "$BASE/last.json.tmp" "$BASE/last.json"
chmod 600 "$BASE/last.json"
