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

**Observed reality:** `C:\AI\AgentControl` has a queue, a periodic
orchestrator, a watchdog, configured projects, role manifests and validation
logic. The existing `enqueue.mjs` accepts
`<project> <agent> <risk> <prompt>`. No working, authenticated
**Telegram -> AgentControl submission/approval/status bridge** was
confirmed in the deployed Telegram source. Do not claim that direct owner
messages are automatically enqueued into the developer workflow.

## Target control/data flow

```text
Owner via Telegram / ChatGPT
  +-- business question or requested action --> Arthur Gateway
  |       +-- deterministic business services + structured DB/API
  |       +-- DeepSeek (fast) / Z.ai GLM (reasoning), with budgets
  |       +-- owner confirmation for purchases/external writes
  |       +-- reply/status/audit
  |
  +-- engineering work --> approved dispatch boundary [TO IMPLEMENT]
          +-- project + permissions + acceptance criteria
          +-- AgentControl queue (Amursk Windows)
          +-- Codex via existing SSH tunnel
          +-- isolated branch/worktree
          +-- Graphify, tests, review, security
          +-- PR + CI + owner approval before deployment
          +-- deploy/status/rollback -> owner
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

P1 — **Next:** build an authenticated one-way *engineering request*
boundary from the owner channel to AgentControl, validating project and
risk/permissions **before** creating tasks. Start with a private,
development-only command or an explicit per-task submission action, not
autonomous deployment. Do not expose Windows queues or run arbitrary shell
commands via Telegram. Provide owner-visible status and result links.
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
- 14 deployed Telegram Gateway routing/budget **mock/unit** tests passed.
- Arthur Core `/health` responded HTTP 200.
- Real paid-provider responses/balances, end-to-end owner dispatch bridge,
  actual production deployment/rollback, backup restoration remain pending
  acceptance checks.

Changes to live production services, 1C data and publishing were not
performed. This document is operational guidance, not proof that unfinished
integration bridges already work.
