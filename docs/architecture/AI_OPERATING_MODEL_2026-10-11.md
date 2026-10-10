# AI operating model: business Arthur and engineering AgentControl
Reviewed: 2026-10-11. Owner decision: **Kimi paused**.

## Goal

One owner task -> one responsible execution path -> verified result -> status.
Do **not** create another overarching AI agent or blindly connect all tools to
every source. Separate business operations from engineering changes.

## Two paths, not competing orchestration

### A. Business/owner workflow (Arthur, Telegram)

1. Owner sends a request via Telegram/approved owner-facing channel.
2. Arthur determines intent and permission tier: read/recommend, internal
   task, external write, or irreversible action.
3. Ground answers in operational sources: approved databases, KPI, purchasing,
   mail, customer/order APIs. **No invented latest numbers or orders**.
4. Use direct paid AI routing where deployed: `deepseek-flash` for fast
   language/planning; Z.ai `glm-5.3` for reasoning/code-type synthesis.
   Ollama is a local fallback when configured, never a silent source of
   fabricated business numbers.
5. Sensitive or external actions (orders, publishing, payments, outbound
   messages, business-data changes) wait for owner confirmation. Record
   provenance, costs, result and failures.

**Observed reality:** deployed Telegram Gateway uses `deepseek-glm`,
non-empty mounted key files and an application budget ledger. Main and
secondary Arthur API containers still use `omniroute` aliases. A healthy
container or mocked routing test does not prove end-to-end live model calls.

### B. Engineering workflow (AgentControl, Codex)

1. A scoped development request is classified by project, role, risk and
   explicit acceptance criteria. No production credentials or raw 1C/client
   data in a prompt. Reject vague automatic production modifications.
2. An authorized submitter creates a versioned AgentControl queue entry
   using its existing `enqueue.mjs` or guarded pipeline preflight.
3. AgentControl dispatches the task to **Codex through the existing
   Windows -> German SSH tunnel**. Kimi is paused.
4. Codex works in a dedicated checkout/worktree rather than the dirty live
   repository. Graphify helps identify related code (code-only; no external
   LLM extraction). Selected Agent Skills check TDD, code review and security;
   Ponytail is optional and does not override tests.
5. A task cannot be called finished without machine-verifiable tests,
   validated artifacts, security review and a traceable Git diff/PR.
6. External writes, production deployments and irreversible actions go
   through explicit approval, a documented rollback path and post-deploy
   health checks. A successful Codex exit alone is not proof of deployment.
7. AgentControl records DONE, FAILED, BLOCKED or awaiting approval; its
   results should be surfaced to the owner with links to relevant artifacts.

**Live recheck (2026-10-11):** the deployed Arthur Telegram Gateway
**already implements an owner-authenticated, independent Codex queue**. It
accepts `/codex task arthur <description>` and
`/codex task miska <description>`, plus `/codex list` and
`/codex status <uuid>`. It is guarded by one Telegram owner identity and
stores work on the existing shared Windows host volume
`C:\AI-Ecosystem\local-services\arthur-codex-queue`.
`Arthur-Codex-Agent-Worker` is a scheduled Windows worker using the existing
`127.0.0.1:8443` SSH proxy. On completion it moves jobs to
`needs_review` (not a deployment). Three actual notifications were marked
`delivered`, two `needs_review` jobs and one failed job were observed.
The deployed worker only accepts `arthur` and `miska` candidate paths.

**This is not yet the same queue as AgentControl.** AgentControl has a separate
`C:\AI\AgentControl\queue` with roles, preflight, pipelines and approvals.
Keep exactly one worker responsible for each individual task; do not enqueue
the same owner instruction in both. Do not build a second Telegram intake.
The missing integration is unified status/quality review and eventual
cross-project routing, not the basic owner-to-Codex path.

The Codex workspaces need hardening before broad development: the current
Arthur candidate is not itself a Git checkout, while Miska's candidate
has uncommitted changes. Do not automatically promote code from those
workspaces or assume a completed model turn means tests passed.

A privacy-safe unified status inspector
`scripts/devtools/arthur-agent-bridge-status.mjs` reads both queues but
never displays task contents/owner IDs. It was verified against live queues
on Amursk (4 synthetic tests PASS). The read-only inspector was copied into
`C:\AI\AgentControl\scripts` and **integrated with the existing 15-minute
AgentControl health-check**, with a backup of its original script. The live
health check returned `ok=true` and recorded a `devWork` field (Kimi false,
Codex true, two review jobs, one failed). No new scheduler, service or
public network endpoint was added.

