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

## 2026-10-11: guarded operational integration on the Amursk host

**Verified changes actually applied on Windows:**

- `C:\AI\AgentControl\scripts\health-check.mjs` now also reads the
  two engineering queues via the new read-only `arthur-agent-bridge-status.mjs`.
  It runs under the **existing 15-minute scheduled health check**; no new
  scheduler/public endpoint. Original script backed up to
  `health-check.mjs.before-bridge-20261011.bak`.
- Live monitor returned `ok=true`, Codex enabled, Kimi disabled, zero
  pending/running AgentControl work, two Arthur Codex `needs_review` jobs
  and one failed Arthur Codex job. Historical AgentControl completed/failed
  counts are 39/12, not newly failed tasks.
- `node scripts/run-tests.mjs` under `C:\AI\AgentControl`: **133/133 PASS**.
  Read-only bridge inspection: **4/4 PASS** on synthetic fixtures.
- The existing `Arthur-Codex-Agent-Worker` is an authorized scheduled
  Windows worker using the existing German SSH tunnel. **No new queue
  worker was installed.** Production Telegram notifier records for the
  prior three Codex jobs were marked `delivered`.
- In the isolated candidate root
  `C:\AI-Ecosystem\candidates\arthur-codex-integration-20261010`,
  copied the selected Ponytail, three Agent Skills and Graphify skills from
  the reviewed pilot; **no automatic Graphify hooks**.
- The candidate was **out of sync** with the deployed Arthur Telegram
  Gateway. Recovered the deployed gateway module and its support modules,
  the Codex notifier, and the missing `agents/arthur-core` source **from
  the running container into the development candidate only**. Existing
  file backups preserved. No production container/source was overwritten.
- Code-only Graphify incremental graph of the synchronized Arthur-v1
  candidate: **1,674 nodes and 3,546 edges**, queryable locally.
- Isolated Node test dependencies use already-installed Windows packages
  plus `node-cron` and `uuid` read from the running container and copied
  to `C:\AI\DevTools\arthur-worker-deps\node_modules`. The Codex worker
  child-process environment now sets project-scoped `PATH` (Graphify)
  and `NODE_PATH` (test dependencies), while preserving its existing
  SSH-proxy variables. Host-global PATH, Node installation, Docker and
  system-wide Codex profile were not changed.
- **8/8 PASS** on the synchronized candidate:
  `codex_integration.test.js` +
  `codex_notifier_gateway.test.js`, with deterministic test doubles for
  voice and unrelated project alert checks. This verifies synthetic
  command/queue/notify behavior; it does **not** certify future Codex-generated
  diffs or business data actions.

**Remaining engineering work:**

1. The candidate root is **not yet a clean version-controlled release
   checkout**. Create a reviewed, credential-free Git baseline matching the
   deployed release before enabling autonomous cross-project changes. Do not
   silently reset the dirty main repo.
2. The Arthur Codex and AgentControl queues remain separate. They are both
   **observed** by one health check, not a single transaction coordinator.
   Do not dispatch the same job into both queues.
3. A job in `needs_review` is **not** a passed code-quality gate or deployment.
   Add machine-verifiable per-project tests, changed-file review, and
   rollback/approval before any production promotion.
4. Model inference use/cost: DeepSeek Flash + Z.ai GLM configured for the
   deployed Telegram Gateway, with budget caps. The main Arthur API still
   uses OmniRoute. Cross-service unification and provider-balance checks
   remain separate work.
5. Directly retest an **owner-authorized harmless task** end-to-end when
   an appropriate clean workspace exists; the work done in this phase
   tested the real queue read-only plus synthetic Codex gateway fixtures,
   not a new live task execution.

The deliverable is a **working authenticated Arthur Codex front door and a
unified read-only monitoring layer**, not a new autonomous production
deployment system.

## 2026-10-11: clean Git baseline and real Codex smoke test

