import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { Orchestrator, StateStore } from "@/agent-control";
import type { PipelineDefinition, TaskRecord } from "@/agent-control";

const PIPELINE = "seo-pipeline";

function definition(gates?: PipelineDefinition["gates"]): PipelineDefinition {
  return { pipelineId: PIPELINE, stages: ["implement", "code-review", "reality-qa"], gates };
}

function makeHarness(gates?: PipelineDefinition["gates"]) {
  const dir = mkdtempSync(path.join(tmpdir(), "agent-control-pipeline-"));
  const store = new StateStore(dir);
  const orchestrator = new Orchestrator(store);
  orchestrator.registerPipeline(definition(gates));
  return { dir, store, orchestrator };
}

describe("AgentControl gates and pipeline advancement", () => {
  test("SUCCESS advances the pipeline to the next stage only after all gates pass", async () => {
    const { orchestrator } = makeHarness({
      implement: [() => ({ gate: "artifact-exists", passed: true })],
    });
    const { task } = await orchestrator.enqueue({ pipelineId: PIPELINE, stage: "implement", logicalKey: "implement" });
    const claim = await orchestrator.claimNext("worker-a");
    const completed = await orchestrator.complete(claim!.id, claim!.attemptToken!, { outcome: "SUCCESS", summary: "implemented" });

    assert.equal(completed.status, "done");
    const pipeline = orchestrator.getPipeline(PIPELINE);
    assert.equal(pipeline?.status, "running");
    assert.deepEqual(pipeline?.completedStages, ["implement"]);
    assert.equal(pipeline?.stageIndex, 1);

    const next = await orchestrator.claimNext("worker-b");
    assert.equal(next?.stage, "code-review");
    assert.notEqual(next?.id, task.id);
  });

  test("a failed gate does not advance the pipeline and the stage is retried", async () => {
    const { store, orchestrator } = makeHarness({
      implement: [(task: TaskRecord) => ({
        gate: "artifact-exists",
        passed: task.payload.artifact === "ok",
        reason: task.payload.artifact === "ok" ? undefined : "expected artifact missing",
      })],
    });
    const { task } = await orchestrator.enqueue({
      pipelineId: PIPELINE,
      stage: "implement",
      logicalKey: "implement",
      payload: { artifact: "missing" },
      maxAttempts: 2,
    });

    const firstClaim = await orchestrator.claimNext("worker-a");
    const firstTry = await orchestrator.complete(firstClaim!.id, firstClaim!.attemptToken!, { outcome: "SUCCESS", summary: "done?" });
    assert.equal(firstTry.status, "pending", "gate failure must return the task to pending, not advance");
    assert.equal(firstTry.attempts, 1);
    let pipeline = orchestrator.getPipeline(PIPELINE);
    assert.equal(pipeline?.stageIndex, 0, "pipeline must stay on the failed stage");
    assert.deepEqual(pipeline?.completedStages, []);

    // Second attempt produces the artifact; now the pipeline may advance.
    await store.transact((q) => {
      q.tasks[task.id].payload = { ...q.tasks[task.id].payload, artifact: "ok" };
    });
    const secondClaim = await orchestrator.claimNext("worker-a");
    assert.equal(secondClaim?.attempts, 2);
    const secondTry = await orchestrator.complete(secondClaim!.id, secondClaim!.attemptToken!, { outcome: "SUCCESS", summary: "done" });
    assert.equal(secondTry.status, "done");
    pipeline = orchestrator.getPipeline(PIPELINE);
    assert.equal(pipeline?.stageIndex, 1);
  });

  test("gate failure at maxAttempts fails the pipeline terminally", async () => {
    const { orchestrator } = makeHarness({
      implement: [() => ({ gate: "always-fail", passed: false, reason: "artifact never appears" })],
    });
    await orchestrator.enqueue({ pipelineId: PIPELINE, stage: "implement", logicalKey: "implement", maxAttempts: 2 });
    for (let i = 0; i < 2; i += 1) {
      const claim = await orchestrator.claimNext("worker-a");
      await orchestrator.complete(claim!.id, claim!.attemptToken!, { outcome: "SUCCESS", summary: "claims success" });
    }
    assert.equal(orchestrator.getPipeline(PIPELINE)?.status, "failed");
  });

  test("terminal failure of any stage fails the whole pipeline", async () => {
    const { orchestrator } = makeHarness();
    await orchestrator.enqueue({ pipelineId: PIPELINE, stage: "implement", logicalKey: "implement" });
    const claim = await orchestrator.claimNext("worker-a");
    await orchestrator.complete(claim!.id, claim!.attemptToken!, { outcome: "FAIL", summary: "broken", reason: "tests red" });
    assert.equal(orchestrator.getPipeline(PIPELINE)?.status, "failed");
    const runner = await orchestrator.runPipelineOnce(PIPELINE);
    assert.equal(runner.enqueued, 0, "failed pipelines must not be restarted by the runner");
  });

  test("final stage completion marks the pipeline done", async () => {
    const { orchestrator } = makeHarness();
    for (const stage of ["implement", "code-review", "reality-qa"]) {
      await orchestrator.enqueue({ pipelineId: PIPELINE, stage, logicalKey: stage });
      const claim = await orchestrator.claimNext("worker-a");
      await orchestrator.complete(claim!.id, claim!.attemptToken!, { outcome: "SUCCESS", summary: `${stage} ok` });
    }
    const pipeline = orchestrator.getPipeline(PIPELINE);
    assert.equal(pipeline?.status, "done");
    assert.deepEqual(pipeline?.completedStages, ["implement", "code-review", "reality-qa"]);
  });
});

