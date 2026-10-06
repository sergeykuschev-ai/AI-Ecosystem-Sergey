# Production Architecture v2

Status: verified against live production on `stores-web1`, `DESKTOP-6NKDIC8`, and the Germany proxy on 2026-10-06.

This document is the current infrastructure source of truth. Older architecture notes describe earlier states or target designs and must not override this verified running-state description.

## 1. Current topology

```text
Internet
  -> stores-web1 Caddy :80/:443
       -> amurskmarket.ru -> Stores Next.js
       -> amurskmarket.ru/api/1c/exchange -> Miska CommerceML receiver
       -> amurskmarket.ru/api/vozdooh-1c/exchange -> VOZDOOH CommerceML receiver
       -> vozdooh27.ru -> VOZDOOH storefront
       -> cms.amurskmarket.ru -> 404 (Directus admin is not public)

Tailscale
  -> stores-web1
       -> Business KPI :3220 (default HTTPS Serve)
       -> Purchasing :3210 (HTTPS Serve :8442)
       -> Directus admin :8055 (HTTPS Serve :8445)
       -> VOZDOOH :3411 (HTTPS Serve :8447)
  -> DESKTOP-6NKDIC8
       -> Postiz (Tailscale Serve root)
       -> OmniRoute / Open WebUI / n8n / retained Temporal stack

stores-web1 internal networks
  -> Stores PostgreSQL
  -> Business KPI PostgreSQL
  -> Arthur PostgreSQL
  -> Arthur Telegram Gateway / proxy / OmniRoute tunnel
  -> VOZDOOH mail relay / commerce worker

Germany proxy
  -> SSH :2222 public (key-only)
  -> tinyproxy 127.0.0.1:443
  -> latest age-encrypted emergency backup

1C production host
  -> exact physical node is not yet inventoried in Tailscale
  -> VOZDOOH CommerceML is active
  -> Miska CommerceML source is currently stale
  -> Business KPI Integration API sender is not yet activated
```

The Ubuntu host `stores-web1` remains the main production application host. Windows `DESKTOP-6NKDIC8` is the AI/automation node, not the source of truth for KPI, Purchasing, Directus, or Arthur business data.

## 2. Live hosts

### stores-web1

- Ubuntu 24.04 LTS, x86_64, KVM.
- About 2 vCPU, 3.8 GiB RAM, 59 GiB root disk.
- Public entry ports are 80/443 through Caddy and SSH 22.
- UFW is active and SSH password authentication is disabled.
- Tailscale is the private owner/admin boundary.
- Heavy local LLM inference must not be added to this host.

### DESKTOP-6NKDIC8

- Windows 10 Pro, Tailscale address `100.78.67.88`.
- Intended role: AI/automation compute and operator tools.
- Retained services include OmniRoute, Open WebUI, n8n, Postiz and the Temporal stack pending dependency/use review.
- Old duplicate Business KPI, Purchasing, Directus and Arthur containers are stopped but retained for rollback. Their volumes are not authoritative production state.
- Tailscale Serve exposes only Postiz on the node root. Old KPI `:13220` and Directus `:8443` routes were removed.

### Germany proxy

- Hostname `n8n-proxy`, SSH `89.125.19.70:2222`.
- UFW default deny incoming; only TCP 2222 is allowed publicly.
- SSH is key-only: password authentication disabled, root allowed only by public key, MaxAuthTries 3.
- XRDP, CUPS and Avahi are disabled.
- tinyproxy listens only on `127.0.0.1:443`.
- The disk is intentionally small; only the latest emergency ciphertext is retained.

## 3. Production services

