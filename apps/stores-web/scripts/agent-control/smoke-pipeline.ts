/**
 * Disposable AgentControl end-to-end smoke proof.
 *
 * Runs a throwaway multi-stage pipeline through the real orchestration
 * engine in a temporary directory — never against production queues,
 * production repos, Kimi/Codex CLIs, IndexNow, Yandex, or any external
 * service. The "worker" is a scripted in-process adapter.
 *
 * Proof coverage:
 *   enqueue -> claim -> bounded worker execution -> gate -> next stage
 *   -> reviewer (BLOCKED -> review -> resolved) -> final QA -> DONE
 *   plus a controlled retry (attempts 1..N) and a terminal-failure-at-limit
 *   pipeline proving exact maxAttempts enforcement.
 *
 * Run: npm run agent-control:smoke
 */

import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Orchestrator,
  StateStore,
  WorkerRouter,
} from "@/agent-control";
import type { ReadinessResult, TaskRecord, WorkerAdapter, WorkerResult } from "@/agent-control";

const SMOKE_PIPELINE = "smoke-seo-pipeline";
const MAXATTEMPTS_PIPELINE = "smoke-max-attempts-proof";

interface Scenario {
  name: string;
  attempts: number;
}

/** Scripted worker that fails the implement stage once, then produces the artifact. */
function createSmokeWorker(artifactPath: string): WorkerAdapter & { calls: Scenario[] } {
  const calls: Scenario[] = [];
  const adapter: WorkerAdapter & { calls: Scenario[] } = {
    calls,
    name: "smoke-worker",
    async readiness(): Promise<ReadinessResult> {
      return { ok: true, detail: "scripted smoke worker always ready", checkedAt: new Date().toISOString() };
    },
    async execute(task: TaskRecord): Promise<WorkerResult> {
      calls.push({ name: task.stage, attempts: task.attempts });
      if (task.pipelineId === SMOKE_PIPELINE) {
        if (task.stage === "implement" && task.attempts === 1) {
          return { outcome: "RETRY", summary: "controlled flaky failure", reason: "simulated transient tool error" };
        }
        if (task.stage === "implement") {
          writeFileSync(artifactPath, "artifact from attempt " + task.attempts);
          return { outcome: "SUCCESS", summary: "implementation artifact written" };
        }
        if (task.stage === "code-review" && task.attempts === 1) {
          return {
            outcome: "BLOCKED",
            summary: "reviewer question",
            blockedCategory: "review",
            reason: "naming convention unclear for SEO titles",
          };
        }
        return { outcome: "SUCCESS", summary: `${task.stage} passed` };
      }
      // maxAttempts proof pipeline: every attempt is a retryable failure.
      return { outcome: "RETRY", summary: "deterministic failure", reason: "always failing by design" };
    },
  };
  return adapter;
}

