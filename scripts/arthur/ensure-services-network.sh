#!/bin/sh
set -eu

NETWORK_NAME=${ARTHUR_SERVICES_NETWORK:-arthur_services}

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required" >&2
  exit 1
}

if docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  internal=$(docker network inspect -f '{{.Internal}}' "$NETWORK_NAME")
  driver=$(docker network inspect -f '{{.Driver}}' "$NETWORK_NAME")
  [ "$internal" = "true" ] || {
    echo "Refusing non-internal shared network: $NETWORK_NAME" >&2
    exit 1
  }
  [ "$driver" = "bridge" ] || {
    echo "Refusing non-bridge shared network: $NETWORK_NAME ($driver)" >&2
    exit 1
  }
  echo "Arthur services network already safe: $NETWORK_NAME"
  exit 0
fi

docker network create   --driver bridge   --internal   --label com.sergey.purpose=arthur-services   "$NETWORK_NAME" >/dev/null

internal=$(docker network inspect -f '{{.Internal}}' "$NETWORK_NAME")
driver=$(docker network inspect -f '{{.Driver}}' "$NETWORK_NAME")
[ "$internal" = "true" ] && [ "$driver" = "bridge" ]

echo "Arthur services network created: $NETWORK_NAME"
