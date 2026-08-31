# Production deployment: stores-web (Amursk)

Target host: `stores-web1` (`138.16.155.126`).
Domains: `amurskmarket.ru`, `www.amurskmarket.ru`, `cms.amurskmarket.ru`.

## Architecture

```text
Internet
   |
 80/443
   |
 Caddy (reverse proxy + Let's Encrypt)
   |-- amurskmarket.ru        --> web:3000
   |-- www.amurskmarket.ru    --> 301 -> https://amurskmarket.ru
   +-- cms.amurskmarket.ru    --> directus:8055
           |
           +-- postgres:5432
```

Only Caddy publishes ports `80` and `443`. `web`, `directus`, and `postgres` are reachable only inside the `stores-web` Docker network.

## Files used in production

| File | Purpose |
| --- | --- |
| `/opt/stores-web/app/compose.production.yml` | Production Docker Compose stack |
| `/opt/stores-web/app/Caddyfile` | Caddy reverse-proxy configuration |
| `/opt/stores-web/.env.production` | Production secrets (outside git) |
| `/opt/stores-web/data/postgres` | Persistent PostgreSQL data |
| `/opt/stores-web/data/directus/uploads` | Persistent Directus uploads |
| `/opt/stores-web/data/caddy/data` | Let's Encrypt certificates and state |
| `/opt/stores-web/data/caddy/config` | Caddy runtime configuration |

## Pre-deployment checklist

1. Server has Docker, Docker Compose, UFW (80/443 open) ready.
2. DNS A-records for all three domains point to `138.16.155.126`.
3. `/opt/stores-web/.env.production` is created on the local Mac from the working local `.env` and transferred to the server. **Existing `DIRECTUS_KEY` and `DIRECTUS_SECRET` are preserved and not rotated during the first migration.**
4. Data migration plan is approved (see runbook below).
5. `directus:seed` is **NOT** run without explicit approval.
6. Directus schema, users, roles, policies, and permissions are **not** recreated; they migrate with the PostgreSQL dump.
7. After deployment is verified, remove the accidentally copied `/opt/stores-web/app/.env` and `/opt/stores-web/app/.env.local`.

.env.production creation (Mac, source of truth: local `.env` + `.env.local`)

The production env is created on the local Mac and then transferred to the server. **It is not created from `/opt/stores-web/app/.env`** — that file was transferred accidentally with the archive and may contain stale or local-only values.

