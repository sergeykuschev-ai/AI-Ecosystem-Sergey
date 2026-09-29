import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { createCliAdapter, Orchestrator, StateStore, WorkerRouter } from "@/agent-control";
import type { TaskRecord, TopLevelResolver } from "@/agent-control";

const identityResolver: TopLevelResolver = async (dir) => dir;
const throwingResolver: TopLevelResolver = async () => {
  throw new Error("git exited 128: not a git repository");
};

function tmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "agent-control-cli-"));
}

describe("AgentControl CLI adapter readiness", () => {
  test("readiness passes only when the probe passes and the project root is the exact Git top-level", async () => {
    const cwd = tmpDir();
    const adapter = createCliAdapter({
      name: "kimi",
      readinessCommand: process.execPath,
      readinessArgs: ["--version"],
      executeCommand: process.execPath,
      cwd,
      project: { projectPath: cwd, resolveTopLevel: identityResolver },
    });
    const result = await adapter.readiness();
    assert.equal(result.ok, true);
    assert.match(result.detail, /readiness probe passed/);
  });

  test("readiness fails closed when the project path is not a Git top-level, even if the probe would pass", async () => {
    const cwd = tmpDir();
    const adapter = createCliAdapter({
      name: "kimi",
      readinessCommand: process.execPath,
      readinessArgs: ["--version"],
      executeCommand: process.execPath,
      cwd,
      project: { projectPath: cwd, resolveTopLevel: throwingResolver },
    });
    const result = await adapter.readiness();
    assert.equal(result.ok, false);
    assert.match(result.detail, /project root validation failed/);
    assert.match(result.detail, /fail closed/);
  });

  test("readiness reports probe failure with exit detail", async () => {
    const adapter = createCliAdapter({
      name: "codex",
      readinessCommand: process.execPath,
      readinessArgs: ["-e", "process.exit(3)"],
      executeCommand: process.execPath,
      cwd: tmpDir(),
    });
    const result = await adapter.readiness();
    assert.equal(result.ok, false);
    assert.match(result.detail, /exited 3/);
  });
});

describe("AgentControl CLI adapter execution bounds", () => {
  test("execute passes a bounded JSON payload on stdin and parses the worker outcome", async () => {
    const adapter = createCliAdapter({
      name: "codex",
      readinessCommand: process.execPath,
      readinessArgs: ["--version"],
      executeCommand: process.execPath,
      executeArgs: [
        "-e",
        "let d='';process.stdin.on('data',(c)=>d+=c);process.stdin.on('end',()=>{const t=JSON.parse(d);console.log(JSON.stringify({outcome:'SUCCESS',summary:'ran '+t.stage}));});",
      ],
      cwd: tmpDir(),
    });
    const result = await adapter.execute(fakeTask(), new AbortController().signal);
    assert.deepEqual(result, { outcome: "SUCCESS", summary: "ran implement" });
  });

  test("execute truncates oversized payloads instead of sending unbounded prompts", async () => {
    const adapter = createCliAdapter({
      name: "codex",
      readinessCommand: process.execPath,
      readinessArgs: ["--version"],
      executeCommand: process.execPath,
      executeArgs: [
        "-e",
        "let d='';process.stdin.on('data',(c)=>d+=c);process.stdin.on('end',()=>{const t=JSON.parse(d);console.log(JSON.stringify({outcome:t.payload.truncated?'SUCCESS':'FAIL',summary:'payload chars '+d.length}));});",
      ],
      cwd: tmpDir(),
      maxPayloadChars: 200,
    });
    const task = fakeTask();
    task.payload = { huge: "x".repeat(10_000) };
    const result = await adapter.execute(task, new AbortController().signal);
    assert.equal(result.outcome, "SUCCESS", "adapter must send the explicit truncated payload, never the oversized one");
    const sentChars = Number((result.summary ?? "").replace("payload chars ", ""));
    assert.ok(sentChars <= 400, `serialized prompt must stay bounded, got ${sentChars}`);
  });

  test("non-JSON worker stdout is an explicit FAIL outcome, never silent success", async () => {
    const adapter = createCliAdapter({
      name: "codex",
      readinessCommand: process.execPath,
      readinessArgs: ["--version"],
      executeCommand: process.execPath,
      executeArgs: ["-e", "console.log('done, trust me')"],
      cwd: tmpDir(),
    });
    const result = await adapter.execute(fakeTask(), new AbortController().signal);
    assert.equal(result.outcome, "FAIL");
    assert.match(result.summary ?? "", /non-JSON/);
  });

  test("non-zero worker exit throws so the router records a retryable technical failure", async () => {
    const adapter = createCliAdapter({
      name: "codex",
      readinessCommand: process.execPath,
      readinessArgs: ["--version"],
      executeCommand: process.execPath,
      executeArgs: ["-e", "process.exit(1)"],
      cwd: tmpDir(),
    });
    await assert.rejects(adapter.execute(fakeTask(), new AbortController().signal), /exited 1/);
  });
});

describe("AgentControl CLI adapter routing safety", () => {
  test("an adapter whose project root fails validation never receives work; the blocker is recorded and the task stays truthful", async () => {
    const store = new StateStore(tmpDir());
    const orchestrator = new Orchestrator(store);
    const adapter = createCliAdapter({
      name: "kimi",
      readinessCommand: process.execPath,
      readinessArgs: ["--version"],
      executeCommand: process.execPath,
      cwd: tmpDir(),
      project: { projectPath: tmpDir(), resolveTopLevel: throwingResolver },
    });
    const router = new WorkerRouter({ orchestrator, adapters: [adapter], workerId: "router-1", readinessTtlMs: 0 });
    await orchestrator.enqueue({ pipelineId: "p", stage: "s", logicalKey: "k", maxAttempts: 2 });

    const result = await router.runOnce();
    assert.equal(result.status, "no_ready_adapter");
    if (result.status === "no_ready_adapter") {
      assert.match(result.blockers[0]?.detail ?? "", /project root validation failed/);
    }
    const task = Object.values(store.snapshot().tasks)[0];
    assert.equal(task?.status, "pending");
    assert.equal(task?.attempts, 1);
    assert.ok(store.readAudit().some((e) => e.type === "readiness_failed" && /project root validation failed/.test(e.reason ?? "")));
  });
});

function fakeTask(): TaskRecord {
  return {
    id: "task-1",
    pipelineId: "p",
    stage: "implement",
    logicalKey: "k",
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    workerId: "w",
    attemptToken: "token",
    lease: null,
    blockedCategory: null,
    blockedReason: null,
    payload: { hint: "smoke" },
    history: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