| Domain | Runtime | Persistent state | Exposure |
| --- | --- | --- | --- |
| Stores website | Docker `app-web-1` | Directus/PostgreSQL | public via Caddy |
| Stores CMS | Docker `app-directus-1` | PostgreSQL + uploads | loopback + Tailscale `:8445`; public CMS returns 404 |
| Stores DB | Docker `app-postgres-1` | `/opt/stores-web/data/postgres` | Docker network only |
| Miska 1C receiver | Docker `app-onec-sync-1` | `/opt/stores-web/data/onec-exchange` | Caddy exchange path only |
| Business KPI | Docker `business-kpi-web-1` | separate PostgreSQL | loopback + Tailscale + internal read API |
| Business KPI DB | Docker `business-kpi-postgres-1` | Docker volume | internal only |
| Purchasing | Docker `miska-purchasing` | `/opt/miska-purchasing/data` + `state` | loopback + Tailscale |
| Arthur Core | Docker `arthur-core-api-1` | Arthur PostgreSQL | internal Docker networks |
| Arthur Telegram | Docker gateway/proxy | Arthur state/config | loopback/internal; active |
| VOZDOOH storefront | `vozdooh-web:f5b9f046` | `/opt/vozdooh/data` | public via Caddy |
| VOZDOOH worker | `vozdooh-worker:f5b9f046` | orders/outboxes under `/opt/vozdooh/data` | internal/outbound |
| VOZDOOH 1C receiver | Docker `vozdooh-onec-exchange` | CommerceML staging | Caddy exchange path only |
| VOZDOOH mail relay | Docker | mail queue/runtime | internal Docker network |
| Instagram publisher | systemd + Node/Python | `/opt/instagram-automation` | outbound only |
| Remote management | Desktop Commander | host filesystem/processes | authenticated remote agent |

The VOZDOOH web and CommerceML receiver join the `stores-web` edge network, allowing the stores Caddy instance to route to them without publishing their application ports publicly.

## 4. Public and private routing

Public Caddy behavior:

- `https://amurskmarket.ru` -> Stores Next.js.
- `/api/1c/exchange*` -> Miska CommerceML receiver.
- `/api/vozdooh-1c/exchange*` -> VOZDOOH CommerceML receiver after URI rewrite.
- `https://vozdooh27.ru` -> VOZDOOH storefront.
- `www.*` -> canonical HTTPS redirects.
- `https://cms.amurskmarket.ru/*` -> 404 by design.

Directus is intentionally private. It binds only `127.0.0.1:8055` and is available to the owner through:

`https://miska-purchasing.tailc31347.ts.net:8445/admin/`

The historical Tailscale hostname `miska-purchasing` is retained because current private URLs depend on it. Rename it only as a planned migration.

Current stores-web1 Tailscale Serve map:

- default HTTPS -> Business KPI `127.0.0.1:3220`;
- `:8442` -> Purchasing `127.0.0.1:3210`;
- `:8445` -> Directus `127.0.0.1:8055`;
- `:8447` -> VOZDOOH `127.0.0.1:3411`.

## 5. Data ownership

Business KPI owns authentication, sessions, permissions, plans, shifts, KPI settings, imports and audit data in its own PostgreSQL schema. Arthur accesses KPI through the read-only service identity `arthur.analytics`; Arthur must not become the KPI source of truth.

Purchasing remains deterministic and file-backed. LLMs may orchestrate or explain but must not silently replace stock, demand, matrix, financial or owner-policy rules.

1C remains the intended authoritative source for commercial facts that are exported into downstream systems. Raw inbound data should be preserved at the integration boundary before adapters transform it.

VOZDOOH production runtime no longer mounts the mutable Git worktree. The deployed web/worker images carry OCI revision metadata from commit `f5b9f04690c6b164f2fd71f3549f7fdc882377a6`. Runtime source branch `ai/kimi-vozdooh-store` is synchronized with origin.

## 6. 1C integration state

### VOZDOOH

VOZDOOH CommerceML is active. `vozdooh-onec-freshness.timer` checks import/offers freshness every five minutes with a 45-minute threshold. On 2026-10-06 the feed was fresh and publishing approximately every 15 minutes.

### Miska

The receiver is healthy, but the source stopped sending CommerceML after 2026-09-23. The last receiver logs show successful authentication/upload/import rather than receiver errors. `stores-onec-freshness.timer` now detects this condition and alerts through Arthur on state transitions. GitHub issue #222 tracks restoration of the source job.

### Business KPI

The new Integration API is deployed and healthy, but no production batch has been received yet: `onec_sync_batches` and `onec_daily_sales` are empty. Existing historical shifts with `source=1c` are legacy imports, not the new API. GitHub issue #223 tracks activation of the production sender.

The exact physical 1C host is not yet inventoried in the current Tailscale topology; do not guess its hostname or IP.

## 7. Automation and health

Systemd owns scheduled production checks. Important current jobs include:

