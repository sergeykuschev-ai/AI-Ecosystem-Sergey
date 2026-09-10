# Production health diagnostics runbook

Read-only owner diagnostics for the production stores web site. The diagnostics answer one question first — **is the problem the web layer or upstream Directus?** — and then verify recovery, including after a rollback. Nothing here writes to production, changes infrastructure, or restarts/recreates Directus, Postgres, Caddy, or the web container.

## One command

```bash
cd apps/stores-web
npm run diagnose:production
```

Optional overrides:

```bash
# Check a different origin (staging, temporary domain)
DIAGNOSTICS_BASE_URL=https://staging.example.com npm run diagnose:production

# Also ping Directus directly (anonymous /server/ping; no token needed)
DIAGNOSTICS_BASE_URL=... DIRECTUS_URL=https://cms.amurskmarket.ru npm run diagnose:production
```

The command sends only anonymous GET requests to:

1. the public home page (web reachability);
2. `/api/health` (the web healthcheck contract);
3. every public app-boundary resource `/api/{brands,cities,stores,promotions,categories,vacancies}`, which is exactly how the site reads Directus — so a failure there is Directus failing *through the existing app boundary*;
4. `GET {DIRECTUS_URL}/server/ping` (only when `DIRECTUS_URL` is set; otherwise reported as skipped).

No credentials are read or sent, and no secrets appear in the output.

## Verdicts and exit codes

| Verdict | Exit | Meaning | First suspects |
| --- | --- | --- | --- |
| `OK` | 0 | Web, app boundary, and content all healthy. | — |
| `WEB_DOWN` | 1 | The public origin is unreachable at transport level (DNS, TLS, timeout, or full outage). | Caddy, host, network, container down |
| `WEB_ERROR` | 2 | The site answers, but pages, `/api/health`, or the public app API fail with a non-200 other than the upstream signal. | A recent web deploy (rollback candidate) |
| `DIRECTUS_UPSTREAM` | 3 | The web app is healthy but the app boundary returns `503 UPSTREAM_UNAVAILABLE`, or the direct Directus ping fails. The cause is upstream of the web container: Directus, Postgres, or the private network — **not** the web deploy. | Directus container, Postgres, `DIRECTUS_URL`/token config on the web container |
| `CONTENT_DEGRADED` | 4 | All services answer, but a foundational resource (`brands`, `cities`, `stores`) returns empty data. Availability is fine; content, `active` flags, or Directus read permissions are the suspect. Optional collections (`promotions`, `categories`, `vacancies`) may legitimately be empty and only need a valid response shape. | Directus content state, permissions policy |

A single transient transport failure can report `WEB_DOWN` while the rest of the run succeeds; re-run once before treating it as an outage.

## Incident flow

1. Run `npm run diagnose:production` from the repo. No server access is required for steps 1–3.
2. Read the `VERDICT` line and the per-check `FAIL` details. The exit code equals the verdict (`echo $?`).
3. `WEB_ERROR` right after a deploy → roll back the web container per [`WEB_ONLY_DEPLOY.md`](WEB_ONLY_DEPLOY.md#failure-behavior-and-rollback), then continue below.
4. `DIRECTUS_UPSTREAM` → do not roll back the web deploy; investigate Directus/Postgres on the host (`docker compose -f compose.production.yml ps`, the Directus and Postgres healthchecks described in [`PRODUCTION_DEPLOY.md`](PRODUCTION_DEPLOY.md#healthchecks)).
5. `CONTENT_DEGRADED` → inspect Directus content and the public role's read permissions; the site itself is up.

## Rollback verification

After any rollback (web-only or full stack), verify recovery from the repo in this order:

```bash
cd apps/stores-web
npm run diagnose:production   # expect VERDICT: OK (exit 0)
npm run smoke:production      # full 16-endpoint post-deploy smoke
```

`diagnose:production` is the fast triage (a few endpoints, verdict-classified); `smoke:production` is the full content-marker regression. Both are read-only and safe to run at any time, repeatedly.

## Scope guardrails

- No writes: anonymous GET only, verified by `tests/production-diagnostics.test.ts`.
- No secrets: the CLI never reads or sends tokens; the direct ping uses the anonymous `/server/ping` endpoint.
- No infrastructure changes: this runbook adds nothing to the server, no scheduled jobs, no monitoring vendor, no GitHub workflow.
- The existing `smoke:production` check is unchanged; diagnostics complement it rather than replace it.

Implementation: `scripts/diagnostics/production.ts` (CLI) and `scripts/diagnostics/checks.ts` (pure classification, unit-tested in `tests/production-diagnostics.test.ts`).