Source of truth on Mac:
- `apps/stores-web/.env` — used by the working local Docker Compose stack (PostgreSQL + Directus + web container). Contains `DIRECTUS_KEY`, `DIRECTUS_SECRET`, DB credentials, admin credentials, admin static tokens.
- `apps/stores-web/.env.local` — used by `npm run dev` / Next.js dev server. Contains the working `DIRECTUS_SERVER_TOKEN` (runtime user's static token).

Create `/tmp/stores-web.env.production` locally from the example and fill it with values from both files:

```bash
cd apps/stores-web

# Start from the example
cp .env.production.example /tmp/stores-web.env.production
chmod 600 /tmp/stores-web.env.production

# Public / safe values (no secrets)
sed -i '' 's|^NEXT_PUBLIC_SITE_URL=.*|NEXT_PUBLIC_SITE_URL=https://amurskmarket.ru|' /tmp/stores-web.env.production
sed -i '' 's|^CONTENT_SOURCE=.*|CONTENT_SOURCE=directus|' /tmp/stores-web.env.production
sed -i '' 's|^DIRECTUS_URL=.*|DIRECTUS_URL=http://directus:8055|' /tmp/stores-web.env.production

# Copy secret values from the local working .env without printing them.
# This preserves DIRECTUS_KEY, DIRECTUS_SECRET, admin tokens, DB credentials.
set -a && source .env && set +a
for key in \
  DIRECTUS_KEY DIRECTUS_SECRET \
  DIRECTUS_ADMIN_EMAIL DIRECTUS_ADMIN_PASSWORD \
  DIRECTUS_STATIC_ADMIN_TOKEN DIRECTUS_ADMIN_TOKEN \
  POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD \
  INDEXNOW_KEY INDEXNOW_ENDPOINT; do
  value=$(eval echo "\$$key")
  if [ -n "$value" ]; then
    sed -i '' "s|^${key}=.*|${key}=${value}|" /tmp/stores-web.env.production
  fi
done

# DIRECTUS_SERVER_TOKEN comes from .env.local (runtime user's static token).
set -a && source .env.local && set +a
if [ -n "$DIRECTUS_SERVER_TOKEN" ]; then
  sed -i '' "s|^DIRECTUS_SERVER_TOKEN=.*|DIRECTUS_SERVER_TOKEN=${DIRECTUS_SERVER_TOKEN}|" /tmp/stores-web.env.production
fi
```

Then transfer only this file to the server:

```bash
scp -i ~/.ssh/id_ed25519_arthur /tmp/stores-web.env.production \
  root@138.16.155.126:/opt/stores-web/.env.production

ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 \
  "chmod 600 /opt/stores-web/.env.production"

# Remove the local temp file:
rm -f /tmp/stores-web.env.production
```

Note on `DIRECTUS_ADMIN_PASSWORD`: this env variable is used only by Directus bootstrap on the very first start. After the database is restored from the dump, the actual admin password hash comes from PostgreSQL, so a mismatch between `.env` and the running container's env is not a migration blocker.

## Migration runbook (A–O)

This runbook migrates the existing working local CMS to production without running seed or recreating Directus schema, users, roles, policies, or permissions.

### A. Identify local PostgreSQL container and database

```bash
# Source of truth env
cd apps/stores-web
set -a && source .env && set +a

# Container name from the local working stack
docker ps --filter name=postgres --format '{{.Names}}'

# Expected: stores-web-postgres-1
PG_CONTAINER=stores-web-postgres-1
```

### B. Dump the existing working CMS database

```bash
set -e
cd apps/stores-web
set -a && source .env && set +a

DUMP_FILE="stores-web-local.sql"

docker exec -i "stores-web-postgres-1" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists --create > "$DUMP_FILE"

echo "Dump created: $DUMP_FILE"
ls -lh "$DUMP_FILE"
```

### C. Verify the dump is non-empty and readable

```bash
head -50 "$DUMP_FILE" | grep -E 'CREATE DATABASE|CREATE TABLE|pg_dump' || true
wc -l "$DUMP_FILE"
```

Expected: thousands of lines, contains `CREATE DATABASE` and `CREATE TABLE`.

### D. Count key entities before migration

Using the local Directus API (with `DIRECTUS_ADMIN_TOKEN` from `.env`):

```bash
cd apps/stores-web
set -a && source .env && set +a

for collection in brands cities stores categories bonus_programs faqs actual_items; do
  count=$(curl -s -H "Authorization: Bearer $DIRECTUS_ADMIN_TOKEN" \
    "http://localhost:8055/items/$collection?limit=0&meta=total_count" | \
    python3 -c 'import sys,json; print(json.load(sys.stdin).get("meta",{}).get("total_count","?"))')
  echo "$collection: $count"
done

# Directus system entities
echo "directus_files: $(curl -s -H "Authorization: Bearer $DIRECTUS_ADMIN_TOKEN" \
  'http://localhost:8055/files?limit=0&meta=total_count' | \
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("meta",{}).get("total_count","?"))')"

echo "directus_users: $(curl -s -H "Authorization: Bearer $DIRECTUS_ADMIN_TOKEN" \
  'http://localhost:8055/users?limit=0&meta=total_count' | \
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("meta",{}).get("total_count","?"))')"

echo "directus_roles: $(curl -s -H "Authorization: Bearer $DIRECTUS_ADMIN_TOKEN" \
  'http://localhost:8055/roles?limit=0&meta=total_count' | \
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("meta",{}).get("total_count","?"))')"

echo "directus_policies: $(curl -s -H "Authorization: Bearer $DIRECTUS_ADMIN_TOKEN" \
  'http://localhost:8055/policies?limit=0&meta=total_count' | \
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("meta",{}).get("total_count","?"))')"

echo "directus_permissions: $(curl -s -H "Authorization: Bearer $DIRECTUS_ADMIN_TOKEN" \
  'http://localhost:8055/permissions?limit=0&meta=total_count' | \
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("meta",{}).get("total_count","?"))')"
```

Save these numbers for post-migration verification.

### E. Transfer dump and uploads archive to the server

```bash
set -e
cd apps/stores-web

# Create uploads archive preserving structure
UPLOADS_ARCHIVE="directus-uploads-$(date +%Y%m%d-%H%M%S).tar.gz"
docker run --rm \
  -v stores-web_directus_uploads:/uploads \
  -v "$(pwd):/out" \
  alpine tar czf "/out/$UPLOADS_ARCHIVE" -C /uploads .

# Transfer both artifacts
echo "Dump: $DUMP_FILE"
echo "Uploads: $UPLOADS_ARCHIVE"
scp -i ~/.ssh/id_ed25519_arthur \
  "$DUMP_FILE" "$UPLOADS_ARCHIVE" \
  root@138.16.155.126:/opt/stores-web/backups/
```

### F. Start only production PostgreSQL

```bash
ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 <<'REMOTE'
set -e
cd /opt/stores-web/app

mkdir -p /opt/stores-web/data/postgres \
         /opt/stores-web/data/directus/uploads \
         /opt/stores-web/data/caddy/data \
         /opt/stores-web/data/caddy/config

docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production up -d postgres

# Wait for PostgreSQL to be healthy
sleep 5
docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production ps postgres
REMOTE
```

### G. Restore the dump

```bash
ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 <<'REMOTE'
set -e
cd /opt/stores-web/app
set -a && source /opt/stores-web/.env.production && set +a

DUMP_FILE="/opt/stores-web/backups/migration-$(date +%Y%m%d-%H%M%S)/stores-web-local.sql"
echo "Restoring from: $DUMP_FILE"

docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production \
  exec -T postgres psql -U "$POSTGRES_USER" postgres < "$DUMP_FILE"
REMOTE
```

### H. Verify counts and Directus system tables after restore

```bash
ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 <<'REMOTE'
set -e
cd /opt/stores-web/app
set -a && source /opt/stores-web/.env.production && set +a

echo '--- Table counts ---'
docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production \
  exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY n_live_tup DESC;"
REMOTE
```

Compare with pre-migration counts from step D.

### I. Transfer Directus uploads

```bash
ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 <<'REMOTE'
set -e
cd /opt/stores-web/backups

# Extract preserving the exact file structure
UPLOADS_ARCHIVE=$(ls -t directus-uploads-*.tar.gz | head -1)
echo "Extracting uploads from: $UPLOADS_ARCHIVE"
tar xzf "$UPLOADS_ARCHIVE" -C /opt/stores-web/data/directus/uploads

# Directus image runs as node uid 1000 by default
chown -R 1000:1000 /opt/stores-web/data/directus/uploads
chown -R 999:999 /opt/stores-web/data/postgres

# Sanity check
find /opt/stores-web/data/directus/uploads -type f | wc -l
REMOTE
```

### J. Start Directus

```bash
ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 <<'REMOTE'
set -e
cd /opt/stores-web/app
docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production up -d directus

# Wait for health
for i in {1..30}; do
  if docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production \
       exec -T directus wget --no-verbose --tries=1 --spider http://localhost:8055/server/health 2>/dev/null; then
    echo 'Directus healthy'
    break
  fi
  echo "Waiting for Directus... \$i"
  sleep 5
done
REMOTE
```

### K. Verify /server/health and data access via runtime token

```bash
ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 <<'REMOTE'
set -e
cd /opt/stores-web/app
set -a && source /opt/stores-web/.env.production && set +a

# Health endpoint (internal Docker network)
docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production \
  exec -T directus wget --no-verbose --tries=1 --spider http://localhost:8055/server/health

# Data access via runtime token (inside the Directus container; port 8055 is not published on host)
echo 'Brands via runtime token:'
docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production \
  exec -T directus wget -qO- --header="Authorization: Bearer $DIRECTUS_SERVER_TOKEN" \
  'http://localhost:8055/items/brands?limit=0&meta=total_count' | \
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("meta",{}).get("total_count","?"))'
REMOTE
```

### L. Build and start Next.js

```bash
ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 <<'REMOTE'
set -e
cd /opt/stores-web/app
docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production up -d --build web

# Wait for web health
for i in {1..30}; do
  if docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production \
       exec -T web wget --no-verbose --tries=1 --spider http://localhost:3000/api/health 2>/dev/null; then
    echo 'Web healthy'
    break
  fi
  echo "Waiting for web... \$i"
  sleep 5
done
REMOTE
```

### M. Start Caddy

Caddy is part of the same compose file, so the previous `up -d --build web` step already started it if dependencies were healthy. If it was not started, run:

```bash
ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 <<'REMOTE'
set -e
cd /opt/stores-web/app
docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production up -d caddy
REMOTE
```

Before Caddy obtains certificates, validate its config:

```bash
ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 <<'REMOTE'
set -e
cd /opt/stores-web/app
docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production \
  exec caddy caddy validate --config /etc/caddy/Caddyfile
REMOTE
```

### N. Verify HTTPS and redirects

```bash
# Public site
curl -sI https://amurskmarket.ru | head -5

# www -> non-www redirect
curl -sI http://www.amurskmarket.ru | head -10
curl -sI https://www.amurskmarket.ru | head -10

# CMS
curl -sI https://cms.amurskmarket.ru/server/health | head -5
```

Expected:
- `https://amurskmarket.ru` returns `200`.
- `www.amurskmarket.ru` returns `301` to `https://amurskmarket.ru`.
- `https://cms.amurskmarket.ru/server/health` returns `200`.

### O. Verify host ports

```bash
ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 \
  "ss -tlnp | grep -E ':(3000|8055|5432)' || echo 'OK: ports 3000/8055/5432 are not listening on host'"
```

## Important notes

- `PUBLIC_URL` in production is `https://cms.amurskmarket.ru`.
- `NEXT_PUBLIC_SITE_URL` is `https://amurskmarket.ru` and is baked into the Next.js bundle at build time.
- `DIRECTUS_SERVER_TOKEN` must be the **existing runtime user's static token**, not the admin token.
- `DIRECTUS_ADMIN_TOKEN` and `DIRECTUS_STATIC_ADMIN_TOKEN` must be the **existing admin user's static token**.
- `directus:seed` is **never** run automatically or during migration.
- Directus schema, users, roles, policies, and permissions are **never** recreated; they come from the PostgreSQL dump.
- After the deployment is verified, remove the accidentally copied local env files from the server:
  ```bash
  ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 \
    "rm -f /opt/stores-web/app/.env /opt/stores-web/app/.env.local"
  ```

## Healthchecks

- PostgreSQL: `pg_isready`
- Directus: `GET /server/health`
- Web: `GET /api/health`
- Caddy: implicit; containers start after dependencies are healthy.

## Backup and rollback

Before any destructive operation, a backup is created automatically by the runbook (`pg_dump` and uploads archive).

### Rollback

```bash
ssh -i ~/.ssh/id_ed25519_arthur root@138.16.155.126 <<'REMOTE'
set -e
cd /opt/stores-web/app
docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production down

# Restore PostgreSQL from the dump used for migration (or any earlier backup)
set -a && source /opt/stores-web/.env.production && set +a
DUMP_FILE="/opt/stores-web/backups/migration-YYYYMMDD-HHMMSS/stores-web-local.sql"
docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production up -d postgres
docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production \
  exec -T postgres psql -U "$POSTGRES_USER" postgres < "$DUMP_FILE"

# Re-extract uploads if needed
LATEST_UPLOADS=$(ls -t /opt/stores-web/backups/directus-uploads-*.tar.gz | head -1)
rm -rf /opt/stores-web/data/directus/uploads/*
tar xzf "$LATEST_UPLOADS" -C /opt/stores-web/data/directus/uploads
chown -R 1000:1000 /opt/stores-web/data/directus/uploads
chown -R 999:999 /opt/stores-web/data/postgres

# Restart stack
docker compose -f compose.production.yml --env-file /opt/stores-web/.env.production up -d
REMOTE
```
