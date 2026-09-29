import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { Orchestrator, StateStore, validateProjectRoot } from "@/agent-control";
import type { TopLevelResolver } from "@/agent-control";

describe("AgentControl watchdog reconciliation", () => {
  test("running task with an expired lease returns to pending with attempts preserved", async () => {
    const store = new StateStore(mkdtempSync(path.join(tmpdir(), "agent-control-watchdog-")));
    const orchestrator = new Orchestrator(store);
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 3 });

    const claim = await orchestrator.claimNext("worker-a", { pid: process.pid, leaseMs: 1_000 });
    assert.equal(claim?.attempts, 1);

    const future = new Date(Date.now() + 60_000);
    const result = await orchestrator.reconcile({ now: future });
    assert.deepEqual(result, { requeued: 1, failed: 0 });

    const task = orchestrator.getTask(claim!.id);
    assert.equal(task?.status, "pending");
    assert.equal(task?.attempts, 1, "watchdog requeue must not consume attempts");
    assert.equal(task?.lease, null);
    assert.equal(task?.workerId, null);
    assert.ok(task?.history.some((h) => h.event === "watchdog_reconciled" && /lease expired/.test(h.reason ?? "")));
    assert.ok(store.readAudit().some((e) => e.type === "watchdog_requeued"));
  });

  test("running task whose worker pid is dead returns to pending", async () => {
    const store = new StateStore(mkdtempSync(path.join(tmpdir(), "agent-control-watchdog-")));
    const orchestrator = new Orchestrator(store);
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 2 });
    const claim = await orchestrator.claimNext("worker-a", { pid: 999_001, leaseMs: 300_000 });

    const result = await orchestrator.reconcile({ pidProbe: () => false });
    assert.equal(result.requeued, 1);
    const task = orchestrator.getTask(claim!.id);
    assert.equal(task?.status, "pending");
    assert.match(task?.history.at(-1)?.reason ?? "", /pid 999001 is dead/);
  });

  test("healthy running tasks are untouched", async () => {
    const store = new StateStore(mkdtempSync(path.join(tmpdir(), "agent-control-watchdog-")));
    const orchestrator = new Orchestrator(store);
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k" });
    const claim = await orchestrator.claimNext("worker-a", { pid: process.pid, leaseMs: 300_000 });
    const result = await orchestrator.reconcile({ pidProbe: () => true, now: new Date() });
    assert.deepEqual(result, { requeued: 0, failed: 0 });
    assert.equal(orchestrator.getTask(claim!.id)?.status, "running");
  });

  test("watchdog respects maxAttempts: last attempt with dead worker fails terminally", async () => {
    const store = new StateStore(mkdtempSync(path.join(tmpdir(), "agent-control-watchdog-")));
    const orchestrator = new Orchestrator(store);
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 1 });
    const claim = await orchestrator.claimNext("worker-a", { pid: 999_002, leaseMs: 300_000 });
    assert.equal(claim?.attempts, 1);

    const result = await orchestrator.reconcile({ pidProbe: () => false });
    assert.deepEqual(result, { requeued: 0, failed: 1 });
    const task = orchestrator.getTask(claim!.id);
    assert.equal(task?.status, "failed");
    assert.match(task?.history.at(-1)?.reason ?? "", /attempts exhausted/);
  });

  test("a stale completion from a dead attempt is rejected after watchdog requeue", async () => {
    const store = new StateStore(mkdtempSync(path.join(tmpdir(), "agent-control-watchdog-")));
    const orchestrator = new Orchestrator(store);
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 3 });
    const claim = await orchestrator.claimNext("worker-a", { pid: 999_003, leaseMs: 300_000 });
    const staleToken = claim!.attemptToken!;

    await orchestrator.reconcile({ pidProbe: () => false });
    const reClaim = await orchestrator.claimNext("worker-b", { pid: process.pid, leaseMs: 300_000 });
    assert.notEqual(reClaim?.attemptToken, staleToken);

    await assert.rejects(
      orchestrator.complete(claim!.id, staleToken, { outcome: "SUCCESS", summary: "late result from dead worker" }),
      /stale attempt token/,
    );
    assert.equal(orchestrator.getTask(claim!.id)?.status, "running");
  });
});

describe("AgentControl exact Git-root validation", () => {
  function fakeRepo() {
    const root = mkdtempSync(path.join(tmpdir(), "agent-control-git-"));
    writeFileSync(path.join(root, ".gitkeep"), "");
    mkdirSync(path.join(root, ".git"));
    const nested = path.join(root, "subdir");
    mkdirSync(nested);
    const foreign = mkdtempSync(path.join(tmpdir(), "agent-control-git-"));
    mkdirSync(path.join(foreign, ".git"));
    return { root, nested, foreign };
  }

  const identityResolver: TopLevelResolver = async (dir) => dir;

  test("accepts a path that is exactly its own Git top-level", async () => {
    const { root } = fakeRepo();
    const result = await validateProjectRoot({ projectPath: root, resolveTopLevel: identityResolver });
    assert.deepEqual(result, { ok: true, topLevel: realpathSync(root) });
  });

  test("rejects a subdirectory that would fall through to a parent repository", async () => {
    const { root, nested } = fakeRepo();
    const result = await validateProjectRoot({
      projectPath: nested,
      resolveTopLevel: async () => root,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /not the exact Git top-level/);
    assert.match(result.reason, /refusing to fall through/);
  });

  test("fails closed when the resolver cannot determine a top-level", async () => {
    const { root } = fakeRepo();
    const result = await validateProjectRoot({
      projectPath: root,
      resolveTopLevel: async () => {
        throw new Error("git exited 128: not a git repository");
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /fail closed/);
  });

  test("fails closed on nonexistent paths", async () => {
    const result = await validateProjectRoot({
      projectPath: path.join(tmpdir(), "does-not-exist-agent-control"),
      resolveTopLevel: identityResolver,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /does not exist/);
  });

  test("enforces the configured top-level allowlist", async () => {
    const { root, foreign } = fakeRepo();
    const allowed = await validateProjectRoot({
      projectPath: root,
      allowedTopLevels: [root],
      resolveTopLevel: identityResolver,
    });
    assert.equal(allowed.ok, true);

    const denied = await validateProjectRoot({
      projectPath: foreign,
      allowedTopLevels: [root],
      resolveTopLevel: identityResolver,
    });
    assert.equal(denied.ok, false);
    assert.match(denied.reason, /not in the configured allowlist/);
  });
});
