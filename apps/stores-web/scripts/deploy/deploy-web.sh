#!/usr/bin/env bash
#
# Web-only production deploy for stores-web.
#
# Deploys ONLY the Next.js web code (apps/stores-web) to the production host.
# It never touches PostgreSQL data, Directus uploads, Caddy state, or
# /opt/stores-web/config/.env.production, and it never runs directus:seed,
# schema apply, or any database/schema recreation step.
#
# Usage:
#   scripts/deploy/deploy-web.sh                # dry-run: prints every step, no remote actions
#   scripts/deploy/deploy-web.sh --deploy       # perform the deploy (still safe by design)
#   scripts/deploy/deploy-web.sh --smoke-only   # only run public smoke checks, no upload
#
# Configuration (environment variables, no secrets in this file):
#   DEPLOY_SSH_TARGET   SSH target: a host alias from ~/.ssh/config.
#                       Default: stores-web-prod
#   DEPLOY_REF          Git ref to deploy. Default: origin/main
#   DEPLOY_REMOTE_DIR   Remote application directory. Default: /opt/stores-web/app
#   DEPLOY_ENV_FILE     Remote production env file. Default: /opt/stores-web/config/.env.production
#   DEPLOY_PUBLIC_URL   Public site origin for smoke checks. Default: https://amurskmarket.ru
#
# Forbidden by design (never executed by this script):
#   - npm run directus:seed / directus:schema:apply on the server
#   - docker compose down -v, recreation of postgres/directus/caddy services
#   - any write to /opt/stores-web/config/.env.production or /opt/stores-web/data/**

set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT_PATH")/../../../../"

DEPLOY="${DEPLOY:-0}"
SMOKE_ONLY="${SMOKE_ONLY:-0}"
for arg in "$@"; do
  case "$arg" in
    --deploy) DEPLOY=1 ;;
    --smoke-only) SMOKE_ONLY=1 ;;
    -h|--help)
      sed -n '2,27p' "$SCRIPT_PATH"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (use --deploy, --smoke-only, or --help)" >&2
      exit 2
      ;;
  esac
done

SSH_TARGET="${DEPLOY_SSH_TARGET:-stores-web-prod}"
GIT_REF="${DEPLOY_REF:-origin/main}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/stores-web/app}"
ENV_FILE="${DEPLOY_ENV_FILE:-/opt/stores-web/config/.env.production}"
PUBLIC_URL="${DEPLOY_PUBLIC_URL:-https://amurskmarket.ru}"
COMPOSE_FILE="compose.production.yml"

log() { printf '\n==> %s\n' "$*"; }

smoke_check() {
  log "Full production smoke check: $PUBLIC_URL"
  (
    cd apps/stores-web
    SMOKE_BASE_URL="$PUBLIC_URL" npm run smoke:production
  )
}

if [ "$SMOKE_ONLY" = "1" ]; then
  smoke_check
  exit 0
fi

log "Preflight"
for tool in git tar ssh scp curl npm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing required tool: $tool" >&2; exit 1; }
done
echo "SSH target : $SSH_TARGET (configure Host/User/IdentityFile in ~/.ssh/config)"
echo "Git ref    : $GIT_REF"
echo "Remote dir : $REMOTE_DIR"
echo "Env file   : $ENV_FILE (read-only for this deploy)"
if [ "$DEPLOY" != "1" ]; then
  echo "Mode       : DRY-RUN (pass --deploy to perform remote actions)"
else
  echo "Mode       : DEPLOY"
fi

log "Fetch $GIT_REF and archive apps/stores-web"
git fetch origin main
ARCHIVE="stores-web-deploy-$(date +%Y%m%d-%H%M%S).tar.gz"
# git archive includes only tracked files under apps/stores-web; no .env,
# node_modules, or local data can leak into the archive.
git archive --format=tar.gz --output="/tmp/$ARCHIVE" "$GIT_REF" apps/stores-web
ls -lh "/tmp/$ARCHIVE"

# Remote script: safety assertions, backup, extract, compose validation,
# web-only rebuild, health wait. It intentionally has no seed/schema/DB steps.
read -r -d '' REMOTE_SCRIPT <<REMOTE || true
set -euo pipefail