- Created a **new, isolated local Git worktree** at `C:\AI-Ecosystem\candidates\arthur-codex-git-20261011`, branch `codex/arthur-baseline-20261011`; it was derived from the reviewed experimental Git revision and overlaid with **JavaScript source from the running Arthur Telegram Gateway image**. No secrets, database files, service volumes, `.env` files or backups were imported. Selected project-scoped Graphify/Ponytail/Agent Skills included, with no automatic hooks.
- Staged path allowlist and diff patterns were screened for obvious private keys and tokens; project-scoped Codex regression and paid AI routing/budget tests **22/22 PASS**. Local-only baseline commit **`369139b`** was created; `git status --porcelain` returned **zero changes**. This branch is **not pushed or deployed**.
- A separate disposable Git worktree `C:\AI-Ecosystem\candidates\arthur-codex-smoke-20261011`, branch `codex/arthur-smoke-20261011`, and a separate isolated queue under `C:\AI\AgentToolsPilot20261009` were created for a single **actual Codex CLI run**. A synthetic owner-authenticated Arthur `/codex task arthur` request exercised the real plan/skill/queue code, with no real Telegram message and no business data.
- Codex 0.162.1 used the existing SSH proxy and workspace-write sandbox. It created exactly `docs/experiments/ARTHUR_CODEX_SAFE_SMOKE_20261011.md` with the required two lines. Its queue status became **`needs_review`**, not deployed. The worker portion took **43.257 seconds**. Git reported **one and only one** changed path; exact content check passed; isolated Codex + notifier regression tests **8/8 PASS**. The smoke harness exited **0**.
- The baseline is still clean, and the single smoke-only diff is deliberately left uncommitted for manual review. The existing production Arthur Codex worker still points at its prior approved candidate path; it has **not** been switched to the new baseline. Existing real task IDs and queue records were not changed.

### Next acceptance gate

Do **not** infer that a single synthetic smoke authorizes arbitrary automated software changes. Next, make the scheduled worker create a **fresh Git worktree per user task**, validate the project/path allowlist, capture exact changed files and test results, and hold all merge/deploy actions behind owner approval. Test this worker change in a separate queue before switching the production scheduler; retain rollback to the previous worker path.

Real Telegram delivery and user-visible review of **new** tasks should be tested only through the authenticated owner channel. Existing real queue notifications had previously been marked delivered, but the smoke run intentionally did not send one.

## 2026-10-11: production scheduled worker v2 — authorized rollout

