import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { Orchestrator, StateStore } from "@/agent-control";

function makeOrchestrator() {
  const store = new StateStore(mkdtempSync(path.join(tmpdir(), "agent-control-retry-")));
  const orchestrator = new Orchestrator(store);
  return { store, orchestrator };
}

describe("AgentControl retry semantics", () => {
  test("retryable failure returns to pending with preserved history, reason, previous worker and a new token", async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 3 });

    const first = await orchestrator.claimNext("worker-a");
    const afterFirst = await orchestrator.complete(first!.id, first!.attemptToken!, {
      outcome: "RETRY",
      summary: "transient tool failure",
      reason: "git lock contention",
    });
    assert.equal(afterFirst.status, "pending");
    assert.equal(afterFirst.attempts, 1, "attempts must not be reset on retry");
    assert.equal(afterFirst.workerId, null);
    assert.equal(afterFirst.attemptToken, null);
    const retryEntry = afterFirst.history.find((h) => h.event === "retry_scheduled");
    assert.equal(retryEntry?.reason, "git lock contention");
    assert.equal(retryEntry?.attempts, 1);

    const second = await orchestrator.claimNext("worker-b");
    assert.equal(second?.attempts, 2);
    assert.notEqual(second?.attemptToken, first?.attemptToken, "next claim must issue a new attempt token");
    assert.equal(second?.workerId, "worker-b", "previous worker identity must be replaced, not accumulated");
  });

  test("retries until maxAttempts then terminal failure; audit shows attempts 1..N", async () => {
    const { store, orchestrator } = makeOrchestrator();
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 3 });

    const seenAttempts: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const claim = await orchestrator.claimNext(`worker-${i}`);
      assert.ok(claim);
      seenAttempts.push(claim.attempts);
      const done = await orchestrator.complete(claim.id, claim.attemptToken!, {
        outcome: "RETRY",
        summary: "flaky",
        reason: `failure ${i + 1}`,
      });
      if (i < 2) {
        assert.equal(done.status, "pending");
      } else {
        assert.equal(done.status, "failed", "third retryable failure must be terminal");
        assert.match(done.history.at(-1)?.reason ?? "", /attempts exhausted: 3\/3/);
      }
    }
    assert.deepEqual(seenAttempts, [1, 2, 3], "attempts must increment 1..maxAttempts");

    const audit = store.readAudit();
    const claims = audit.filter((e) => e.type === "claimed");
    assert.deepEqual(claims.map((e) => (e.details as { attempts: number }).attempts), [1, 2, 3]);
    assert.equal(audit.filter((e) => e.type === "retry_scheduled").length, 2);
    assert.equal(audit.filter((e) => e.type === "terminal_failure").length, 1);

    const again = await orchestrator.claimNext("worker-z");
    assert.equal(again, null, "failed tasks must never be reclaimed");
  });

  test("explicit FAIL is terminal on the first attempt", async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 3 });
    const claim = await orchestrator.claimNext("worker-a");
    const completed = await orchestrator.complete(claim!.id, claim!.attemptToken!, {
      outcome: "FAIL",
      summary: "tests failed",
      reason: "deterministic build break",
    });
    assert.equal(completed.status, "failed");
    assert.equal(completed.attempts, 1, "terminal failure must not consume further attempts");
  });
});

describe("AgentControl BLOCKED routing", () => {
  test("BLOCKED with review category parks the task in a safe review stage and resolution returns it to pending", async () => {
    const { orchestrator } = makeOrchestrator();
    const { task } = await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 2 });
    const claim = await orchestrator.claimNext("worker-a");
    const blocked = await orchestrator.complete(claim!.id, claim!.attemptToken!, {
      outcome: "BLOCKED",
      summary: "ambiguous requirement",
      blockedCategory: "review",
      reason: "spec contradicts itself on SKU scope",
    });
    assert.equal(blocked.status, "review");
    assert.equal(blocked.blockedReason, "spec contradicts itself on SKU scope");

    const resolved = await orchestrator.resolveReview(task.id, true, "spec clarified by tech lead");
    assert.equal(resolved.status, "pending");
    assert.equal(resolved.blockedReason, null);

    const reClaim = await orchestrator.claimNext("worker-b");
    assert.equal(reClaim?.attempts, 2, "review resolution must not erase attempt accounting");
  });

  test("review rejection fails the task terminally with the reason recorded", async () => {
    const { orchestrator } = makeOrchestrator();
    const { task } = await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k" });
    const claim = await orchestrator.claimNext("worker-a");
    await orchestrator.complete(claim!.id, claim!.attemptToken!, {
      outcome: "BLOCKED",
      summary: "x",
      blockedCategory: "review",
      reason: "unresolvable conflict",
    });
    const rejected = await orchestrator.resolveReview(task.id, false, "conflict confirmed");
    assert.equal(rejected.status, "failed");
    assert.match(rejected.history.at(-1)?.reason ?? "", /review rejected/);
  });

  test("BLOCKED with approval category routes to the approval queue; approval runs success gates", async () => {
    const { orchestrator } = makeOrchestrator();
    orchestrator.registerPipeline({
      pipelineId: "p",
      stages: ["s"],
      gates: { s: [() => ({ gate: "always-pass", passed: true })] },
    });
    const { task } = await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k" });
    const claim = await orchestrator.claimNext("worker-a");
    const blocked = await orchestrator.complete(claim!.id, claim!.attemptToken!, {
      outcome: "BLOCKED",
      summary: "touches payments config",
      blockedCategory: "approval",
      reason: "human approval required before proceeding",
    });
    assert.equal(blocked.status, "approval");

    const approved = await orchestrator.resolveApproval(task.id, true, "Sergey approved in writing");
    assert.equal(approved.status, "done", "approval must run the normal success path including gates");
    assert.equal(orchestrator.getPipeline("p")?.status, "done");
  });

  test("BLOCKED with policy category retries until maxAttempts then fails — no infinite spin", async () => {
    const { store, orchestrator } = makeOrchestrator();
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 2 });

    for (let cycle = 0; cycle < 5; cycle += 1) {
      const claim = await orchestrator.claimNext("worker-a");
      if (!claim) break;
      const completed = await orchestrator.complete(claim.id, claim.attemptToken!, {
        outcome: "BLOCKED",
        summary: "policy violation",
        blockedCategory: "policy",
        reason: "edits outside allowed paths",
      });
      if (completed.status === "failed") break;
    }
    assert.equal((await orchestrator.claimNext("worker-a")), null, "task must be terminal, not spinning");
    const tasks = Object.values(store.snapshot().tasks);
    assert.equal(tasks[0]?.status, "failed");
  });

  test("APPROVAL_REQUIRED parks the task until a human resolves it", async () => {
    const { orchestrator } = makeOrchestrator();
    const { task } = await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k" });
    const claim = await orchestrator.claimNext("worker-a");
    const completed = await orchestrator.complete(claim!.id, claim!.attemptToken!, {
      outcome: "APPROVAL_REQUIRED",
      summary: "irreversible action proposed",
      reason: "publishing sitemap changes",
    });
    assert.equal(completed.status, "approval");
    assert.equal((await orchestrator.claimNext("worker-b"))?.id, undefined, "approval tasks are not claimable");
    const rejected = await orchestrator.resolveApproval(task.id, false, "not now");
    assert.equal(rejected.status, "failed");
  });
});