describe("AgentControl idempotent pipeline-runner", () => {
  test("repeated runPipelineOnce invocations never duplicate a pending/running/done stage", async () => {
    const { store, orchestrator } = makeHarness();
    const first = await orchestrator.runPipelineOnce(PIPELINE);
    assert.equal(first.enqueued, 1);
    const second = await orchestrator.runPipelineOnce(PIPELINE);
    assert.equal(second.enqueued, 0, "second tick must not enqueue a duplicate");
    const third = await orchestrator.runPipelineOnce(PIPELINE);
    assert.equal(third.enqueued, 0);

    const claim = await orchestrator.claimNext("worker-a");
    const whileRunning = await orchestrator.runPipelineOnce(PIPELINE);
    assert.equal(whileRunning.enqueued, 0, "running stage must not be duplicated");

    await orchestrator.complete(claim!.id, claim!.attemptToken!, { outcome: "SUCCESS", summary: "ok" });
    const tasks = Object.values(store.snapshot().tasks);
    assert.equal(tasks.filter((t) => t.stage === "implement").length, 1);
    assert.equal(tasks.filter((t) => t.stage === "code-review").length, 1, "advance enqueued the next stage exactly once");
  });

  test("enqueue of the same logical task while pending is suppressed", async () => {
    const { store, orchestrator } = makeHarness();
    await orchestrator.runPipelineOnce(PIPELINE);
    const duplicate = await orchestrator.enqueue({ pipelineId: PIPELINE, stage: "implement", logicalKey: "implement" });
    assert.equal(duplicate.created, false);
    assert.equal(Object.keys(store.snapshot().tasks).length, 1);
  });

  test("recovers an interrupted transition (task done, pipeline not advanced) without re-executing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agent-control-recovery-"));

    // Process 1: runner creates pipeline + implement task, then exits.
    const process1 = new Orchestrator(new StateStore(dir));
    process1.registerPipeline(definition());
    await process1.runPipelineOnce(PIPELINE);

    // Process 2 simulates a crash mid-transition: it completes the task
    // (marks done) but dies before advancing the pipeline. We model the
    // missing advancement with an engine that has no definition registered.
    const process2 = new Orchestrator(new StateStore(dir));
    const claim = await process2.claimNext("worker-a");
    await process2.complete(claim!.id, claim!.attemptToken!, { outcome: "SUCCESS", summary: "done before crash" });
    assert.equal(process2.getPipeline(PIPELINE)?.stageIndex, 0, "interrupted: pipeline did not advance");

    // Process 3 (restart) must advance exactly once and enqueue the next
    // stage — never re-run the completed stage.
    const process3 = new Orchestrator(new StateStore(dir));
    process3.registerPipeline(definition());
    const recovered = await process3.runPipelineOnce(PIPELINE);
    assert.equal(recovered.advanced, true);
    assert.equal(recovered.enqueued, 1);

    const state = new StateStore(dir).snapshot();
    const implementTasks = Object.values(state.tasks).filter((t) => t.stage === "implement");
    assert.equal(implementTasks.length, 1);
    assert.equal(implementTasks[0].status, "done");
    assert.equal(implementTasks[0].attempts, 1, "no re-execution of the completed stage");

    const again = await process3.runPipelineOnce(PIPELINE);
    assert.equal(again.enqueued, 0, "recovery must be idempotent too");
  });
});