**Actually switched on the Amursk Windows server.** Kept the SAME Windows
scheduled task, user Admin (Limited), existing queue and existing SSH proxy.
Only the scheduled task's Node.js script and working directory were changed.
The original task XML is saved at
\`C:\AI\AgentControl\backups\Arthur-Codex-Agent-Worker.before-v2-20261011.xml\`.
Rollback: restore the original scheduled action from this backup and re-run
the empty-queue smoke. No existing pending/running job was present at switch.

- Versioned, independent, **local-only** Git runtime:
  \`C:\AI-Ecosystem\local-services\arthur-codex-runtime-v2\`,
  revision \`6b9677c\`. No configured git remotes, clean worktree.
- Clean pinned **Arthur** source baseline:
  \`C:\AI-Ecosystem\candidates\arthur-codex-stable-baseline-20261011\`,
  deployed-source snapshot revision \`369139b\`, detached clean worktree.
- Scheduled command:
  \`C:\Program Files\nodejs\node.exe\` with
  \`C:\AI-Ecosystem\local-services\arthur-codex-runtime-v2\scripts\arthur\codex-worker\worker-v2.js\`.
- For each **new Arthur job**, worktree runner creates
  \`C:\AI-Ecosystem\candidates\arthur-codex-task-worktrees\<uuid>\`
  on branch \`codex/task-<uuid>\`; never reuses an old task directory.
  It runs Codex via the existing tunnel, checks Git HEAD/branch and changed
  file allowlist, runs the allowlisted synthetic regression tests and saves
  one JSON review report under
  \`C:\AI-Ecosystem\local-services\arthur-codex-queue\reviews\<uuid>.json\`.
  Only a passing task becomes \`needs_review\`; nothing is merged, pushed,
  deployed or automatically approved.
- **Miska** stays on its *existing* legacy worker behavior in the same
  scheduler/queue while its 47 uncommitted candidate paths remain
  unreviewed. Do not discard or auto-commit those changes.
- Old real Codex jobs preserved unchanged: two \`needs_review\` and one
  \`failed\`. Original production main repo's 191 changed paths untouched.
- Security unit tests of the new Git review mechanism: **5/5 PASS**.
  Arthur integrations/model routing/budget synthetic tests: **22/22 PASS**.
  Actual Codex-over-tunnel isolated v2 E2E smoke: ~45.4 seconds, exact
  one-file diff, **8/8 regression PASS**, manual review state, no deployment.
- After changing the scheduled action, an explicit Windows Task Scheduler
  empty-queue run returned **LastTaskResult=0**. Principal and run level
  remained unchanged. Docker containers were not restarted and remain
  healthy on inspection.

**Remaining limitations:** a live owner Telegram submission through the
*new scheduled* worker has not yet been exercised; the E2E intake test used
a synthetic owner/channel and a separate queue. Miska has not yet migrated
to per-task worktrees; do not claim the whole system is unified.


## 2026-10-11: Miska Git isolation — quarantine, not promotion

This is the result of the follow-on purchasing workflow audit. **The active
Amursk purchasing containers, 1C, supplier matrices, inventory, prices and
orders were not changed.** The scheduled Arthur/Codex worker remains v2:
new Arthur jobs use per-task Git worktrees; **Miska still uses its earlier
legacy candidate path**, deliberately.

- Source \`C:\AI-Ecosystem\candidates\codex-miska-amursk-20261009\repo\`
  had **51** changed or untracked files when expanded recursively, including
  a private SKU reference folder. All 51 paths were captured in a **local
  SHA-256 manifest**, with originals left untouched.
- Copied **43 JS code/test files** to a *separate local Git repository with
  no remotes*. Excluded the other 8 handoff/reference/sku files. Normalized
  line endings only in the copied code, reducing noisy tracked diff to about
  **801 added / 111 removed lines**.
- Local quarantine checkpoint \`a1164ce\` on
  \`codex/miska-review-20261011\`: never published or deployed.
- Synthetic critical tests: **171/171 PASS**. Full 110-file suite:
  **1,784/1,800 PASS; 14 FAIL**. For comparison, the same four affected
  suites on clean parent revision \`c4524b5\` had **35 failing** of 124.
- Codex CLI via existing tunnel was assigned a strictly test-only repair
  in a disposable branch, but the 240-second run **timed out**. It was
  **not accepted**: its in-memory synthetic Min/Max workbook failed the real
  required-SKU guard and broke test fixture initialization.
- Manually isolated **two safe test-file corrections** from that attempt
  into a different local-only branch:
  \`codex/miska-safe-tests-20261011\`, commit \`8153b0b\`. These assert
  **manual review for unmatched products** and update UI tests for current
  unified export controls and CRLF/LF parsing. The browser-side fflate
  UMD package was installed into ignored, test-only \`node_modules\` for the
  isolated run; do not infer the bundle is committed.
- Full recheck of this safe review-only branch:
  **1,789/1,800 PASS; 9 FAIL**. Remaining **8** are obsolete positive
  Supplier XLSX/Final Order tests expecting export of a synthetic Valta
  report that lacks mandatory Min/Max SKU data (HTTP 409 is the safety
  guard). Remaining **1** is a legacy HTML test expecting now-absent
  vendor-specific IDs. Do **not** disable the guard or remove assertions to
  force a green summary.
- Current production worker state stayed healthy; 2 historical Arthur
  \`needs_review\` tasks + 1 failed remained unchanged, no pending Miska
  task was touched. AgentControl \`kimi.enabled=false\`,
  \`codex.enabled=true\`.

**Next gates:** construct a genuinely complete, fully synthetic Valta
Min/Max fixture for the positive XLSX tests, retain negative 409 coverage;
reconcile UI test selectors with the approved current frontend contract;
install development dependencies reproducibly; repeat full tests. Only
then create a release-qualified clean Miska Git baseline and test a
per-task worktree worker *before* changing live routing. No auto-deploy,
auto-order, source reset or data mutation is authorized by this checkpoint.


## Arthur and Miska v3 scheduled worker enabled — 2026-10-11

**Actually switched on the Amursk Windows host, following complete tests.**
The existing \`Arthur-Codex-Agent-Worker\` Windows task (principal Admin,
Limited, one original trigger, same Node.js executable) now runs:

\`C:\AI-Ecosystem\local-services\arthur-codex-runtime-v3\scripts\arthur\codex-worker\worker-v3.js\`

No second queue, daemon, tunnel, VPN, Git remote, automated merge or auto-deploy
was created. The original task definition/action from working v2 is backed
up at \`C:\AI\AgentControl\backups\Arthur-Codex-Agent-Worker.before-miska-v3-20261011.xml\`
with SHA-256
\`90E71AA5685E80C8E4106D71F47783DDF1F80B7493973F2A2D872A43D4051519\`.
After switching, an explicit Windows Task Scheduler empty-queue invocation
returned **LastTaskResult=0**, State **Ready**, same principal/triggers.

### Miska bug fix and regression acceptance

- Real SmartZapas adapter emits \`priceNum\`, while a recent mandatory SKU
  Min/Max guard had checked \`price\`: this could falsely block legitimate
  supplier-order downloads. Fixed **only in isolated candidate**: still
  checks explicit finite nonnegative \`freeStock\` and \`priceNum\`, including
  missing/duplicated products.
- Rebuilt only synthetic positive XLSX fixtures with all six required Valta
  items inserted **before** the report total and with unique synthetic IDs.
  Real adapter + real safety guard validate them; negative incomplete/dedup
  tests stay fail-closed.
- Updated frontend tests from obsolete per-supplier IDs to actual unified
  export/status controls; installed \`fflate\` UMD dependency into ignored
  test-local node_modules, not application code or Git.
- 110-file purchasing+backend regression: **1800 total, 1798 pass, 0 fail,
  2 optional real-workbook tests skipped**, exit 0. The skipped tests mean
  real 1C/SmartZapas integration was **not** verified.
- Verified Miska code checkpoint \`a8e0d90\`, independent local Git baseline,
  no remotes, \`git fsck=0\`.

### Real Codex acceptance and Git integrity repair

- 8/8 Arthur+Miska worker security tests passed: new per-task branches,
  project/path allowlist, protected data rejection, fail-closed regression
  review, no automatic deployment.
- Real Codex CLI through **existing** SSH tunnel, synthetic Arthur Miska
  command, isolated queue and worktree: **98 seconds**. Exactly one
  allowlisted Markdown diff, exact content, 1798/1800 synthetic regression
  passes (2 expected optional skips), task \`needs_review\`, no deploy or
  Git push, owner approval required.
- Before rollout, found corrupted **inherited** Git ancestry in the older
  v2 runtime and old Arthur baseline: missing parent commit and \`git fsck=2\`.
  Did not touch the old originals. Created completely independent local-only
  snapshot repositories from verified Git trees, explicitly restoring 11
  Git index entries/modes (Windows line endings and executable bits) so
  **source and new Git tree SHA match exactly**. New baselines passed
  \`git fsck=0\` and have clean worktrees/no remotes:
  - Arthur code baseline \`C:\AI-Ecosystem\candidates\arthur-codex-baseline-clean-20261011\`,
    local HEAD **\`c1c29af\`** with exact old source Git tree \`adfe6ce...\`.
  - Miska code baseline \`C:\AI-Ecosystem\candidates\miska-codex-baseline-stable-20261011\`,
    HEAD **\`a8e0d90\`**.
  - Worker v3 at \`C:\AI-Ecosystem\local-services\arthur-codex-runtime-v3\`,
    local HEAD **\`a14533e\`**, exact v3 development Git tree
    \`34424467830f...\`.
- Rechecked 22/22 Arthur integration/model tests, 8/8 worker security
  tests, all three clean Git repositories, and v3 empty-queue execution
  before updating Windows scheduled task.

### Post-switch operational constraints

- Live Windows task \`Arthur-Codex-Agent-Worker\` remains ready, last result
  **0**, pointing to worker v3; production Arthur API/Telegram Gateway,
  Miska purchasing backend and OmniRoute Docker containers remained healthy.
- Original Miska development source still has **51 dirty/untracked paths**,
  untouched. Historical live Arthur queue still has **two needs_review and
  one failed** task; no existing queue record was changed by this rollout.
- AgentControl \`codex.enabled=true\`, \`kimi.enabled=false\`. Arthur and
  Miska development now use distinct pinned Git baselines, a fresh Git
  worktree for each new job and tests+manual review before promotion.
- The actual **purchasing Docker application code was NOT deployed**:
  this rollout changes only the **software-development task worker**.
  No 1C connectivity, external purchase order, Instagram post, production
  price, stock update, or email was carried out.
- A new job via the **real owner Telegram channel** has not yet run under
  the switched scheduled worker. The actual Codex end-to-end proof used a
  synthetic owner/channel with an isolated queue. Keep human approval for
  merging and deployment; never interpret \`needs_review\` as deployed.
- Rollback: restore prior scheduled action from
  \`Arthur-Codex-Agent-Worker.before-miska-v3-20261011.xml\`,
  confirm principal/triggers and run an empty-queue smoke. Old original
  v2 Git history has a known fsck defect; do not reuse its Git objects as
  future new baselines.

**GitHub PR #233 remains DRAFT.** The above v3 code snapshots are local
Amursk Git commits, not branches automatically pushed or merged to GitHub.
