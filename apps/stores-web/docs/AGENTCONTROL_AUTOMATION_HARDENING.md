# AgentControl Automation Hardening — Report

Date: 2026-09-29
Issue: #197 — AgentControl: full autonomous multi-agent hardening and end-to-end proof
Area delivered: `apps/stores-web` (the only area writable from the implementing sandbox)

## 1. Scope boundary and root causes

The production AgentControl host (`C:\AI\AgentControl` on the Amursk Windows box,
reachable as `admin@100.78.67.88`) is **not reachable from this sandbox**: no
SSH/network tooling is permitted here, and no file on that host is readable or
writable from this environment. Nothing was deployed, pushed, merged, indexed,
or mutated in production. All prohibited actions (IndexNow, Yandex
Webmaster/Business, payments/delivery, production deploys) were not performed.

The known orchestration defects from the issue were therefore addressed where
they can be implemented, tested, and proven from here: a **portable,
durable AgentControl orchestration engine** (`apps/stores-web/agent-control/`)
that encodes the corrected state machine and can be lifted to the Windows host
as-is (plain TypeScript, CommonJS-compatible, zero external dependencies). Each
known defect maps to an explicit, tested behavior:

| Known defect | Root cause | Fix in this engine |
| --- | --- | --- |
| Non-ok worker results moved straight to `failed`, so `maxAttempts` never retried | Outcome routing conflated "retryable" with "terminal" | Explicit `WorkerOutcome` taxonomy: `SUCCESS / RETRY / BLOCKED / APPROVAL_REQUIRED / FAIL`, each with its own route (`orchestrator.complete`) |
| `locking.mjs:newAttempt()` did not increment `attempts` | Attempt accounting was optional/separate from claiming | `newAttempt()` is the only place attempts are incremented; it runs inside the claim transaction, before any worker code, and persists atomically |
| Unpacked `amursk-seo` dir had no `.git`; Git resolved to an unrelated parent repo | Project path never validated against the exact Git top-level | `validateProjectRoot()` fails closed unless the configured path **is** the Git top-level reported for it (plus optional allowlist), realpath-compared |
| Exit code 0 treated as success | Process semantics used instead of explicit outcomes | Exit codes are irrelevant to the engine; only explicit `WorkerResult.outcome` moves tasks. A worker that exits 0 without a verifiable result reports `BLOCKED`/`RETRY`/`FAIL` |
| Stale state: interrupted transitions, stale locks, dead PIDs, stale `running` | No reconciliation path | Deterministic `reconcile()` watchdog + idempotent `runPipelineOnce()` recovery that advances a stage whose task is `done` without re-executing it |
| Duplicate executions of the same logical task | Enqueue/claim not idempotent | Unique active logical key `(pipelineId, stage, logicalKey)` with duplicate suppression at enqueue; exclusive claim; single-owner routing |

## 2. Files changed

All inside `apps/stores-web/`:

