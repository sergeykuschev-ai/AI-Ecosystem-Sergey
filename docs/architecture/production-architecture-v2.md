# Production Architecture v2

Status: verified against live `stores-web1` on 2026-09-17.

This document is the current infrastructure source of truth. Older Arthur documents describe the intended architecture and may not reflect the running system.

## 1. Current topology

```text
Internet -> Caddy -> Next.js / Directus -> Stores PostgreSQL
Tailscale -> Business KPI -> Business KPI PostgreSQL
          -> Purchasing -> file-backed purchasing state
systemd -> public health / SEO / Instagram queues / backups
Instagram -> Yandex Object Storage -> Germany SSH proxy -> Instagram MCP
GitHub -> server worktrees / deployment copies
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
| Business KPI | Docker `business-kpi-web-1` | separate PostgreSQL | loopback + Tailscale |
| Business KPI DB | Docker `business-kpi-postgres-1` | Docker volume | internal network only |
| Purchasing | Docker `miska-purchasing` | `/opt/miska-purchasing/data` + `state` | loopback + Tailscale |
| Instagram publisher | systemd + Node/Python | `/opt/instagram-automation` | outbound only |
| Remote management | Desktop Commander | host filesystem/processes | authenticated remote agent |

Website and CMS use the external Docker network `stores-web`. Business KPI has independent internal/edge networks and must not share its database with other domains.

## 4. Public website flow

```text
browser/crawler -> HTTPS Caddy -> Next.js -> Directus HTTP -> PostgreSQL
```

Only Caddy publishes the website stack to the host. Next.js, Directus database access, and PostgreSQL stay inside Docker networks. Next.js is the application/BFF boundary; clients must not depend directly on Directus response contracts.

Canonical runtime files are under `/opt/stores-web/app`, persistent data under `/opt/stores-web/data`, and production secrets under `/opt/stores-web/config` outside Git.
## 5. Owner applications

Business KPI listens on host loopback port 3220 and Purchasing on 3210. Tailscale Serve provides the remote HTTPS boundary. These ports must not be published on the public interface.

Business KPI owns authentication, sessions, CSRF, permissions, plans, shifts, seller tasks, KPI settings, imports, and audit data in its own PostgreSQL schema.

Purchasing is currently file-backed. Its canonical persistent trees are:

- `/opt/miska-purchasing/data` for business policy and learned owner state;
- `/opt/miska-purchasing/state` for run artifacts;
- `/opt/miska-purchasing/inbox` for read-only input files;
- `/opt/miska-purchasing/final-orders` for final exports.

Purchasing must remain deterministic at the calculation boundary. LLMs may assist with orchestration or explanation but may not silently replace stock, demand, matrix, financial, or owner-policy rules.

## 6. Automation plane

Production schedules are owned by systemd timers or an explicitly documented scheduler. Current systemd jobs include website health, SEO monitoring, purchasing health, Instagram queue processing, and architecture backups.

The Instagram path is intentionally separate from business calculations:

```text
queue -> Yandex Object Storage signed URL -> Instagram MCP -> localhost proxy
      -> SSH tunnel to Germany -> Instagram API path
```
## 7. Git and deployment source of truth

GitHub repository `sergeykuschev-ai/AI-Ecosystem-Sergey` is the source-control authority. Worktrees are development workspaces, not runtime state.

Deployment copies such as `/opt/stores-web/app` and `/opt/miska-purchasing/app` are runtime/build material. Changes must originate in Git, pass validation, then be deployed. Emergency host edits must be backported to Git immediately.

Do not treat `/tmp` worktrees, `.next`, container images, or generated output as source of truth. Before deleting any worktree, verify both Git status and whether its branch contains commits not present upstream.

## 8. Backup policy

Daily host backups are executed by `sergey-architecture-backup.timer`. They include:

- Stores PostgreSQL custom-format dump;
- Business KPI PostgreSQL custom-format dump;
- Directus uploads archive.

The current host retention is 14 days. Purchasing has its own daily backup of `data`, `state`, and `final-orders`. Backup success must include archive/dump validation, not only file existence.

Host-local backup protects against application corruption but not total VPS loss. Off-host replication is a required next infrastructure layer.

## 9. Arthur and AI workers

Arthur Core is the target orchestration layer, not yet the running production control plane. Existing services stay independently callable while Arthur is introduced incrementally through explicit APIs/skills.

The Kimi/Codex worker is installed as an isolated systemd service under `kimiworker`, but its timer was disabled at this architecture snapshot. Do not describe it as autonomous production until a controlled validation run passes and the timer is deliberately enabled.
## 10. Known boundaries and risks

- `stores-web1` is a physical single point of failure for several logical services.
- Directus administration is publicly reachable through Caddy and requires additional hardening review.
- Remote management currently has root-level host access and must be treated as a privileged management plane.
- Purchasing state is file-backed; migration to a transactional store should be considered before multi-user or multi-store concurrency grows.
- Tailscale naming/ports reflect historical setup and should be normalized only through a planned migration that preserves access.
- Windows `DESKTOP-6NKDIC8` is reachable by Tailscale, but its internal services are not yet verified in this source of truth.

## 11. Target direction

1. Preserve independent domain services and their deterministic contracts.
2. Add off-host backup replication and restore drills.
3. Normalize Git deployment flow and retire stale worktrees only after branch verification.
4. Harden management/CMS surfaces without breaking owner access.
5. Validate and deliberately enable the autonomous code worker only after a sandboxed dry run.
6. Introduce Arthur Core as orchestration, identity, memory, permissions, audit, and skill routing — not as a duplicate of domain logic.
7. Keep local-model compute on a separate node sized for GPU workloads.

Any future architecture document that conflicts with this file must explicitly state whether it is a target design or a verified running-state update.
