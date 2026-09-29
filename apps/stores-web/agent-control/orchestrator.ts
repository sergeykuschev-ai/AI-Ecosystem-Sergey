import { randomUUID } from "node:crypto";
import { newAttempt, releaseLease, DEFAULT_LEASE_MS } from "./locking";
import type { QueueData, StateStore } from "./state-store";
import type {
  AuditEvent,
  AuditType,
  BlockedCategory,
  GateCheck,
  GateResult,
  PidProbe,
  PipelineDefinition,
  PipelineState,
  TaskRecord,
  TaskStatus,
  WorkerResult,
} from "./types";
import { defaultPidProbe } from "./types";

export const DEFAULT_MAX_ATTEMPTS = 3;

export interface EnqueueInput {
  pipelineId: string;
  stage: string;
  logicalKey: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}

export interface ClaimOptions {
  leaseMs?: number;
  pid?: number;
}

const ACTIVE_STATUSES: TaskStatus[] = ["pending", "running", "review", "approval"];

export class Orchestrator {
  private readonly definitions = new Map<string, PipelineDefinition>();

  constructor(
    private readonly store: StateStore,
    private readonly opts: { now?: () => Date } = {},
  ) {}

  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  registerPipeline(definition: PipelineDefinition): void {
    this.definitions.set(definition.pipelineId, definition);
  }

  /**
   * Enqueue a logical task. At most one active (pending/running/review/
   * approval) record may exist per (pipelineId, stage, logicalKey); a repeat
   * enqueue returns the existing record with created=false instead of
   * creating a duplicate execution.
   */
  async enqueue(input: EnqueueInput): Promise<{ task: TaskRecord; created: boolean }> {
    const at = this.now();
    return this.store.transact((q) => {
      for (const existing of Object.values(q.tasks)) {
        if (
          existing.pipelineId === input.pipelineId &&
          existing.stage === input.stage &&
          existing.logicalKey === input.logicalKey &&
          ACTIVE_STATUSES.includes(existing.status)
        ) {
          this.store.audit({
            type: "duplicate_suppressed",
            at: at.toISOString(),
            pipelineId: input.pipelineId,
            taskId: existing.id,
            stage: input.stage,
            reason: `logical task ${input.logicalKey} already active with status ${existing.status}`,
          });
          return { task: structuredClone(existing), created: false };
        }
      }
      if (!q.pipelines[input.pipelineId] && this.definitions.has(input.pipelineId)) {
        this.freshPipeline(q, input.pipelineId, at);
      }
      const task = this.newTaskRecord(q, input, at);
      this.store.audit({
        type: "enqueued",
        at: at.toISOString(),
        pipelineId: task.pipelineId,
        taskId: task.id,
        stage: task.stage,
        details: { logicalKey: task.logicalKey, maxAttempts: task.maxAttempts, by: "enqueue" },
      });
      return { task: structuredClone(task), created: true };
    });
  }

  /**
   * Claim the oldest pending task for a worker. Claiming is exclusive and
   * atomically increments `attempts` (see locking.newAttempt) before any
   * worker code runs, so maxAttempts is enforced exactly.
   */
  async claimNext(workerId: string, opts: ClaimOptions = {}): Promise<TaskRecord | null> {
    const at = this.now();
    return this.store.transact((q) => {
      const candidates = Object.values(q.tasks)
        .filter((t) => t.status === "pending")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const task = candidates[0];
      if (!task) return null;
      newAttempt(task, workerId, at, opts.leaseMs ?? DEFAULT_LEASE_MS, opts.pid ?? process.pid);
      this.store.audit({
        type: "claimed",
        at: at.toISOString(),
        pipelineId: task.pipelineId,
        taskId: task.id,
        stage: task.stage,
        workerId,
        details: { attempts: task.attempts, attemptToken: task.attemptToken },
      });
      return structuredClone(task);
    });
  }