- `agent-control/types.ts` — contracts: outcomes, statuses, lease, history, audit events, adapter interface.
- `agent-control/state-store.ts` — durable JSON queue/audit store; serialized transactions; `write + fsync + rename` atomic persistence.
- `agent-control/locking.ts` — `newAttempt()` (atomic attempts increment, token rotation, lease), `isLeaseActive()`, `releaseLease()`.
- `agent-control/orchestrator.ts` — enqueue (duplicate suppression), `claimNext`, `complete` (full outcome routing), review/approval resolution, gates, stage advancement, idempotent `runPipelineOnce`, watchdog `reconcile`.
- `agent-control/project-validation.ts` — fail-closed exact Git-top-level validation.
- `agent-control/worker-router.ts` — exclusive single-owner routing, cached bounded readiness probes, hard execution timeout (AbortController + timer, non-cooperative adapters included), result bounding, structured blocker recording.
- `agent-control/cli-adapter.ts` — CLI adapter factory (Kimi/Codex seam): bounded readiness command, bounded execution, payload cap, and an optional fail-closed project guard — when `project` is configured, readiness also runs `validateProjectRoot()` against the adapter cwd, so an adapter rooted at a non-repo/foreign path reports unready and can never receive work (no accidental fallback to an unsafe repo).
- `agent-control/index.ts` — barrel.
- `tests/agent-control-core.test.ts` — attempts increment/ persistence / token rotation / exclusive FIFO claims / duplicate suppression / stale-token rejection / exit-0-is-not-success.
- `tests/agent-control-retry-blocked.test.ts` — retry until `maxAttempts`, terminal failure at limit, history preservation, BLOCKED routing (review/approval/policy), resolutions, no-spin guarantee.
- `tests/agent-control-pipeline.test.ts` — success gates, gate failure stops advancement, pipeline-level failure, runner idempotency, interrupted-transition recovery without re-execution.
- `tests/agent-control-watchdog-validation.test.ts` — stale lease, dead PID, healthy-task untouched, exhaustion, stale completion after requeue, Git-root fail-closed cases.
- `tests/agent-control-router.test.ts` — worker selection, unauthenticated-Kimi blocker recording with safe Codex fallback, hard timeout bounding, crash-as-retryable, no dual execution.
- `tests/agent-control-cli-adapter.test.ts` — adapter readiness (probe pass/fail + fail-closed project-root guard), payload bounding/truncation, non-JSON stdout as explicit FAIL, non-zero exit as retryable, and router-level proof that an adapter failing project validation is never executed and its blocker is recorded.
- `scripts/agent-control/smoke-pipeline.ts` — disposable end-to-end proof runner.
- `package.json` — added `agent-control:smoke` script.
- `docs/AGENTCONTROL_AUTOMATION_HARDENING.md` — this report.

## 3. Architecture / state machine

```
                 claimNext (atomic attempts+1, new token, lease)
  pending ──────────────────────────────────────────────> running ──complete(SUCCESS)──> gates
    ^                                                        │                     pass ──> done ──> advance stage
    │                                                        │                     fail ──> pending (retry until max) ──> failed
    │  retry_scheduled (reason, history preserved)           │
    └──────────────────────────────<────────complete(RETRY)──┤ attempts < maxAttempts
                                                             ├─ complete(RETRY/FAIL at max) ──> failed (terminal, pipeline failed)
                                                             ├─ complete(BLOCKED, review) ──> review ──resolveReview──> pending | failed
                                                             ├─ complete(BLOCKED, approval) / complete(APPROVAL_REQUIRED)
                                                             │      └─> approval ──resolveApproval──> gates (success path) | failed
                                                             └─ complete(BLOCKED, policy) ──> pending until maxAttempts ──> failed
```

Guarantees implemented and tested:

1. **Single active owner** — one active record per logical key; claims are exclusive; a task is executed by exactly one adapter per claim.
2. **Exact attempt accounting** — `attempts` increments in `newAttempt()` inside the claim transaction, persisted before worker execution; `maxAttempts` enforced exactly (`1..N` then terminal).
3. **Retryable failures** — return to `pending` with preserved history (reason, previous worker, outcome) and a fresh attempt token on the next claim.
4. **BLOCKED routing** — `review` parks safely (human/agent resolvable, no spinning), `approval` parks for genuine human approval, `policy` retries until the attempt limit then fails terminally. Reason always recorded.
5. **Gates** — `SUCCESS` advances the pipeline only after all stage gates pass; a failed gate never advances and the stage retries until the limit.
6. **Idempotent runner** — repeated scheduled ticks never enqueue a stage that is pending/running/done; interrupted transitions (task `done`, pipeline not advanced) are recovered exactly once without re-execution.
7. **Watchdog** — expired leases and dead worker PIDs return tasks to `pending` (attempts preserved) or fail them at the limit; stale completions from dead attempts are rejected via token rotation.
8. **Worker routing** — bounded prompts (`maxPayloadChars`/`maxSummaryChars`), hard execution timeout even for non-cooperative adapters, cached authenticated readiness probes per adapter, recorded blockers, safe fallback to other ready adapters, never blind routing. Adapters can pin their `cwd` to an exact Git top-level via the fail-closed project guard, closing the "unpacked directory resolves to an unrelated parent repo" class of error inside the routing path itself.
9. **Project validation** — fails closed unless the path is exactly its Git top-level (no parent-repo fallthrough), with an optional top-level allowlist.
10. **Auditability** — every enqueue/claim/assignment/gate/retry/block/resolve/advance/watchdog event is appended to `audit.jsonl` with sequence number, stage, worker, outcome, and reason; queue and audit are persisted in the same serialized transaction.

