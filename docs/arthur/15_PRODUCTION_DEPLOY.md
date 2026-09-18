# Arthur Core: production deployment

Status: current production runbook for `stores-web1`, verified 2026-09-18.

## Goal

Deploy Arthur incrementally on the Ubuntu production host without changing the existing website, Business KPI, Purchasing, Instagram, or n8n.

The default deployment is deliberately **Core-only**:

```text
PostgreSQL -> migrations -> Arthur Core API
```

Telegram Gateway is a separate explicit phase. n8n is optional and is not currently running on `stores-web1`.

Arthur Core and PostgreSQL must not publish host ports.

## 1. Preconditions

Do not deploy until all of the following are true:

- integration PR/branch tests are green;
- current production architecture health reports `status=ok`;
- latest host-local architecture backup is fresh;
- latest encrypted off-host emergency backup is fresh;
- the production env file is outside Git and has mode `600` or stricter;
- production secrets are unique values, not placeholders copied from examples.

Current canonical production config path:

```text
/opt/arthur/config/production.env
```

Do not use historical `.env` files under Purchasing deployment copies as Arthur production configuration.

## 2. Production configuration

Create `/opt/arthur/config/production.env` as root and set mode `600`.

Minimum Core values:

```text
ARTHUR_POSTGRES_PASSWORD=<unique-random-secret>
ARTHUR_API_TOKEN=<unique-random-secret>
ARTHUR_OWNER_PROFILE_ID=sergey
ARTHUR_AI_PROVIDER=fake
ARTHUR_MAILBOX_MISKA_YANDEX_ENABLED=false
TELEGRAM_KPI_DAILY_ENABLED=false
TELEGRAM_KPI_WEEKLY_ENABLED=false
TELEGRAM_KPI_ALERTS_ENABLED=false
PURCHASING_RUNS_SOURCE=/opt/miska-purchasing/output/purchasing-web/runs
PURCHASING_RUNS_ROOT=/opt/arthur/output/purchasing-web/runs
```

For the Core-only phase, Telegram values may be present but are not used because the gateway is not started.

Mail, KPI automation and external AI provider access remain disabled until their own controlled activation step.

## 3. Networks

The Compose topology is intentionally split:

- `arthur_internal` — internal-only network for PostgreSQL and Arthur Core;
- `arthur_n8n` — optional shared network for a future existing n8n container;
- `arthur_outbound` — outbound bridge used by Telegram Gateway only.

Arthur Core API must remain reachable only inside Docker networks.

## 4. Migrations

Migrations are applied by the migration runner and tracked in `arthur_migrations`.

Current migration set is discovered dynamically from `data/arthur/migrations/*.up.sql`; tests must not hard-code a fixed migration count.

Rules:

- already applied migrations are skipped by checksum;
- modified applied migration files are rejected;
- each migration runs transactionally;
- partial migration state is rolled back on error;
- manual `psql -f` loops are not a supported production path.

## 5. Phase 1 — Core-only deployment

From the repository revision that passed CI:

```bash
ARTHUR_ENV_FILE=/opt/arthur/config/production.env \
ARTHUR_COMPOSE_PROJECT=arthur-core \
./scripts/arthur/deploy-production.sh
```

Default behavior:

1. validates Docker, Compose and the external env file;
2. refuses group/world-readable env files;
3. validates Compose interpolation;
4. starts only `postgres`, `migrate`, and `api`;
5. waits for Arthur Core health;
6. refuses the deployment if API port `8787` is published on the host;
7. performs an internal `/health` request;
8. does not start Telegram;
9. does not require or connect n8n;
10. does not activate workflows or mutate external systems.

Expected result:

```text
Arthur Core healthy and internal-only.
Telegram gateway not started.
n8n not connected.
```

## 6. Core verification

After deployment verify:

```bash
docker compose -p arthur-core \
  --env-file /opt/arthur/config/production.env \
  -f docker/arthur/compose.yml ps -a
```

Expected:

- PostgreSQL healthy;
- migration container exited `0`;
- API healthy;
- no host mapping for `8787`.

A request without the API token to a `/v1/` route must return `401`.