  /**
   * Route a worker result. The attempt token must match the active lease;
   * stale completions are rejected so a lagging worker can never overwrite a
   * newer attempt. Exit code 0 is irrelevant here — only the explicit
   * WorkerOutcome drives routing.
   */
  async complete(taskId: string, attemptToken: string, result: WorkerResult): Promise<TaskRecord> {
    const at = this.now();
    return this.store.transact(async (q) => {
      const task = q.tasks[taskId];
      if (!task) throw new Error(`unknown task ${taskId}`);
      if (task.status !== "running") {
        throw new Error(`task ${taskId} is ${task.status}; only running tasks accept completions`);
      }
      if (task.attemptToken !== attemptToken) {
        this.store.audit({
          type: "stale_token_rejected",
          at: at.toISOString(),
          pipelineId: task.pipelineId,
          taskId: task.id,
          stage: task.stage,
          workerId: task.workerId ?? undefined,
          reason: "completion token does not match the active attempt",
        });
        throw new Error(`stale attempt token for task ${taskId}`);
      }
      const workerId = task.workerId ?? undefined;
      releaseLease(task, at);
      task.history.push({
        at: at.toISOString(),
        event: "completed",
        workerId,
        outcome: result.outcome,
        reason: result.reason,
        attempts: task.attempts,
      });

      switch (result.outcome) {
        case "SUCCESS":
          await this.succeedTask(q, task, at);
          break;
        case "RETRY":
          this.retryOrFail(q, task, at, result.reason ?? "retryable technical failure");
          break;
        case "BLOCKED": {
          const category: BlockedCategory = result.blockedCategory ?? "policy";
          this.routeBlocked(q, task, at, category, result.reason ?? "blocked");
          break;
        }
        case "APPROVAL_REQUIRED":
          task.status = "approval";
          task.blockedCategory = "approval";
          task.blockedReason = result.reason ?? "human approval required";
          task.updatedAt = at.toISOString();
          this.auditBlocked(task, at, "approval");
          break;
        case "FAIL":
          this.failTerminal(q, task, at, result.reason ?? "terminal failure reported by worker");
          break;
      }
      return structuredClone(task);
    });
  }

  /** Resolve a task parked in review. Approved tasks return to pending. */
  async resolveReview(taskId: string, approved: boolean, reason: string): Promise<TaskRecord> {
    const at = this.now();
    return this.store.transact((q) => {
      const task = q.tasks[taskId];
      if (!task) throw new Error(`unknown task ${taskId}`);
      if (task.status !== "review") throw new Error(`task ${taskId} is ${task.status}; not in review`);
      this.store.audit({
        type: "review_resolved",
        at: at.toISOString(),
        pipelineId: task.pipelineId,
        taskId: task.id,
        stage: task.stage,
        reason,
        details: { approved },
      });
      if (approved) {
        task.status = "pending";
        task.blockedCategory = null;
        task.blockedReason = null;
        task.updatedAt = at.toISOString();
      } else {
        this.failTerminal(q, task, at, `review rejected: ${reason}`);
      }
      return structuredClone(task);
    });
  }

  /** Resolve a task parked in the approval queue. */
  async resolveApproval(taskId: string, approved: boolean, reason: string): Promise<TaskRecord> {
    const at = this.now();
    return this.store.transact(async (q) => {
      const task = q.tasks[taskId];
      if (!task) throw new Error(`unknown task ${taskId}`);
      if (task.status !== "approval") throw new Error(`task ${taskId} is ${task.status}; not awaiting approval`);
      this.store.audit({
        type: "approval_resolved",
        at: at.toISOString(),
        pipelineId: task.pipelineId,
        taskId: task.id,
        stage: task.stage,
        reason,
        details: { approved },
      });
      if (!approved) {
        this.failTerminal(q, task, at, `approval rejected: ${reason}`);
        return structuredClone(task);
      }
      task.blockedCategory = null;
      task.blockedReason = null;
      await this.succeedTask(q, task, at);
      return structuredClone(task);
    });
  }

