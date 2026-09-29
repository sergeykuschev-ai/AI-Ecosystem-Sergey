import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { newAttempt, Orchestrator, StateStore } from "@/agent-control";
import type { TaskRecord } from "@/agent-control";

function makeStoreDir(): string {
  return mkdtempSync(path.join(tmpdir(), "agent-control-core-"));
}

function makeOrchestrator(store: StateStore, opts?: { now?: () => Date }) {
  return new Orchestrator(store, opts);
}

describe("AgentControl locking and state store", () => {
  test("newAttempt atomically increments attempts, rotates token, issues lease", () => {
    const at = new Date("2026-09-29T00:00:00Z");
    const task = { ...emptyTask(at), status: "pending" as const };

    newAttempt(task, "worker-a", at, 60_000, 4242);
    assert.equal(task.attempts, 1);
    assert.equal(task.status, "running");
    const token1 = task.attemptToken;
    assert.ok(token1);
    assert.equal(task.lease?.owner, "worker-a");
    assert.equal(task.lease?.pid, 4242);
    assert.equal(task.lease?.attemptToken, token1);
    assert.equal(task.lease?.expiresAt, new Date(at.getTime() + 60_000).toISOString());

    task.status = "pending";
    newAttempt(task, "worker-b", at, 60_000, 4243);
    assert.equal(task.attempts, 2);
    assert.notEqual(task.attemptToken, token1, "each attempt must get a fresh token");
    assert.equal(task.history.filter((h) => h.event === "claimed").length, 2);
  });

  test("attempts persist durably across store reloads (crash recovery)", async () => {
    const dir = makeStoreDir();
    const store = new StateStore(dir);
    const orchestrator = makeOrchestrator(store);
    const { task } = await orchestrator.enqueue({
      pipelineId: "p",
      stage: "s",
      logicalKey: "k",
      maxAttempts: 3,
    });
    const claimed = await orchestrator.claimNext("worker-a", { pid: 111 });
    assert.equal(claimed?.attempts, 1);

    // Simulate process restart: brand new store instance over the same files.
    const reloaded = new StateStore(dir);
    const reloadedTask = reloaded.snapshot().tasks[task.id];
    assert.equal(reloadedTask.attempts, 1, "attempts must survive a reload");
    assert.equal(reloadedTask.status, "running");
    assert.equal(reloadedTask.lease?.pid, 111);
    const queueOnDisk = JSON.parse(readFileSync(path.join(dir, "queue.json"), "utf8"));
    assert.equal(queueOnDisk.tasks[task.id].attempts, 1, "queue.json on disk carries attempts");
  });

  test("claimNext is exclusive and claims pending tasks FIFO", async () => {
    const store = new StateStore(makeStoreDir());
    let tick = 0;
    const orchestrator = makeOrchestrator(store, { now: () => new Date(Date.UTC(2026, 8, 29, 0, 0, tick++)) });
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "first" });
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "second" });

    const claim1 = await orchestrator.claimNext("worker-a");
    const claim2 = await orchestrator.claimNext("worker-b");
    const claim3 = await orchestrator.claimNext("worker-c");
    assert.equal(claim1?.logicalKey, "first");
    assert.equal(claim2?.logicalKey, "second");
    assert.equal(claim3, null, "no third task exists; claims must not duplicate");
    assert.notEqual(claim1?.id, claim2?.id);
  });

  test("enqueue suppresses duplicates of an active logical task", async () => {
    const store = new StateStore(makeStoreDir());
    const orchestrator = makeOrchestrator(store);
    const first = await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "seo-task" });
    const duplicate = await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "seo-task" });
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.task.id, first.task.id);

    const snapshot = store.snapshot();
    assert.equal(Object.keys(snapshot.tasks).length, 1, "exactly one task record may exist");
    const audit = store.readAudit();
    assert.ok(audit.some((e) => e.type === "duplicate_suppressed"));
  });

  test("completions with a stale attempt token are rejected", async () => {
    const store = new StateStore(makeStoreDir());
    const orchestrator = makeOrchestrator(store);
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k" });
    const claimed = await orchestrator.claimNext("worker-a");
    assert.ok(claimed?.attemptToken);
    await assert.rejects(
      orchestrator.complete(claimed.id, "not-the-token", { outcome: "SUCCESS", summary: "x" }),
      /stale attempt token/,
    );
    const after = orchestrator.getTask(claimed.id);
    assert.equal(after?.status, "running", "stale completion must not move the task");
    assert.ok(store.readAudit().some((e) => e.type === "stale_token_rejected"));
  });

  test("exit code 0 is not success: only explicit outcomes move tasks", async () => {
    const store = new StateStore(makeStoreDir());
    const orchestrator = makeOrchestrator(store);
    const { task } = await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k" });
    const claimed = await orchestrator.claimNext("worker-a");
    // A worker that exits 0 but cannot assert success must report an outcome;
    // the orchestrator has no code path that treats silence as success.
    const completed = await orchestrator.complete(claimed!.id, claimed!.attemptToken!, {
      outcome: "BLOCKED",
      summary: "process exited 0 but produced no verifiable result",
      blockedCategory: "review",
    });
    assert.equal(completed.status, "review");
    assert.notEqual(completed.status, "done");
    assert.equal(orchestrator.getTask(task.id)?.status, "review");
  });
});

function emptyTask(at: Date): TaskRecord {
  return {
    id: "task-1",
    pipelineId: "p",
    stage: "s",
    logicalKey: "k",
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    workerId: null,
    attemptToken: null,
    lease: null,
    blockedCategory: null,
    blockedReason: null,
    payload: {},
    history: [],
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
  };
}