Creating the canonical `sergey` profile changes production storage and is not part of the deploy script. Perform it only as a separate controlled action after confirming whether the profile already exists.

## 7. Phase 2 — Telegram Gateway

Only after Core is stable and production Telegram identity/token are verified, set the real Telegram variables in the external env file.

Production Telegram egress uses the `telegram-proxy` sidecar:

- the sidecar has no host ports and is attached only to `arthur_outbound`;
- it opens an SSH local forward to the existing Germany tinyproxy;
- the SSH private key and `known_hosts` are mounted as file secrets;
- the Gateway defaults `HTTP_PROXY` and `HTTPS_PROXY` to `http://telegram-proxy:18443`;
- `NO_PROXY` keeps PostgreSQL and Arthur Core traffic inside Docker.

Before starting the Gateway, validate the candidate bot token with Telegram `getMe`. A token returning HTTP/API `401 Unauthorized` must not be deployed.

For read-only Business KPI integration, create/verify the shared internal network and attach the KPI web service before starting the Gateway:

```bash
sh scripts/arthur/ensure-services-network.sh
```

The protected production envs on both sides must contain the same
`arthur.analytics` service key. Arthur production additionally sets:

```text
BUSINESS_KPI_BASE_URL=http://business-kpi-api:3220
BUSINESS_KPI_SERVICE_ID=arthur.analytics
BUSINESS_KPI_DEFAULT_STORE_ID=10000000-0000-4000-8000-000000000001
ARTHUR_SERVICES_NETWORK=arthur_services
```

The service identity is read-only at the Business KPI permission boundary; do not
replace it with an OWNER session or expose the KPI database to Arthur.

Then run:

```bash
ARTHUR_ENV_FILE=/opt/arthur/config/production.env \
ARTHUR_COMPOSE_PROJECT=arthur-core \
ARTHUR_DEPLOY_GATEWAY=true \
./scripts/arthur/deploy-production.sh
```

The script starts the gateway only because `ARTHUR_DEPLOY_GATEWAY=true` was explicitly supplied. Compose starts the healthy `telegram-proxy` dependency first.

Before enabling scheduled KPI actions keep:

```text
TELEGRAM_KPI_DAILY_ENABLED=false
TELEGRAM_KPI_WEEKLY_ENABLED=false
TELEGRAM_KPI_ALERTS_ENABLED=false
```

First Telegram validation should be a harmless read-only message path.

## 8. Optional n8n integration

n8n is **not a prerequisite** for Arthur Core and is currently absent on the verified production host.

Do not install n8n merely to satisfy old documentation.

When a real n8n container is deliberately deployed later, connect it explicitly:

```bash
ARTHUR_ENV_FILE=/opt/arthur/config/production.env \
ARTHUR_COMPOSE_PROJECT=arthur-core \
ARTHUR_CONNECT_N8N=true \
N8N_CONTAINER=n8n \
./scripts/arthur/deploy-production.sh
```

The script then verifies that n8n can reach `http://arthur-api:8787/health`.

Workflow import remains a separate step and the importer leaves workflows disabled by default.

## 9. Rollback

A safe rollback stops user-facing Arthur components without deleting the database volume:

```bash
ARTHUR_ENV_FILE=/opt/arthur/config/production.env \
docker compose -p arthur-core \
  --env-file /opt/arthur/config/production.env \
  -f docker/arthur/compose.yml stop telegram-gateway api
```

Do **not** use `down -v` in a routine rollback.

If a code revision must be rolled back:

1. stop API/Gateway;
2. checkout the previously verified Git revision;
3. rebuild Core with the same external production env;
4. verify migrations/checksums before restarting the gateway.

Database restoration is a separate incident procedure and must use a validated backup.

## 10. Current verified staging result

On 2026-09-18 the same phased script was executed against `arthur-staging` with an isolated env/database:

- PostgreSQL healthy;
- all current migrations applied;
- API healthy;
- `8787` not published;
- unauthenticated `/v1` request returned `401`;
- authenticated profile create/read succeeded;
- audit event was persisted;
- Telegram was not started;
- n8n was not connected.

Production activation must preserve this same sequence.