async function runSmokePipeline(dir: string): Promise<void> {
  const artifactPath = path.join(dir, "implement-artifact.txt");
  const store = new StateStore(path.join(dir, "state-smoke"));
  const orchestrator = new Orchestrator(store);
  orchestrator.registerPipeline({
    pipelineId: SMOKE_PIPELINE,
    stages: ["implement", "code-review", "reality-qa"],
    gates: {
      implement: [
        () => ({
          gate: "artifact-exists",
          passed: existsSync(artifactPath),
          reason: existsSync(artifactPath) ? undefined : "implementation artifact missing",
        }),
      ],
      "reality-qa": [() => ({ gate: "no-live-traffic", passed: true })],
    },
  });

  // Idempotency proof: two scheduled ticks must produce exactly one task.
  await orchestrator.runPipelineOnce(SMOKE_PIPELINE);
  const secondTick = await orchestrator.runPipelineOnce(SMOKE_PIPELINE);
  console.log(`[smoke] pipeline-runner second tick enqueued=${secondTick.enqueued} (expected 0)`);

  const worker = createSmokeWorker(artifactPath);
  const router = new WorkerRouter({ orchestrator, adapters: [worker], workerId: "smoke-router", executeTimeoutMs: 5_000 });

  for (let cycle = 0; cycle < 20; cycle += 1) {
    const pipeline = orchestrator.getPipeline(SMOKE_PIPELINE);
    if (pipeline?.status === "done") break;
    await orchestrator.reconcile();
    const result = await router.runOnce();
    console.log(`[smoke] cycle ${cycle}: router=${result.status}` + (result.status === "completed" ? ` adapter=${result.adapter} outcome=${result.outcome}` : ""));
    // Resolve review parking as the human reviewer would.
    const snapshot = store.snapshot();
    for (const task of Object.values(snapshot.tasks)) {
      if (task.pipelineId === SMOKE_PIPELINE && task.status === "review") {
        await orchestrator.resolveReview(task.id, true, "clarified: use product naming from style guide");
        console.log(`[smoke] review resolved for ${task.stage}; task returns to pending`);
      }
    }
  }

  const pipeline = orchestrator.getPipeline(SMOKE_PIPELINE);
  if (pipeline?.status !== "done") {
    throw new Error(`smoke pipeline did not reach DONE: ${JSON.stringify(pipeline)}`);
  }
  const implementCalls = worker.calls.filter((c) => c.name === "implement").map((c) => c.attempts);
  if (implementCalls.join(",") !== "1,2") {
    throw new Error(`expected controlled retry attempts 1,2 — got ${implementCalls.join(",")}`);
  }
  console.log(`[smoke] DONE: attempts on implement stage were ${implementCalls.join(" -> ")} (retry proven)`);
}

async function runMaxAttemptsProof(dir: string): Promise<void> {
  const store = new StateStore(path.join(dir, "state-maxattempts"));
  const orchestrator = new Orchestrator(store);
  orchestrator.registerPipeline({ pipelineId: MAXATTEMPTS_PIPELINE, stages: ["always-failing"] });
  await orchestrator.runPipelineOnce(MAXATTEMPTS_PIPELINE);

  const worker = createSmokeWorker(path.join(dir, "unused-artifact.txt"));
  const router = new WorkerRouter({ orchestrator, adapters: [worker], workerId: "smoke-router-2" });

  const seen: number[] = [];
  for (let cycle = 0; cycle < 10; cycle += 1) {
    const pipeline = orchestrator.getPipeline(MAXATTEMPTS_PIPELINE);
    if (pipeline?.status === "failed") break;
    const result = await router.runOnce();
    if (result.status === "completed") seen.push(...worker.calls.splice(0).map((c) => c.attempts));
  }
  const pipeline = orchestrator.getPipeline(MAXATTEMPTS_PIPELINE);
  if (pipeline?.status !== "failed") {
    throw new Error(`maxAttempts proof pipeline should have failed terminally: ${JSON.stringify(pipeline)}`);
  }
  if (seen.join(",") !== "1,2,3") {
    throw new Error(`expected attempts 1,2,3 then terminal failure — got ${seen.join(",")}`);
  }
  console.log(`[maxAttempts] terminal failure at limit: attempts ${seen.join(" -> ")} of max 3, pipeline failed as designed`);
}

async function main(): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "agent-control-smoke-"));
  console.log(`[smoke] disposable run directory: ${dir}`);
  await runSmokePipeline(dir);
  await runMaxAttemptsProof(dir);

  const store = new StateStore(path.join(dir, "state-smoke"));
  const audit = store.readAudit();
  console.log(`[smoke] audit events recorded: ${audit.length}`);
  for (const event of audit) {
    console.log(
      `  #${event.seq} ${event.type}` +
        (event.stage ? ` stage=${event.stage}` : "") +
        (event.workerId ? ` worker=${event.workerId}` : "") +
        (event.outcome ? ` outcome=${event.outcome}` : "") +
        (event.reason ? ` reason="${event.reason}"` : ""),
    );
  }
  const tasks = Object.values(store.snapshot().tasks);
  console.log("[smoke] final queue state:");
  for (const task of tasks) {
    console.log(`  task=${task.id} stage=${task.stage} status=${task.status} attempts=${task.attempts}/${task.maxAttempts}`);
  }
  console.log("[smoke] E2E PROOF COMPLETE: pipeline reached DONE automatically with a controlled retry");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
