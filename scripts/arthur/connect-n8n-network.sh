#!/usr/bin/env sh
set -eu

N8N_CONTAINER="${N8N_CONTAINER:-n8n}"
ARTHUR_N8N_NETWORK="${ARTHUR_N8N_NETWORK:-arthur_n8n}"

if ! docker inspect "$N8N_CONTAINER" >/dev/null 2>&1; then
  echo "Container '$N8N_CONTAINER' not found" >&2
  exit 1
fi

if ! docker network inspect "$ARTHUR_N8N_NETWORK" >/dev/null 2>&1; then
  echo "Network '$ARTHUR_N8N_NETWORK' not found. Start Arthur Core first." >&2
  exit 1
fi

if docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$N8N_CONTAINER" | grep -Fxq "$ARTHUR_N8N_NETWORK"; then
  echo "Container '$N8N_CONTAINER' is already connected to '$ARTHUR_N8N_NETWORK'."
else
  docker network connect "$ARTHUR_N8N_NETWORK" "$N8N_CONTAINER"
  echo "Connected '$N8N_CONTAINER' to '$ARTHUR_N8N_NETWORK'."
fi

cat <<'EOF'
Arthur Core address from n8n: http://arthur-api:8787
Required n8n environment variable: ARTHUR_API_TOKEN
Workflow file: n8n/workflows/arthur-create-task-webhook.json
EOF