  /**
   * Idempotent pipeline runner: safe to invoke on every schedule tick.
   * - Does nothing for done/failed pipelines.
   * - Recovers interrupted transitions: if the current stage already has a
   *   done task (e.g. the process died between marking done and advancing),
   *   it advances exactly once, without re-executing anything.
   * - Enqueues the current stage task only when no active or done record
   *   exists, so repeated runs never duplicate work.
   */
  async runPipelineOnce(pipelineId: string): Promise<{ enqueued: number; advanced: boolean }> {
    const at = this.now();
    let enqueued = 0;
    let advanced = false;
    await this.store.transact((q) => {
      const definition = this.definitions.get(pipelineId);
      if (!definition) throw new Error(`unknown pipeline ${pipelineId}`);
      let pipeline = q.pipelines[pipelineId];
      if (!pipeline) {
        pipeline = this.freshPipeline(q, pipelineId, at);
      }
      if (pipeline.status !== "running") return;

      let stageNow = definition.stages[pipeline.stageIndex];
      const stageTasks = Object.values(q.tasks).filter(
        (t) => t.pipelineId === pipelineId && t.stage === stageNow,
      );
      if (stageTasks.some((t) => t.status === "done")) {
        this.advanceOneStage(q, pipeline, definition, stageNow, at, "recovered interrupted transition");
        advanced = true;
        if (pipeline.status !== "running") return;
        stageNow = definition.stages[pipeline.stageIndex];
      }
      const active = Object.values(q.tasks).some(
        (t) => t.pipelineId === pipelineId && t.stage === stageNow && ACTIVE_STATUSES.includes(t.status),
      );
      const doneAlready = Object.values(q.tasks).some(
        (t) => t.pipelineId === pipelineId && t.stage === stageNow && t.status === "done",
      );
      if (!active && !doneAlready) {
        const task = this.newTaskRecord(
          q,
          { pipelineId, stage: stageNow, logicalKey: stageNow },
          at,
        );
        enqueued += 1;
        this.store.audit({
          type: "enqueued",
          at: at.toISOString(),
          pipelineId,
          taskId: task.id,
          stage: task.stage,
          details: { logicalKey: task.logicalKey, by: "pipeline-runner" },
        });
      }
    });
    return { enqueued, advanced };
  }

  /**
   * Watchdog: deterministically reconciles stale `running` tasks. A running
   * task whose lease is expired or whose pid is dead is returned to pending
   * (attempts preserved, so maxAttempts still applies) or marked failed when
   * attempts are exhausted. History and audit record why.
   */
  async reconcile(opts: { pidProbe?: PidProbe; now?: Date } = {}): Promise<{ requeued: number; failed: number }> {
    const at = opts.now ?? this.now();
    const probe = opts.pidProbe ?? defaultPidProbe;
    let requeued = 0;
    let failed = 0;
    await this.store.transact((q) => {
      for (const task of Object.values(q.tasks)) {
        if (task.status !== "running") continue;
        const lease = task.lease;
        const expired = !lease || at.getTime() > Date.parse(lease.expiresAt);
        const deadPid = lease ? !probe(lease.pid) : true;
        if (!expired && !deadPid) continue;
        const reason = !lease
          ? "running task has no lease"
          : deadPid
            ? `worker pid ${lease.pid} is dead`
            : `lease expired at ${lease.expiresAt}`;
        releaseLease(task, at);
        task.history.push({ at: at.toISOString(), event: "watchdog_reconciled", reason, attempts: task.attempts });
        if (task.attempts < task.maxAttempts) {
          task.status = "pending";
          task.updatedAt = at.toISOString();
          requeued += 1;
          this.store.audit({
            type: "watchdog_requeued",
            at: at.toISOString(),
            pipelineId: task.pipelineId,
            taskId: task.id,
            stage: task.stage,
            reason,
            details: { attempts: task.attempts, maxAttempts: task.maxAttempts },
          });
        } else {
          failed += 1;
          this.failTerminal(q, task, at, `${reason}; attempts exhausted`);
          this.store.audit({
            type: "watchdog_failed",
            at: at.toISOString(),
            pipelineId: task.pipelineId,
            taskId: task.id,
            stage: task.stage,
            reason,
          });
        }
      }
    });
    return { requeued, failed };
  }

  getTask(taskId: string): TaskRecord | null {
    return this.store.snapshot().tasks[taskId] ?? null;
  }