**Regression caveat:** 7/8 deployed Codex-related tests passed in a probe;
the notifier Gateway test currently fails under the full live environment,
although actual notification receipts were delivered. It must be fixed in an
isolated test copy rather than modifying the running Gateway image.

## Target control/data flow

```text
Owner via Telegram / ChatGPT
  +-- business question or requested action --> Arthur Gateway
  |       +-- deterministic business services + structured DB/API
  |       +-- DeepSeek (fast) / Z.ai GLM (reasoning), with budgets
  |       +-- owner confirmation for purchases/external writes
  |       +-- reply/status/audit
  |
  +-- engineering work --> Arthur /codex command [EXISTS: arthur & miska]
          +-- owner auth + shared Codex queue
          +-- scheduled Codex worker through existing SSH tunnel
          +-- needs_review / failed + Telegram notifications
          +-- owner review before any merge or deployment
          |
          +-- other projects --> AgentControl queue [EXISTS, SEPARATE]
                +-- role, risk, preflight and approval contract
                +-- Codex through existing SSH tunnel
                +-- independent tests/PR/owner review
          |
          +-- unified queue health [NOW INSTALLED]
                +-- existing 15-minute AgentControl check
                +-- counts only; no new task dispatcher
```

**Important:** the Telegram business AI router is not the AgentControl
worker router. Codex is a programming worker, not a replacement for paid
Arthur model accounts. OmniRoute remains a separate, already running gateway
until each of its callers and aliases are identified. No additional
OmniRoute Claude plugin is required.

## Priority fixes

P0 — **Completed for this owner decision (2026-10-11):**
`C:\AI\AgentControl\config\config.json` was changed to
`kimi.enabled=false`, leaving `codex.enabled=true`. A local backup
`config.json.before-kimi-pause-20261011.bak` was created. The router
uses `kimi.enabled` for Kimi eligibility; 27 fixture regression cases
passed and the live configuration was re-read. Work queues pending/running/
approval were empty at the time of modification.

P1 — **Next:** strengthen the already deployed owner-approved `/codex`
route. First reconcile deployed Gateway source with version control, isolate
each worker workspace in a clean Git worktree, add verification of actual
test results/changed files before declaring `needs_review`, and ensure
the user can see status and result references. Only after this, map
extra projects into the existing Codex queue or add an authorized
AgentControl bridge. Do not allow arbitrary Windows commands via Telegram.
Keep user-facing Arthur business services separate.

P1 — Reconcile the deployed Telegram `direct_model_router.js` and
`paid_ai_budget.js` with the source tree in version control, and define
which Arthur requests are served by the main API/OmniRoute. Test actual
paid-model responses using harmless probes without exposing keys and check
provider account balances separately from app spend ceilings.

P1 — Promote the opt-in engineering quality gate **only** after validating
that it reads the correct project-scoped Graphify graph, selected skills and
test outputs. No auto-running third-party hooks or remote installs.

P2 — Reconcile overlapping Arthur API/PostgreSQL instances and service
ownership; never delete an instance based on name alone. Verify backup
restoration in an isolated environment.

P2 — Public VPS `stores-web1` at around 89% volume use: classify cache,
images, logs and persistent volumes read-only; plan reversible cleanup with
an explicit rollback/retention check.

## Acceptance examples

- **KPI bug:** user request -> scoped engineering change -> isolated tests,
  KPI calculation reconciliation -> review -> approved deployment -> fresh
  results; no invented real-time store metrics.
- **Miska supplier matrix:** input files and owner-approved pricing rules
  remain protected; coding agent can test calculation logic on synthetic
  fixtures, but may not modify live orders or matrix policy automatically.
- **VOZDOOH Instagram:** AI prepares content in a draft; publishing to the
  official account only after explicit review. Never publish store advertising
  on the owner's personal account.
- **Codex unavailable:** hold developer task and report status; do not
  fail over to Kimi automatically.

## Verification performed

- AgentControl config checked after change: Kimi **false**, Codex **true**.
- 27 local AgentControl fixture regression tests passed.
- 4 unified-status inspector tests passed; live AgentControl health check reported OK after integration.
- 14 deployed Telegram Gateway routing/budget **mock/unit** tests passed.
- Arthur Core `/health` responded HTTP 200.
- Real paid-provider responses/balances, end-to-end owner dispatch bridge,
  actual production deployment/rollback, backup restoration remain pending
  acceptance checks.

Changes to live production services, 1C data and publishing were not
performed. This document is operational guidance, not proof that unfinished
integration bridges already work.