- `stores-public-health.timer` — AmurskMarket DNS/HTTPS/TLS checks;
- `vozdooh-public-health.timer` — VOZDOOH DNS/HTTPS/TLS and `/api/health`;
- `vozdooh-onec-freshness.timer` — VOZDOOH CommerceML freshness;
- `stores-onec-freshness.timer` — Miska CommerceML and Business KPI 1C freshness;
- Purchasing health and restore drills;
- SEO monitoring;
- Instagram publishing;
- local architecture backup and encrypted off-host replication;
- architecture health and disk protection.

Arthur Telegram Gateway is active and used for current business notifications, including VOZDOOH/order flows and operational alerts.

The autonomous Kimi worker timer is currently disabled pending reliable provider connectivity and explicit revalidation. Do not re-enable it merely to clear a health warning; issue #166 remains the gate.

## 8. Git and deployment source of truth

GitHub repository `sergeykuschev-ai/AI-Ecosystem-Sergey` is the source-control authority. Worktrees are development workspaces, not runtime state.

Deployment copies such as `/opt/stores-web/app` and `/opt/miska-purchasing/app` are runtime/build material. Emergency host edits must be backported to Git immediately. Production images should use immutable release tags and embed the Git commit SHA.

Do not treat `/tmp` worktrees, `.next`, generated output or mutable bind-mounted source as source of truth.

## 9. Backup and recovery

`sergey-architecture-backup.timer` creates validated local backups for:

- Stores PostgreSQL;
- Business KPI PostgreSQL;
- Arthur PostgreSQL;
- Directus uploads;
- VOZDOOH non-reconstructable operational state: order requests, mail/Arthur outboxes, staged catalog and freshness/report state;
- critical runtime compose/Caddy files, systemd units and custom health/freshness/backup scripts.

Purchasing has its own backup of business state and run artifacts.

`sergey-offhost-backup.timer` builds an `age`-encrypted bundle before transfer to the Germany proxy, verifies the remote SHA-256 and retains only the latest emergency copy there. A verified bundle was transferred successfully on 2026-10-06.

Dedicated object storage is still required for longer backup history. Germany must remain an emergency latest-copy target, not the long-term archive.

## 10. Security boundaries

- Public business traffic terminates at Caddy on stores-web1.
- Stores, KPI and Arthur databases have no public host ports.
- Directus admin is private through Tailscale.
- Germany exposes only key-only SSH 2222; RDP is disabled.
- Secrets remain outside Git and must not be embedded in image layers, logs or command arguments.
- Windows duplicate business stacks are stopped and must not be restarted without a rollback reason and data comparison.
- The Windows node may provide AI/automation services but must not become the authoritative store for business databases.
- Heavy local model compute belongs on Windows or another dedicated compute node, not stores-web1.

## 11. Known risks and remaining work

- `stores-web1` remains a physical single point of failure.
- The physical 1C production node and its schedules are not yet inventoried.
- Miska CommerceML is stale until issue #222 is resolved.
- Business KPI production 1C push is not started until issue #223 is resolved.
- Germany has limited free disk and is unsuitable for backup history.
- Purchasing remains file-backed.
- Tailscale naming reflects historical setup and must be changed only through a migration preserving private URLs.
- Temporal on Windows is retained until its actual dependency/use is verified; do not stop it blindly.
- The Kimi autonomous worker remains disabled until issue #166 is resolved.
- VOZDOOH returns/customer policy still has owner-input placeholders tracked by the remaining acquiring/compliance task.

## 12. Target direction

1. Restore and inventory the physical 1C source path, then make 1C -> Integration API -> PostgreSQL the explicit ingest flow for KPI and future downstream services.
2. Add dedicated object storage with retained backup history and periodic restore drills.
3. Add a warm restore target for stores-web1 to reduce the physical SPOF.
4. Continue immutable commit -> image -> release deployment and embed revision metadata for every production image.
5. Migrate Purchasing to transactional storage only when multi-user/multi-store concurrency justifies it.
6. Keep Windows focused on AI/automation; remove stopped duplicate business stacks only after an appropriate retention window.
7. Keep Arthur as an orchestration/read boundary, never as the hidden business source of truth.

Any future architecture document that conflicts with this file must explicitly state whether it is a target design or a verified running-state update.
