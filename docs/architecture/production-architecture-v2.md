# Production Architecture v2

Status: verified against live `stores-web1` on 2026-10-06 after VOZDOOH, KPI, Arthur Telegram, 1C routing, and production-runtime hardening.

This document is the current infrastructure source of truth. Older Arthur documents describe the intended architecture and may not reflect the running system.

## 1. Current topology

```text
Internet -> Caddy -> AmurskMarket Next.js / Directus -> Stores PostgreSQL
                  -> VOZDOOH Next.js -> Ozon acquiring / Ozon Delivery
                  -> isolated CommerceML receivers for Stores and VOZDOOH
Tailscale -> Business KPI -> Business KPI PostgreSQL
          -> Purchasing -> file-backed purchasing state
Business KPI web -> arthur_services (internal-only read API; arthur.analytics)
VOZDOOH commerce worker -> Arthur Telegram Gateway -> owner Telegram
Arthur Core API -> Arthur PostgreSQL (internal-only; no host port)
Arthur -> OmniRoute tunnel -> DESKTOP-6NKDIC8
systemd -> health / SEO / 1C freshness / Instagram / local + encrypted off-host backups
GitHub -> development worktrees -> validated immutable production releases
```

The Ubuntu host `stores-web1` is currently the main production application host. The Mac is not required for normal operation of the deployed website, purchasing service, KPI portal, SEO monitoring, or Instagram publisher.

## 2. Live host

- OS: Ubuntu 24.04 LTS, x86_64.
- Capacity observed: 2 vCPU, about 3.8 GiB RAM, 59 GiB root disk.
- Public entry ports: 80/443 through Caddy and SSH on 22.
- Tailscale is the private-access boundary for owner applications.
- Heavy local LLM inference must not be added to this host; use a separate compute node.
## 3. Production services

| Domain | Runtime | Persistent state | Exposure |
| --- | --- | --- | --- |
| Stores website | Docker `app-web-1` | Directus/PostgreSQL | public via Caddy |
| Stores CMS | Docker `app-directus-1` | PostgreSQL + uploads | public via Caddy |
| Stores DB | Docker `app-postgres-1` | `/opt/stores-web/data/postgres` | Docker network only |
| Business KPI | Docker `business-kpi-web-1` | separate PostgreSQL | loopback + Tailscale + internal `arthur_services` read API |
| Business KPI DB | Docker `business-kpi-postgres-1` | Docker volume | internal network only |
| Purchasing | Docker `miska-purchasing` | `/opt/miska-purchasing/data` + `state` | loopback + Tailscale |
| VOZDOOH storefront | Docker `vozdooh-web-domain` | staged 1C catalog + order files | public via Caddy |
| VOZDOOH commerce worker | Docker `vozdooh-commerce-worker` | order/email/Arthur outboxes | outbound Ozon + internal Arthur |
| VOZDOOH 1C receiver | Docker `vozdooh-onec-exchange` | `/opt/vozdooh/data/onec-exchange` | Caddy path `/api/vozdooh-1c/exchange` |
| Arthur Telegram Gateway | Docker `arthur-core-telegram-gateway-1` | Arthur PostgreSQL + read-only service integrations | loopback health + outbound Telegram proxy |
| Arthur Core API | Docker `arthur-core-api-1` | Arthur PostgreSQL | Docker networks only; no host port |
| Arthur Core DB | Docker `arthur-core-postgres-1` | Docker volume `arthur-core_arthur_postgres_data` | internal network only |
| Instagram publisher | systemd + Node/Python | `/opt/instagram-automation` | outbound only |
| Remote management | Desktop Commander | host filesystem/processes | authenticated remote agent |

Website and CMS use the external Docker network `stores-web`. Business KPI has independent internal/edge networks and must not share its database with other domains. Its web container additionally joins `arthur_services`, an internal bridge used only for the read-only service API. Business KPI PostgreSQL, Arthur PostgreSQL, and Arthur Core API are explicitly forbidden from joining that shared service network.

## 4. Public website flow

```text
browser/crawler -> HTTPS Caddy -> Next.js -> Directus HTTP -> PostgreSQL
```

Only Caddy publishes the website stack to the host. Next.js, Directus database access, and PostgreSQL stay inside Docker networks. Next.js is the application/BFF boundary; clients must not depend directly on Directus response contracts.

Canonical runtime files are under `/opt/stores-web/app`, persistent data under `/opt/stores-web/data`, and production secrets under `/opt/stores-web/config` outside Git.
## 5. Owner applications

Business KPI listens on host loopback port 3220 and Purchasing on 3210. Tailscale Serve provides the remote HTTPS boundary. These ports must not be published on the public interface.

Business KPI owns authentication, sessions, CSRF, permissions, plans, shifts, seller tasks, KPI settings, imports, and audit data in its own PostgreSQL schema. The production service identity `arthur.analytics` is configured separately from owner sessions and is read-only: it can read dashboard/KPI data but cannot create, update, archive, import, or change plans/settings. The private alias is `business-kpi-api` on `arthur_services`; the existing host listener remains loopback-only on 3220.

Purchasing is currently file-backed. Its canonical persistent trees are:

- `/opt/miska-purchasing/data` for business policy and learned owner state;
- `/opt/miska-purchasing/state` for run artifacts;
- `/opt/miska-purchasing/inbox` for read-only input files;
- `/opt/miska-purchasing/final-orders` for final exports.

Purchasing must remain deterministic at the calculation boundary. LLMs may assist with orchestration or explanation but may not silently replace stock, demand, matrix, financial, or owner-policy rules.