## 4. Tests and exact results

Commands (run in `apps/stores-web`, Node v22.23.2):

- `npm test` — **227 passed, 0 failed** (46 new AgentControl assertions across 9 suites, plus all pre-existing suites).
- `npm run lint` — clean, 0 errors / 0 warnings (`--max-warnings=0`).
- `npm run typecheck` — clean (`tsc --noEmit`, strict).
- `npm run build` — clean (hermetic Next.js build, mock content).

Required test coverage map (all against disposable fixture stores in `os.tmpdir()`, never production queues):

- attempts increment → `agent-control-core` (in-memory + durable reload + on-disk `queue.json`), `agent-control-retry-blocked`.
- retry until maxAttempts / terminal at limit → `agent-control-retry-blocked` (audit shows `claimed` attempts exactly `[1,2,3]`, 2× `retry_scheduled`, 1× `terminal_failure`).
- BLOCKED routing → `agent-control-retry-blocked` (review/approval/policy + no-spin loop).
- success advancement / gate failure stops advancement → `agent-control-pipeline`.
- duplicate suppression / idempotent runner → `agent-control-core`, `agent-control-pipeline` (second tick `enqueued=0`).
- stale running/lock reconciliation → `agent-control-watchdog-validation` (expired lease, dead PID, healthy untouched, exhaustion, stale completion rejected).
- exact Git-root validation → `agent-control-watchdog-validation` (5 fail-closed/accept cases with injected resolver).
- worker selection without duplicate execution → `agent-control-router` (exactly one adapter executes the claimed task; unauthenticated Kimi never receives work).
- bounded worker readiness/prompts + unsafe-repo refusal → `agent-control-cli-adapter` (probe pass/fail, fail-closed project-root guard, payload truncation bound, non-JSON stdout = explicit FAIL, non-zero exit = retryable, adapter failing project validation never executed).

## 5. Kimi and Codex readiness results

- **In this sandbox**: no Kimi/Codex CLI exists and no network/auth probing is permitted, so host readiness cannot be checked from here — and was **not** faked.
- **Mechanism delivered**: `createCliAdapter()` implements readiness as a bounded probe command (exit 0 within a timeout, e.g. a minimal authenticated smoke prompt), never inferred from a process existing. When the adapter is configured with `project: { projectPath, allowedTopLevels }` (projectPath = adapter `cwd`), readiness additionally fails closed unless that path is the exact Git top-level — an unauthenticated Kimi or an adapter pointed at a stray directory reports unready, the router records the specific blocker (`readiness_failed` audit event with probe stderr or validation reason), and work falls back to the next safe ready adapter. A task is never routed simultaneously to Kimi and Codex (exclusive claim, single chosen adapter).
- **Required human action (single, host-side)**: on the AgentControl host, configure the Kimi and Codex adapters via `createCliAdapter({ readinessCommand, executeCommand, cwd, project: { projectPath: cwd, allowedTopLevels: [<exact worktree top-level>] } })`, then run one bounded readiness probe per adapter. If Kimi authentication is incomplete, its blocker is recorded automatically and Codex-capable tasks keep flowing — no manual intervention per task.

## 6. Scheduler / watchdog status

