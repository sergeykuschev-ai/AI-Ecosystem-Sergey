# Live system inventory and agent-tool adoption assessment

> Observed 2026-10-11. **Snapshot, not a deployment specification.** Production
> service health, deployed images, task-scheduler states and Docker ports were
> inspected read-only on the authorized hosts. Source documentation and running
> deployments do not necessarily share the same revision.

## Where work happens

| Node | Actual responsibility | Relevant observations |
|---|---|---|
| Amursk Windows `DESKTOP-6NKDIC8` | Primary AI and business services; 1C integration boundary; Codex, Kimi, Ollama, AgentControl | Docker containers listed below; C: roughly 349.8 GB free |
| `stores-web1` Linux VPS | Public websites, SEO edge, VOZDOOH web/commerce integration, reverse tunnels | 59 GB root volume, roughly 50 GB used / 6.7–6.8 GB free (**89%**) |
| German SSH/proxy endpoint | Existing outbound route for Codex and related traffic | Authorized Windows SSH client forwards `127.0.0.1:8443` to the German proxy; `C:\Arthur\codex-remote.ps1` defines `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` |
| Tailscale | Private reachability between Windows, VPS and other nodes | Live Windows/VPS link confirmed; no new VPN or second tunnel requested |

### Amursk services observed via `docker ps`

| Group | Container(s) | Interpretation / follow-up |
|---|---|---|
| Arthur main stack | `arthur-core-api-1`, `arthur-core-telegram-gateway-1`, `arthur-core-postgres-1` | Running/healthy at inspection; trace actual inbound requests and data owner before changes |
| Arthur second stack | `arthur-local-api`, `arthur-local-postgres`, `arthur-telegram-relay-tunnel` | Also running; **do not delete** until purpose, dependencies and consumers verified |
| Purchasing | `purchasing-web-backend` | Running/healthy, port 3210; keep supplier files, rules and decisions out of new third-party tools |
| Purchasing intake | `minmax-direct-mail-intake`, `minmax-valta-mail-intake`, `minmax-zoograd-mail-intake` | Multiple intake instances; identify source/sink mapping before modifying |
| KPI | `business-kpi-local-web`, `business-kpi-local-postgres` | Running at inspection; confirm which external portal/edge forwards here |
| Agent orchestration | `n8n`, `temporal`, `temporal-ui`, `omniroute`, `open-webui` | Running; OmniRoute is **already installed**, no second routing service |
| Content and social | `stores-cms-directus`, `stores-cms-postgres`, `postiz`, `postiz-postgres`, `postiz-redis` | Running; external publishing still requires owner's approval |
| Support | `temporal-postgresql`, `temporal-elasticsearch`, `temporal-admin-tools` | Running; internal service exposure and retention to review |

Some services do not have Docker healthchecks; “Up” must **not** be read as
application correctness. No restart, deletion or database mutation was made.

### VPS services observed

`vozdooh-web-domain`, `vozdooh-commerce-worker`, `vozdooh-mail-relay`,
`vozdooh-onec-exchange`, `app-onec-sync-1`, `app-web-1`,
`app-directus-1`, `app-postgres-1`, `app-caddy-1`,
`miska-business-kpi-edge`, `arthur-advertising-relay` and several
Arthur reverse tunnels were present. A running OneC exchange container does
**not** prove that all 1C source records, orders, or returns are integrated.

Disk pressure is operational priority P0: do a **read-only** classification of
Docker images, build cache, logs and persistent volumes, then plan a
reversible cleanup. Do not use blind `docker system prune --volumes`.

## Existing engineering automation

- `C:\AI\AgentControl` is already the multi-agent dispatcher with project
  configuration for `arthur`, `business-kpi`, `miska-purchasing`,
  `vozdooh`, `amursk-seo` and agent-control itself.
- Role manifests already cover security auditor, code reviewer, backend,
  DevOps, SEO, purchasing and business operators.
- Windows Task Scheduler has `AI Agent Orchestrator`,
  `Arthur-Codex-Agent-Worker`, `AI Agent Watchdog`,
  `AI_Daily_Backup` (last reported results 0). A zero exit result does
  **not** prove that recovery from backup works.