## 6. Automation plane

Production schedules are owned by systemd timers or an explicitly documented scheduler. Current systemd jobs include website health, SEO monitoring, purchasing health, Instagram queue processing, local architecture backups, encrypted off-host backup replication, architecture health, and the isolated Kimi code worker.

The Instagram path is intentionally separate from business calculations:

```text
queue -> Yandex Object Storage signed URL -> Instagram MCP -> localhost proxy
      -> SSH tunnel to Germany -> Instagram API path
```
## 7. Git and deployment source of truth

GitHub repository `sergeykuschev-ai/AI-Ecosystem-Sergey` is the source-control authority. Worktrees are development workspaces, not runtime state.

Deployment copies such as `/opt/stores-web/app`, `/opt/miska-purchasing/app`, `/opt/business-kpi/runtime`, and `/opt/vozdooh/releases/<release-id>` are runtime/build material. VOZDOOH production must run from an immutable release snapshot, never directly from a Kimi/Codex working tree. Business KPI production uses the canonical `/opt/business-kpi/runtime/compose.production.yml` with a pinned application image. Changes must originate in Git, pass validation, then be deployed. Emergency host edits must be backported to Git immediately.

Do not treat `/tmp` worktrees, `.next`, container images, or generated output as source of truth. Before deleting any worktree, verify both Git status and whether its branch contains commits not present upstream.

## 8. Backup policy

Daily host backups are executed by `sergey-architecture-backup.timer`. They include:

- Stores PostgreSQL custom-format dump;
- Business KPI PostgreSQL custom-format dump;
- Arthur Core PostgreSQL custom-format dump;
- Directus uploads archive;
- validated non-secret runtime configuration archive containing canonical Compose/Caddy/systemd files.

Purchasing has its own daily backup of `data`, `state`, and `final-orders`. PostgreSQL dumps are validated with `pg_restore -l`; Directus and runtime-config archives are validated with `tar -tzf`. Local automated backup pruning is allowed only after a recent verified off-host backup and currently keeps seven days of normal local history. A controlled Arthur restore drill to a temporary database was completed successfully on 2026-09-18.

An encrypted emergency off-host bundle, format `sergey-offhost-v3`, is created after the local backup window and contains the three PostgreSQL dumps, Directus uploads, Purchasing backup, and runtime-config archive. Encryption with `age` happens before transfer to the separately administered Germany proxy; SHA-256 is verified remotely before publication. The proxy retains only the latest ciphertext copy. Long-term off-host history should use dedicated object storage rather than the proxy disk.

## 9. Arthur and AI workers

Arthur Core is running in production with isolated PostgreSQL and an internal-only API with no published host port. The canonical owner profile `sergey` exists with timezone `Asia/Vladivostok`. The read-only Purchasing and Business KPI integrations are validated against live production data; KPI uses `arthur.analytics` over `arthur_services`. Arthur Telegram Gateway is active and healthy and currently carries owner notifications including KPI/portal events, VOZDOOH order notifications, advertising leads, and infrastructure alerts. OmniRoute reaches `DESKTOP-6NKDIC8` through a dedicated SSH tunnel.

The Kimi worker remains installed as an isolated PR-only systemd worker under `kimiworker`, but its timer is intentionally inactive as of 2026-10-06. The last verified quota decision on 2026-10-02 showed 9.6% weekly Kimi capacity remaining against a protected 10% reserve, after which fallback to Codex failed for issue #203. Do not re-enable the timer merely to clear a health warning; re-enable only when quota and pending work justify it.
## 10. Known boundaries and risks

- `stores-web1` is a physical single point of failure for several logical services.
- Directus administration is publicly reachable through Caddy and requires additional hardening review.
- Remote management currently has root-level host access and must be treated as a privileged management plane.
- Purchasing state is file-backed; migration to a transactional store should be considered before multi-user or multi-store concurrency grows.
- Tailscale naming/ports reflect historical setup and should be normalized only through a planned migration that preserves access.
- The active store peers are currently mapped as Миска = `DESKTOP-TVPRA5M`, Ампер = `DESKTOP-MOTQEMV`, Вентиль = `Kassa1`; architecture health verifies their Tailscale reachability when online.
- `DESKTOP-6NKDIC8` is the verified Arthur/OmniRoute Windows node. It is not confirmed to be the 1C server.
- VOZDOOH source CommerceML must be monitored independently from the generated staged catalog. `vozdooh-onec-freshness.timer` checks actual `import*.xml`/`offers*.xml` age every five minutes and alerts when they exceed 45 minutes.
- CMS administration remains publicly reachable and needs a separate access-hardening decision.
- `stores-web1` currently has limited disk/RAM headroom; local LLM inference must remain off-host.

## 11. Target direction

1. Preserve independent domain services and their deterministic contracts.
2. Add a dedicated long-term object-storage destination and periodic restore drills; keep Germany to one emergency ciphertext copy.
3. Normalize Git deployment flow and retire stale worktrees only after branch verification.
4. Harden management/CMS surfaces without breaking owner access.
5. Keep the autonomous code worker PR-only, quota-guarded and sandboxed.
6. Keep Arthur Core and Telegram Gateway stable while adding integrations incrementally; business systems remain authoritative for their own data.
7. Keep VOZDOOH 1C freshness observable and remove the remaining `INVENTORY_PROVIDER=stub` abstraction only after a verified transactional stock/reservation design.
8. Keep local-model compute on a separate node sized for GPU workloads.

Any future architecture document that conflicts with this file must explicitly state whether it is a target design or a verified running-state update.