APP_DIR="$REMOTE_DIR"
ENV_FILE="$ENV_FILE"
BACKUP_DIR="/opt/stores-web/backups"
ARCHIVE="/tmp/$ARCHIVE"
STAGING_DIR="/tmp/stores-web-extract-\$(date +%Y%m%d-%H%M%S)"

echo "-- Safety assertions: config and persistent data must exist and stay untouched"
[ -f "\$ENV_FILE" ] || { echo "ABORT: missing env file \$ENV_FILE"; exit 1; }
for dir in \\
  /opt/stores-web/data/postgres \\
  /opt/stores-web/data/directus/uploads \\
  /opt/stores-web/data/caddy/data \\
  /opt/stores-web/data/caddy/config; do
  [ -d "\$dir" ] || { echo "ABORT: missing persistent data dir \$dir"; exit 1; }
done
case "\$APP_DIR" in
  /opt/stores-web/app) ;;
  *) echo "ABORT: unexpected APP_DIR '\$APP_DIR'"; exit 1 ;;
esac

echo "-- Backup current app code"
STAMP=\$(date +%Y%m%d-%H%M%S)
mkdir -p "\$BACKUP_DIR"
tar czf "\$BACKUP_DIR/app-before-deploy-\$STAMP.tar.gz" -C "\$APP_DIR" .
echo "Backup: \$BACKUP_DIR/app-before-deploy-\$STAMP.tar.gz"

echo "-- Extract new code into staging, then overlay onto \$APP_DIR"
mkdir -p "\$STAGING_DIR"
tar xzf "\$ARCHIVE" -C "\$STAGING_DIR"
cp -a "\$STAGING_DIR/apps/stores-web/." "\$APP_DIR/"
rm -rf "\$STAGING_DIR" "\$ARCHIVE"
# Prove config and data survived the overlay.
[ -f "\$ENV_FILE" ] || { echo "ABORT: env file vanished after extract"; exit 1; }
ls -d /opt/stores-web/data/postgres /opt/stores-web/data/directus/uploads >/dev/null

echo "-- Validate compose configuration (config -q)"
cd "\$APP_DIR"
docker compose --env-file "\$ENV_FILE" -f $COMPOSE_FILE config -q

echo "-- Rebuild and recreate ONLY the web service"
docker compose --env-file "\$ENV_FILE" -f $COMPOSE_FILE \\
  up -d --build --no-deps --force-recreate web

echo "-- Wait for web /api/health"
healthy=0
for i in \$(seq 1 30); do
  if docker compose --env-file "\$ENV_FILE" -f $COMPOSE_FILE \\
       exec -T web wget --no-verbose --tries=1 --spider \\
       http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    healthy=1
    break
  fi
  echo "Waiting for web... \$i/30"
  sleep 5
done
if [ "\$healthy" != "1" ]; then
  echo "ABORT: web container did not become healthy; rollback with:"
  echo "  tar xzf \$BACKUP_DIR/app-before-deploy-\$STAMP.tar.gz -C \$APP_DIR"
  echo "  docker compose --env-file \$ENV_FILE -f $COMPOSE_FILE up -d --build --no-deps --force-recreate web"
  exit 1
fi
docker compose --env-file "\$ENV_FILE" -f $COMPOSE_FILE ps web
echo "Remote deploy steps finished (postgres, directus, caddy untouched)."
REMOTE

log "Upload archive and run remote steps"
if [ "$DEPLOY" != "1" ]; then
  echo "[dry-run] scp /tmp/$ARCHIVE $SSH_TARGET:/tmp/$ARCHIVE"
  echo "[dry-run] ssh $SSH_TARGET 'bash -s' < remote script below:"
  echo "---------------------------------------------------------"
  printf '%s\n' "$REMOTE_SCRIPT"
  echo "---------------------------------------------------------"
  rm -f "/tmp/$ARCHIVE"
  log "Dry-run complete. No remote actions were performed."
  echo "Re-run with --deploy to execute."
  exit 0
fi

scp "/tmp/$ARCHIVE" "$SSH_TARGET:/tmp/$ARCHIVE"
printf '%s\n' "$REMOTE_SCRIPT" | ssh "$SSH_TARGET" bash -s
rm -f "/tmp/$ARCHIVE"

smoke_check

log "Deploy finished"
echo "Rollback if needed: extract the latest /opt/stores-web/backups/app-before-deploy-*.tar.gz over $REMOTE_DIR and re-run the web-only 'up -d --build --no-deps web' step."