  getPipeline(pipelineId: string): PipelineState | null {
    return this.store.snapshot().pipelines[pipelineId] ?? null;
  }

  /** Structured audit hook for adapters/routers (readiness, assignment, crashes). */
  async auditEvent(type: AuditType, fields: Omit<AuditEvent, "seq" | "at" | "type"> = {}): Promise<void> {
    const at = this.now();
    await this.store.transact(() => {
      this.store.audit({ type, at: at.toISOString(), ...fields });
    });
  }

  // --- transaction-scoped internals (never open nested transactions) ---

  private async runGates(task: TaskRecord): Promise<GateResult[]> {
    const definition = this.definitions.get(task.pipelineId);
    const checks: GateCheck[] = definition?.gates?.[task.stage] ?? [];
    const results: GateResult[] = [];
    for (const check of checks) {
      results.push(await check(task));
    }
    return results;
  }

  private async succeedTask(q: QueueData, task: TaskRecord, at: Date): Promise<void> {
    const gateResults = await this.runGates(task);
    for (const gate of gateResults) {
      this.store.audit({
        type: gate.passed ? "gate_passed" : "gate_failed",
        at: at.toISOString(),
        pipelineId: task.pipelineId,
        taskId: task.id,
        stage: task.stage,
        reason: gate.passed ? undefined : gate.reason,
        details: { gate: gate.gate },
      });
    }
    const failedGate = gateResults.find((g) => !g.passed);
    if (failedGate) {
      // A failed gate never advances the pipeline. The stage is retried
      // (the attempt was already consumed) until maxAttempts, then fails.
      this.retryOrFail(q, task, at, `gate failed: ${failedGate.gate} — ${failedGate.reason ?? "no reason"}`);
      return;
    }
    task.status = "done";
    task.updatedAt = at.toISOString();
    this.store.audit({
      type: "completed",
      at: at.toISOString(),
      pipelineId: task.pipelineId,
      taskId: task.id,
      stage: task.stage,
      outcome: "SUCCESS",
    });
    const definition = this.definitions.get(task.pipelineId);
    const pipeline = q.pipelines[task.pipelineId];
    if (!definition || !pipeline || pipeline.status !== "running") return;
    const currentStage = definition.stages[pipeline.stageIndex];
    if (currentStage !== task.stage) return;
    this.advanceOneStage(q, pipeline, definition, task.stage, at, "stage completed");
    this.enqueueNextStage(q, pipeline, definition, at);
  }

  private retryOrFail(q: QueueData, task: TaskRecord, at: Date, reason: string): void {
    void q;
    task.blockedCategory = null;
    task.blockedReason = null;
    if (task.attempts < task.maxAttempts) {
      task.status = "pending";
      task.updatedAt = at.toISOString();
      task.history.push({
        at: at.toISOString(),
        event: "retry_scheduled",
        reason,
        attempts: task.attempts,
      });
      this.store.audit({
        type: "retry_scheduled",
        at: at.toISOString(),
        pipelineId: task.pipelineId,
        taskId: task.id,
        stage: task.stage,
        reason,
        details: { attempts: task.attempts, maxAttempts: task.maxAttempts },
      });
    } else {
      this.failTerminal(q, task, at, `${reason} (attempts exhausted: ${task.attempts}/${task.maxAttempts})`);
    }
  }

  private routeBlocked(q: QueueData, task: TaskRecord, at: Date, category: BlockedCategory, reason: string): void {
    task.blockedCategory = category;
    task.blockedReason = reason;
    if (category === "review" || category === "approval") {
      // Safe parking stages: no spinning; a reviewer/approver resolves them.
      task.status = category;
      task.updatedAt = at.toISOString();
      this.auditBlocked(task, at, category);
      return;
    }
    // policy: retryable only until maxAttempts, then terminal failed.
    this.retryOrFail(q, task, at, `policy blocked: ${reason}`);
  }

