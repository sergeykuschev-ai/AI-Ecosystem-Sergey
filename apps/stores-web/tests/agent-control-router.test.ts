import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { Orchestrator, StateStore, WorkerRouter } from "@/agent-control";
import type { ReadinessResult, TaskRecord, WorkerAdapter, WorkerResult } from "@/agent-control";

class ScriptedAdapter implements WorkerAdapter {
  private lastReadiness: ReadinessResult;
  private queued: ReadinessResult[] = [];
  executeCalls: TaskRecord[] = [];
  executeImpl: (task: TaskRecord) => Promise<WorkerResult>;
  readinessCalls = 0;

  constructor(
    readonly name: string,
    initialReadiness: ReadinessResult,
    executeImpl?: (task: TaskRecord) => Promise<WorkerResult>,
  ) {
    this.lastReadiness = initialReadiness;
    this.executeImpl = executeImpl ?? (async () => ({ outcome: "SUCCESS", summary: `${name} done` }));
  }

  setReady(detail = "authenticated smoke prompt passed"): void {
    this.queued.push({ ok: true, detail, checkedAt: new Date().toISOString() });
  }

  setBlocked(detail: string): void {
    this.queued.push({ ok: false, detail, checkedAt: new Date().toISOString() });
  }

  async readiness(): Promise<ReadinessResult> {
    this.readinessCalls += 1;
    const next = this.queued.shift();
    if (next) {
      this.lastReadiness = next;
      return next;
    }
    return this.lastReadiness;
  }

  async execute(task: TaskRecord): Promise<WorkerResult> {
    this.executeCalls.push(task);
    return this.executeImpl(task);
  }
}

const ready = (name: string): ReadinessResult => ({ ok: true, detail: `${name} ready`, checkedAt: new Date().toISOString() });
const blocked = (name: string, detail: string): ReadinessResult => ({ ok: false, detail, checkedAt: new Date().toISOString() });

function makeHarness(adapters: WorkerAdapter[], routerOpts?: { executeTimeoutMs?: number; readinessTtlMs?: number }) {
  const store = new StateStore(mkdtempSync(path.join(tmpdir(), "agent-control-router-")));
  const orchestrator = new Orchestrator(store);
  const router = new WorkerRouter({ orchestrator, adapters, workerId: "router-1", ...routerOpts });
  return { store, orchestrator, router };
}

describe("AgentControl worker router", () => {
  test("routes a claimed task to the first ready adapter and executes it exactly once", async () => {
    const kimi = new ScriptedAdapter("kimi", ready("kimi"));
    const codex = new ScriptedAdapter("codex", ready("codex"));
    const { orchestrator, router } = makeHarness([kimi, codex]);
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k" });

    const result = await router.runOnce();
    assert.equal(result.status, "completed");
    if (result.status === "completed") assert.equal(result.adapter, "kimi");
    assert.equal(kimi.executeCalls.length, 1);
    assert.equal(codex.executeCalls.length, 0, "the same logical task must never run in two adapters at once");
    assert.equal(orchestrator.getTask(result.status === "completed" ? result.taskId : "")?.status, "done");
  });

  test("an unauthenticated Kimi is recorded as a blocker; the task falls back to the safe Codex path, never to blind Kimi execution", async () => {
    const kimi = new ScriptedAdapter("kimi", blocked("kimi", "smoke prompt rejected: incomplete authentication"));
    const codex = new ScriptedAdapter("codex", ready("codex"));
    const { store, orchestrator, router } = makeHarness([kimi, codex], { readinessTtlMs: 0 });
    const { task } = await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 3 });

    const first = await router.runOnce();
    assert.equal(first.status, "completed");
    if (first.status === "completed") assert.equal(first.adapter, "codex", "work must fall back to the safe ready adapter");
    assert.equal(first.status === "completed" ? first.outcome : "", "SUCCESS");
    assert.equal(kimi.executeCalls.length, 0, "Kimi must never receive work while unauthenticated");
    assert.equal(codex.executeCalls.length, 1);
    assert.equal(orchestrator.getTask(task.id)?.status, "done");

    // The specific Kimi blocker was recorded in the audit trail.
    const readinessFailures = store.readAudit().filter((e) => e.type === "readiness_failed");
    assert.ok(readinessFailures.some((e) => /incomplete authentication/.test(e.reason ?? "")));

    // Once Kimi authentication is fixed, the next task is routed to Kimi by
    // policy order — still exactly one execution per task.
    kimi.setReady("authentication completed, smoke prompt passed");
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k2" });
    const second = await router.runOnce();
    assert.equal(second.status, "completed");
    if (second.status === "completed") assert.equal(second.adapter, "kimi");
    assert.equal(kimi.executeCalls.length, 1);
    assert.equal(codex.executeCalls.length, 1);
  });

  test("a slow worker is bounded by the router timeout and reported as retryable", async () => {
    const slow = new ScriptedAdapter("kimi", ready("kimi"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { outcome: "SUCCESS", summary: "too late" };
    });
    const { orchestrator, router } = makeHarness([slow], { executeTimeoutMs: 50 });
    const { task } = await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 2 });

    const result = await router.runOnce();
    assert.equal(result.status, "completed");
    if (result.status === "completed") assert.equal(result.outcome, "RETRY");
    const record = orchestrator.getTask(task.id);
    assert.equal(record?.status, "pending");
    assert.equal(record?.attempts, 1);
    assert.match(record?.history.at(-1)?.reason ?? "", /timed out after 50ms/);
  });

  test("a crashing worker is reported as retryable, not success", async () => {
    const crashy = new ScriptedAdapter("codex", ready("codex"), async () => {
      throw new Error("spawn git ENOENT");
    });
    const { orchestrator, router } = makeHarness([crashy]);
    const { task } = await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 2 });

    const result = await router.runOnce();
    assert.equal(result.status, "completed");
    if (result.status === "completed") assert.equal(result.outcome, "RETRY");
    const record = orchestrator.getTask(task.id);
    assert.equal(record?.status, "pending");
    assert.match(record?.history.at(-1)?.reason ?? "", /worker crashed/);
  });

  test("with no adapters ready the router is idle-safe and never invents work", async () => {
    const kimi = new ScriptedAdapter("kimi", blocked("kimi", "not authenticated"));
    const codex = new ScriptedAdapter("codex", blocked("codex", "not installed"));
    const { orchestrator, router } = makeHarness([kimi, codex], { readinessTtlMs: 0 });
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 5 });

    const result = await router.runOnce();
    assert.equal(result.status, "no_ready_adapter");
    assert.equal(kimi.executeCalls.length, 0);
    assert.equal(codex.executeCalls.length, 0);
    // Second pass consumes another attempt; still pending, still truthful.
    const again = await router.runOnce();
    assert.equal(again.status, "no_ready_adapter");
    if (again.status === "no_ready_adapter") assert.equal(again.attempts, 2);
  });

  test("router is a no-op when the queue is empty", async () => {
    const kimi = new ScriptedAdapter("kimi", ready("kimi"));
    const { router } = makeHarness([kimi]);
    assert.deepEqual(await router.runOnce(), { status: "idle" });
    assert.equal(kimi.readinessCalls, 0, "readiness probes must not fire when there is nothing to do");
  });
});