- Scheduling is reduced to durable code: a scheduler only needs to call `runPipelineOnce(pipelineId)` (enqueue/idempotency/recovery) and `reconcile()` (stale lease/PID recovery) on a tick, then drain the queue with `WorkerRouter.runOnce()` — no `/tmp` bridge scripts and no manual "continue".
- Both entry points are deterministic, safe to run concurrently with worker execution, and proven by tests (§4).

## 7. End-to-end smoke evidence

`npm run agent-control:smoke` — disposable pipeline `smoke-seo-pipeline`
(stages `implement → code-review → reality-qa`) in a temp dir, scripted
in-process worker, no external services. Latest run:

```
[smoke] pipeline-runner second tick enqueued=0 (expected 0)
[smoke] cycle 0: router=completed adapter=smoke-worker outcome=RETRY
[smoke] cycle 1: router=completed adapter=smoke-worker outcome=SUCCESS
[smoke] cycle 2: router=completed adapter=smoke-worker outcome=BLOCKED
[smoke] review resolved for code-review; task returns to pending
[smoke] cycle 3: router=completed adapter=smoke-worker outcome=SUCCESS
[smoke] cycle 4: router=completed adapter=smoke-worker outcome=SUCCESS
[smoke] DONE: attempts on implement stage were 1 -> 2 (retry proven)
[maxAttempts] terminal failure at limit: attempts 1 -> 2 -> 3 of max 3, pipeline failed as designed
[smoke] audit events recorded: 26
[smoke] final queue state:
  stage=implement  status=done attempts=2/3
  stage=code-review status=done attempts=2/3
  stage=reality-qa status=done attempts=1/3
[smoke] E2E PROOF COMPLETE: pipeline reached DONE automatically with a controlled retry
```

The audit trail (26 events: `enqueued → claimed → worker_assigned →
retry_scheduled → gate_passed → completed → stage_advanced → blocked_routed →
review_resolved → … → pipeline_done`) is printed by the script and persisted in
the disposable run directory.

## 8. AmurskMarket V2 final state

Not modified — production was not touched, by design. The safe reconciliation
procedure the host operator should run (all durable, no duplicates):

1. Back up `C:\AI\AgentControl` state files.
2. Point the project config at the real isolated worktree and validate with `validateProjectRoot()` (exact Git top-level; refuses the previous no-`.git` fallthrough).
3. On each schedule tick: `runPipelineOnce("AmurskMarket-SEO-V2")`, `reconcile()`, drain with the router.
4. If the implementation stage's output is valid: its task is already `done`, so the idempotent runner advances exactly once to Code Reviewer, then Reality/QA — **no duplicate implementation** (proven by the interrupted-transition recovery test).
5. If not valid: return the stage to `pending` with reason; the repaired engine retries with attempts `1..N` and terminal failure at the limit.

## 9. Remaining blockers

1. **External**: the AgentControl Windows host is unreachable from this sandbox — the hardened engine must be lifted to the host and wired to its scheduler (single human action listed in §5).
2. **External**: Kimi/Codex CLI authentication on the host must be verified with the bounded readiness probes (same single human action).
3. No other blockers. Nothing in the acceptance criteria that is verifiable in this sandbox remains unproven: core checks pass, retry 1..N proven, duplicate protection proven, stale recovery proven, exact Git-root guard proven, bounded worker readiness proven, disposable multi-stage pipeline reaches DONE automatically, and no prohibited production action occurred.

## 10. Rollback instructions

- No production system was changed; nothing needs rolling back there.
- The engine is additive inside `apps/stores-web/`. To revert: delete `agent-control/`, `tests/agent-control-*.test.ts` (6 files), `scripts/agent-control/`, remove the `agent-control:smoke` line from `package.json`, and delete this report. `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` remain green without these files (they were green before this change).
- On the host (once adopted): restore the backed-up `C:\AI\AgentControl` state files and previous `orchestrator.mjs`/`locking.mjs` from the backup made in §8 step 1.
