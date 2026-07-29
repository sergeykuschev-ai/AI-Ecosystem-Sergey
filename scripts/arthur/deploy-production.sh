#!/bin/sh
set -eu

COMPOSE_FILE=${ARTHUR_COMPOSE_FILE:-docker/arthur/compose.yml}
N8N_CONTAINER=${N8N_CONTAINER:-n8n}
NETWORK_NAME=${ARTHUR_N8N_NETWORK:-arthur_n8n}
ENV_FILE=${ARTHUR_ENV_FILE:-docker/arthur/.env}

command -v docker >/dev/null 2>&1 || { echo "Docker is required" >&2; exit 1; }
[ -f "$COMPOSE_FILE" ] || { echo "Compose file not found: $COMPOSE_FILE" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Environment file not found: $ENV_FILE" >&2; exit 1; }

docker inspect "$N8N_CONTAINER" >/dev/null 2>&1 || { echo "n8n container not found: $N8N_CONTAINER" >&2; exit 1; }

echo "Starting Arthur Core..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build --wait

echo "Connecting existing n8n container to $NETWORK_NAME..."
docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 || docker network create "$NETWORK_NAME" >/dev/null
if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$N8N_CONTAINER" | grep -q '"'"$NETWORK_NAME"'"'; then
  docker network connect "$NETWORK_NAME" "$N8N_CONTAINER"
fi

echo "Verifying Arthur Core from n8n network..."
docker run --rm --network "$NETWORK_NAME" node:22-alpine node -e "fetch('http://arthur-api:8787/health').then(async r=>{const b=await r.json();if(!r.ok||b.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"

echo "Deployment complete. Arthur Core is internal-only and reachable from n8n as http://arthur-api:8787"