- The Windows working tree under `C:\AI-Ecosystem\AI-Ecosystem-Sergey`
  contained **191 changed/untracked paths** (59 untracked). Preserve them:
  no hard reset, auto-merge, blanket reformat, or repository-wide rewrite.
- Repository rules in `AGENTS.md` already require reproducible math, isolated
  business logic, explicit approvals, test gates and secret hygiene.
- The authored Arthur module inventory currently lags behind the running
  containers. Reconcile live implementation status with the docs, not vice versa.

## New tools: roles and decisions

| Component | Role in existing architecture | Decision |
|---|---|---|
| Graphify 0.9.81 | Per-module, code-only dependency graph, searchable by Codex/Kimi | **Adopt in isolated engineering workspaces**, manual refresh before complex refactors |
| Agent Skills | Test-driven development, code review, security-hardening checks | **Adopt selected three**, progressive disclosure; do not preload the entire library |
| Ponytail | Reduce duplicated abstractions and unnecessary edits | **Optional, lite or explicit invocation**; never suppress tests, audit and approval rules |
| OmniRoute Claude plugin | Registers the already-running OmniRoute MCP endpoint with Claude Code | **Skip** pending a demonstrated missing Claude-specific workflow; OmniRoute service stays |

These are **developer tools**, not Arthur business skills. They must not directly
execute purchase orders, update the 1C system, deploy websites, or send email
and Instagram content.

### Pilot outputs

- `C:\AI\AgentToolsPilot20261009\AI-Ecosystem-Sergey` is the isolated checkout.
- Purchasing graph from 143 code files had 2463 nodes and 5530 links;
  `graphify query` previously located XLSX functions/tests without a model.
- Additional code graphs are built **locally with `--code-only`** to avoid
  sending confidential docs or assets to external language models.
- Installed local skills are Ponytail, test-driven-development,
  code-review-and-quality and security-and-hardening; Graphify's Codex skill
  is installed in the pilot checkout only.
- No measured token/time/cost improvement from an A/B Codex task yet.
- Prior direct Codex calls returned 403 because they did not use the existing
  tunnel; when testing Codex, preserve the existing proxy environment.
- The code graph is an aid to source review, not an authority for business
  data, supplier policy, contractual states or production architecture.

## Suggested guarded execution path

```text
User / approved engineering request
  -> AgentControl existing queue + project role
  -> isolated checkout or worktree, not production tree
  -> Graphify query (code-only graph) if relevant
  -> Codex/Kimi edit under repository AGENTS.md
  -> unit/integration tests on synthetic fixtures
  -> Agent Skills: code review + security review
  -> optionally Ponytail lite (minimal change)
  -> CI + human-confirmed diff / rollback
  -> authorized deploy (separate process)
  -> health check + audit
```

The opt-in `scripts/devtools/agent-quality-gate.mjs` produces machine-readable
JSON about project code graphs, selected skills and optional tests. It has no
deployment functions. It can later be *called* by AgentControl as one stage
after proper tests; do not attach it as an always-on AgentControl worker or
global Codex hook until integration tests and task-scoped permissions pass.

## Remaining safeguards / acceptance criteria

1. Map live API consumers and databases for both Arthur API stacks and
   KPI/MinMax integrations. Preserve deployments and persistent volumes.
2. Run a backup **restore test** into an isolated target; scheduled task exit
   code 0 is not enough. Check VPS storage growth and alert thresholds.
3. Reconcile Arthur/1C feature status with actual responses and contracts.
4. On a verified Codex-through-tunnel session, compare the same controlled
   task with and without Graphify/skills, record **model, input/output tokens,
   duration, final diff, tests and issues**. Do not promise upstream benchmark gains.
5. Approve only narrow, project-scoped changes. Owner confirmation remains
   mandatory for purchase orders, CRM exports, customer communications,
   publishing, finance, and destructive actions.
6. Keep PR #233 as a reviewable experiment; no promotion to production until
   explicit rollback instructions and test results are attached.
