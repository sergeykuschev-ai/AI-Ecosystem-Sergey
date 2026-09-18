#!/bin/sh
set -eu
BASE=/var/backups/sergey-architecture
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BASE/stores-web" "$BASE/business-kpi" "$BASE/arthur-core"
chmod 700 "$BASE" "$BASE/stores-web" "$BASE/business-kpi" "$BASE/arthur-core"

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

find "$BASE" -type f \( -name 'postgres-*.dump' -o -name 'directus-uploads-*.tar.gz' \) -mtime +14 -delete
printf '{"checked_at":"%s","status":"ok","stores_web":"%s","business_kpi":"%s","arthur_core":"%s","uploads":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$(ls -1t "$BASE/stores-web"/postgres-*.dump | head -1)" \
  "$(ls -1t "$BASE/business-kpi"/postgres-*.dump | head -1)" \
  "$(ls -1t "$BASE/arthur-core"/postgres-*.dump | head -1)" \
  "$uploads_final" > "$BASE/last.json.tmp"
mv "$BASE/last.json.tmp" "$BASE/last.json"
chmod 600 "$BASE/last.json"
