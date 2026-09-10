# Web-only production deploy (routine stores-web updates)

This document defines the safe deploy workflow for routine `stores-web` code
updates. It supplements the initial migration runbook in
[`PRODUCTION_DEPLOY.md`](./PRODUCTION_DEPLOY.md), which remains the source of
truth for the one-time data migration. Routine deploys must use the workflow
below, not the migration runbook.

Helper script: [`scripts/deploy/deploy-web.sh`](../scripts/deploy/deploy-web.sh)

## What this workflow does

1. Fetches `origin/main` and archives **only `apps/stores-web`** (`git archive`
   includes tracked files only — no `.env*`, `node_modules`, or local data).
2. Backs up the current remote application code to
   `/opt/stores-web/backups/app-before-deploy-<timestamp>.tar.gz`.
3. Uploads the archive and overlays it onto `/opt/stores-web/app` via a staging
   directory.
4. Validates the compose stack with
   `docker compose --env-file /opt/stores-web/config/.env.production -f compose.production.yml config -q`.
5. Rebuilds and recreates **only the `web` service**:
   `up -d --build --no-deps --force-recreate web`.
6. Waits for the web container healthcheck (`GET /api/health` inside the
   container, up to ~2.5 minutes).
7. Runs the full read-only production smoke-check (`npm run smoke:production`) against the public origin, covering all critical pages, sitemap, robots, Open Graph image, and `/api/health`.

## What this workflow never does

- It never runs `directus:seed` or `directus:schema:apply` on the server.
- It never recreates or restarts `postgres`, `directus`, or `caddy`
  (`--no-deps` restricts compose to the `web` service).
- It never runs `docker compose down`/`down -v` or touches Docker volumes.
- It never writes to `/opt/stores-web/config/.env.production`; the remote step
  aborts if that file or any persistent data directory is missing, and
  re-verifies the env file exists after the code overlay.

Persistent data lives outside the deployed directory by design:

| Path | Protected because |
| --- | --- |
| `/opt/stores-web/config/.env.production` | Outside `/opt/stores-web/app`; only read via `--env-file` |
| `/opt/stores-web/data/postgres` | PostgreSQL data volume bind mount |
| `/opt/stores-web/data/directus/uploads` | Directus uploads bind mount |
| `/opt/stores-web/data/caddy/data`, `/opt/stores-web/data/caddy/config` | Let's Encrypt certificates and Caddy state |

## Prerequisites (one-time, local machine)

1. An SSH config alias for the production host, e.g. in `~/.ssh/config`:

   ```text
   Host stores-web-prod
     HostName <server address>
     User root
     IdentityFile <path to deploy key>
   ```

   No server address, key path, or credential is stored in this repository;
   the script reads the target from `DEPLOY_SSH_TARGET` (default alias
   `stores-web-prod`).
2. Working SSH access (`ssh stores-web-prod true`).
3. Local tools: `git`, `tar`, `ssh`, `scp`, `curl`.

## Usage

```bash
cd apps/stores-web

# Dry-run (default): performs the local fetch + archive, then prints every
# remote command without executing it. Always run this first.
npm run deploy:web:dry-run

# Real deploy. Prompts nothing — review the dry-run output before using it.
npm run deploy:web

# Standalone smoke check against the public origin (no upload, no SSH
# beyond what curl does publicly).
npm run deploy:web:smoke
```

Environment overrides: `DEPLOY_SSH_TARGET`, `DEPLOY_REF` (default
`origin/main`), `DEPLOY_REMOTE_DIR` (default `/opt/stores-web/app`),
`DEPLOY_ENV_FILE` (default `/opt/stores-web/config/.env.production`),
`DEPLOY_PUBLIC_URL` (default `https://amurskmarket.ru`).

## Failure behavior and rollback

- Any failed safety assertion on the server (missing env file, missing data
  directory) aborts before the backup step.
- If the web container does not become healthy, the remote script exits
  non-zero and prints the exact rollback commands:
  1. extract the latest `/opt/stores-web/backups/app-before-deploy-*.tar.gz`
     over `/opt/stores-web/app`;
  2. re-run the web-only compose `up -d --build --no-deps --force-recreate web`
     step.
- If the smoke check fails after a successful container healthcheck, rollback
  is the same two commands; the stack's data services are unaffected
  throughout.
- Before rolling back, run `npm run diagnose:production` to classify the
  failure: a `DIRECTUS_UPSTREAM` or `CONTENT_DEGRADED` verdict means the web
  deploy is not the cause and rolling it back will not help. See
  [`PRODUCTION_HEALTH_RUNBOOK.md`](PRODUCTION_HEALTH_RUNBOOK.md); after any
  rollback, verify with `npm run diagnose:production` (expect `VERDICT: OK`)
  followed by `npm run smoke:production`.

## Scope note

Adding this workflow did not deploy anything to production. The first real
deploy must be executed manually by a maintainer after reviewing a dry-run
output on the current `origin/main`.
