#!/bin/sh
set -eu

COMPOSE_FILE=${ARTHUR_COMPOSE_FILE:-docker/arthur/compose.yml}
ENV_FILE=${ARTHUR_ENV_FILE:-/opt/arthur/config/production.env}
PROJECT=${ARTHUR_COMPOSE_PROJECT:-arthur-core}
DEPLOY_GATEWAY=${ARTHUR_DEPLOY_GATEWAY:-false}
CONNECT_N8N=${ARTHUR_CONNECT_N8N:-false}
N8N_CONTAINER=${N8N_CONTAINER:-n8n}
NETWORK_NAME=${ARTHUR_N8N_NETWORK:-arthur_n8n}
SERVICES_NETWORK=${ARTHUR_SERVICES_NETWORK:-arthur_services}
SERVICES_NETWORK_SCRIPT=${ARTHUR_SERVICES_NETWORK_SCRIPT:-scripts/arthur/ensure-services-network.sh}

command -v docker >/dev/null 2>&1 || { echo "Docker is required" >&2; exit 1; }
[ -f "$COMPOSE_FILE" ] || { echo "Compose file not found: $COMPOSE_FILE" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Environment file not found: $ENV_FILE" >&2; exit 1; }

if find "$ENV_FILE" -perm /077 -print -quit | grep -q .; then
  echo "Refusing insecure Arthur env file permissions; require mode 600 or stricter: $ENV_FILE" >&2
  exit 1
fi

case "$DEPLOY_GATEWAY" in true|false) ;; *) echo "ARTHUR_DEPLOY_GATEWAY must be true or false" >&2; exit 1;; esac
case "$CONNECT_N8N" in true|false) ;; *) echo "ARTHUR_CONNECT_N8N must be true or false" >&2; exit 1;; esac

compose() {
  ARTHUR_ENV_FILE="$ENV_FILE" docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "Validating Arthur Compose configuration..."
compose config >/dev/null

echo "Starting Arthur Core foundation: postgres -> migrations -> api"
compose up -d --build postgres migrate api

API_CONTAINER=$(compose ps -q api)
[ -n "$API_CONTAINER" ] || { echo "Arthur API container was not created" >&2; exit 1; }

i=0
while :; do
  STATUS=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$API_CONTAINER")
  [ "$STATUS" = healthy ] && break
  [ "$STATUS" = exited ] && { docker logs "$API_CONTAINER" >&2 || true; exit 1; }
  i=$((i+1))
  [ "$i" -lt 60 ] || { echo "Arthur API did not become healthy (last=$STATUS)" >&2; docker logs "$API_CONTAINER" >&2 || true; exit 1; }
  sleep 2
done

PORTS=$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$API_CONTAINER")
case "$PORTS" in
  *'"8787/tcp":null'*) ;;
  *) echo "Refusing deploy: Arthur API unexpectedly publishes a host port: $PORTS" >&2; exit 1 ;;
esac

docker exec "$API_CONTAINER" node -e   "fetch('http://127.0.0.1:8787/health').then(async r=>{const b=await r.json();if(!r.ok||b.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"

echo "Arthur Core healthy and internal-only."

if [ "$DEPLOY_GATEWAY" = true ]; then
  [ -f "$SERVICES_NETWORK_SCRIPT" ] || {
    echo "Arthur services network helper not found: $SERVICES_NETWORK_SCRIPT" >&2
    exit 1
  }
  ARTHUR_SERVICES_NETWORK="$SERVICES_NETWORK" sh "$SERVICES_NETWORK_SCRIPT"
  echo "Starting Telegram gateway as an explicit second phase..."
  compose up -d --build telegram-gateway
  GATEWAY_CONTAINER=$(compose ps -q telegram-gateway)
  [ -n "$GATEWAY_CONTAINER" ] || { echo "Telegram gateway container was not created" >&2; exit 1; }

  i=0
  while :; do
    STATUS=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$GATEWAY_CONTAINER")
    [ "$STATUS" = healthy ] && break
    [ "$STATUS" = exited ] && { docker logs "$GATEWAY_CONTAINER" >&2 || true; exit 1; }
    i=$((i+1))
    [ "$i" -lt 60 ] || { echo "Telegram gateway did not become healthy (last=$STATUS)" >&2; docker logs "$GATEWAY_CONTAINER" >&2 || true; exit 1; }
    sleep 2
  done
  echo "Telegram gateway healthy."
else
  echo "Telegram gateway not started (ARTHUR_DEPLOY_GATEWAY=false)."
fi

if [ "$CONNECT_N8N" = true ]; then
  docker inspect "$N8N_CONTAINER" >/dev/null 2>&1 || {
    echo "n8n requested but container not found: $N8N_CONTAINER" >&2
    exit 1
  }
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 || {
    echo "Arthur n8n network not found after Core startup: $NETWORK_NAME" >&2
    exit 1
  }
  if ! docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$N8N_CONTAINER" | grep -Fxq "$NETWORK_NAME"; then
    docker network connect "$NETWORK_NAME" "$N8N_CONTAINER"
  fi
  docker exec "$N8N_CONTAINER" node -e     "fetch('http://arthur-api:8787/health').then(async r=>{const b=await r.json();if(!r.ok||b.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"
  echo "n8n connected and can reach Arthur Core."
else
  echo "n8n not connected (ARTHUR_CONNECT_N8N=false)."
fi

echo "Arthur deploy phase complete. No merge, external workflow activation, or production data mutation was performed by this script."