  private auditBlocked(task: TaskRecord, at: Date, route: BlockedCategory): void {
    this.store.audit({
      type: "blocked_routed",
      at: at.toISOString(),
      pipelineId: task.pipelineId,
      taskId: task.id,
      stage: task.stage,
      outcome: "BLOCKED",
      reason: task.blockedReason ?? undefined,
      details: { route },
    });
  }

  private failTerminal(q: QueueData, task: TaskRecord, at: Date, reason: string): void {
    void q;
    task.status = "failed";
    task.updatedAt = at.toISOString();
    task.history.push({ at: at.toISOString(), event: "terminal_failure", reason, attempts: task.attempts });
    this.store.audit({
      type: "terminal_failure",
      at: at.toISOString(),
      pipelineId: task.pipelineId,
      taskId: task.id,
      stage: task.stage,
      reason,
      details: { attempts: task.attempts, maxAttempts: task.maxAttempts },
    });
    const pipeline = q.pipelines[task.pipelineId];
    if (pipeline && pipeline.status === "running") {
      pipeline.status = "failed";
      pipeline.updatedAt = at.toISOString();
      this.store.audit({
        type: "pipeline_failed",
        at: at.toISOString(),
        pipelineId: task.pipelineId,
        taskId: task.id,
        stage: task.stage,
        reason,
      });
    }
  }

  private advanceOneStage(
    q: QueueData,
    pipeline: PipelineState,
    definition: PipelineDefinition,
    stage: string,
    at: Date,
    reason: string,
  ): void {
    void q;
    if (!pipeline.completedStages.includes(stage)) {
      pipeline.completedStages.push(stage);
    }
    pipeline.stageIndex = Math.min(pipeline.stageIndex + 1, definition.stages.length);
    pipeline.updatedAt = at.toISOString();
    this.store.audit({
      type: "stage_advanced",
      at: at.toISOString(),
      pipelineId: pipeline.pipelineId,
      stage,
      reason,
      details: { completedStages: [...pipeline.completedStages] },
    });
    if (pipeline.stageIndex >= definition.stages.length) {
      pipeline.status = "done";
      this.store.audit({ type: "pipeline_done", at: at.toISOString(), pipelineId: pipeline.pipelineId });
    }
  }

  private enqueueNextStage(
    q: QueueData,
    pipeline: PipelineState,
    definition: PipelineDefinition,
    at: Date,
  ): void {
    if (pipeline.status !== "running") return;
    const nextStage = definition.stages[pipeline.stageIndex];
    const alreadyActive = Object.values(q.tasks).some(
      (t) => t.pipelineId === pipeline.pipelineId && t.stage === nextStage && ACTIVE_STATUSES.includes(t.status),
    );
    if (alreadyActive) return;
    const task = this.newTaskRecord(q, { pipelineId: pipeline.pipelineId, stage: nextStage, logicalKey: nextStage }, at);
    this.store.audit({
      type: "enqueued",
      at: at.toISOString(),
      pipelineId: task.pipelineId,
      taskId: task.id,
      stage: task.stage,
      details: { logicalKey: task.logicalKey, autoAdvanced: true },
    });
  }

  private newTaskRecord(q: QueueData, input: EnqueueInput, at: Date): TaskRecord {
    const iso = at.toISOString();
    const task: TaskRecord = {
      id: randomUUID(),
      pipelineId: input.pipelineId,
      stage: input.stage,
      logicalKey: input.logicalKey,
      status: "pending",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      workerId: null,
      attemptToken: null,
      lease: null,
      blockedCategory: null,
      blockedReason: null,
      payload: input.payload ?? {},
      history: [],
      createdAt: iso,
      updatedAt: iso,
    };
    q.tasks[task.id] = task;
    return task;
  }

  private freshPipeline(q: QueueData, pipelineId: string, at: Date): PipelineState {
    const pipeline: PipelineState = {
      pipelineId,
      stageIndex: 0,
      completedStages: [],
      status: "running",
      updatedAt: at.toISOString(),
    };
    q.pipelines[pipelineId] = pipeline;
    this.store.audit({
      type: "enqueued",
      at: at.toISOString(),
      pipelineId,
      reason: "pipeline state initialized by runner",
    });
    return pipeline;
  }
}
