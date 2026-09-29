import type { Orchestrator } from "./orchestrator";
import type { ReadinessResult, TaskRecord, WorkerAdapter, WorkerResult } from "./types";

export interface AdapterBlocker {
  adapter: string;
  detail: string;
  checkedAt: string;
}

export type RouterCycleResult =
  | { status: "idle" }
  | { status: "completed"; taskId: string; adapter: string; outcome: WorkerResult["outcome"] }
  | { status: "no_ready_adapter"; taskId: string; attempts: number; blockers: AdapterBlocker[] }
  | { status: "stale_completion"; taskId: string; reason: string };

export interface WorkerRouterOptions {
  orchestrator: Orchestrator;
  /** Claim owner name recorded in the audit trail. */
  workerId?: string;
  adapters: WorkerAdapter[];
  /** Selection policy over the READY adapters. Default: first ready adapter. */
  pick?: (task: TaskRecord, ready: WorkerAdapter[]) => WorkerAdapter | null;
  readinessTtlMs?: number;
  executeTimeoutMs?: number;
  maxSummaryChars?: number;
  maxReasonChars?: number;
}

const DEFAULT_EXECUTE_TIMEOUT_MS = 120_000;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[truncated ${text.length - max} chars]`;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Routes claimed tasks to worker adapters (Kimi, Codex, …).
 *
 * Safety properties:
 * - A task is executed by exactly one adapter per claim; the exclusive claim
 *   in the orchestrator guarantees the same logical task never runs
 *   simultaneously in two adapters.
 * - Adapters are used only after an authenticated/bounded readiness check;
 *   a not-ready adapter is recorded as a blocker instead of being routed to
 *   blindly.
 * - Execution is bounded by an AbortSignal timeout; results are length-capped.
 * - Worker crashes/timeouts are reported as retryable technical failures, so
 *   attempts and maxAttempts stay truthful.
 */
export class WorkerRouter {
  private readonly readinessCache = new Map<string, { at: number; result: ReadinessResult }>();

  constructor(private readonly opts: WorkerRouterOptions) {}

  private get orchestrator(): Orchestrator {
    return this.opts.orchestrator;
  }

  private get workerId(): string {
    return this.opts.workerId ?? "worker-router";
  }

  async runOnce(): Promise<RouterCycleResult> {
    const task = await this.orchestrator.claimNext(this.workerId);
    if (!task) return { status: "idle" };
    const token = task.attemptToken;
    if (!token) {
      return { status: "stale_completion", taskId: task.id, reason: "claimed task had no attempt token" };
    }

    const ready: WorkerAdapter[] = [];
    const blockers: AdapterBlocker[] = [];
    for (const adapter of this.opts.adapters) {
      const readiness = await this.checkReadiness(adapter);
      if (readiness.ok) {
        ready.push(adapter);
      } else {
        blockers.push({ adapter: adapter.name, detail: readiness.detail, checkedAt: readiness.checkedAt });
        // Record the specific blocker even when another adapter can take the
        // task, so an unauthenticated/unready worker is never silently used
        // or silently ignored.
        await this.orchestrator.auditEvent("readiness_failed", {
          pipelineId: task.pipelineId,
          taskId: task.id,
          stage: task.stage,
          workerId: this.workerId,
          reason: `adapter ${adapter.name}: ${readiness.detail}`,
        });
      }
    }

    const chosen = this.opts.pick ? this.opts.pick(task, ready) : (ready[0] ?? null);
    if (!chosen) {
      const reason = blockers.length
        ? `no ready worker adapter: ${blockers.map((b) => `${b.adapter} (${b.detail})`).join("; ")}`
        : "no worker adapters configured";
      const completed = await this.completeSafely(task.id, token, {
        outcome: "RETRY",
        summary: "execution skipped: no ready adapter",
        reason: clip(reason, this.opts.maxReasonChars ?? 500),
      });
      await this.orchestrator.auditEvent("readiness_failed", {
        pipelineId: task.pipelineId,
        taskId: task.id,
        stage: task.stage,
        workerId: this.workerId,
        reason,
      });
      if (!completed) return { status: "stale_completion", taskId: task.id, reason: "completion rejected after readiness failure" };
      return { status: "no_ready_adapter", taskId: task.id, attempts: completed.attempts, blockers };
    }

    await this.orchestrator.auditEvent("worker_assigned", {
      pipelineId: task.pipelineId,
      taskId: task.id,
      stage: task.stage,
      workerId: this.workerId,
      details: { adapter: chosen.name, attempts: task.attempts },
    });

    const timeoutMs = this.opts.executeTimeoutMs ?? DEFAULT_EXECUTE_TIMEOUT_MS;
    const controller = new AbortController();
    let result: WorkerResult;
    try {
      result = await this.withHardTimeout(chosen.execute(task, controller.signal), timeoutMs, controller);
    } catch (err) {
      const timedOut = isAbortError(err);
      const reason = timedOut
        ? `worker timed out after ${timeoutMs}ms`
        : `worker crashed: ${err instanceof Error ? err.message : String(err)}`;
      await this.orchestrator.auditEvent(timedOut ? "worker_timeout" : "worker_crashed", {
        pipelineId: task.pipelineId,
        taskId: task.id,
        stage: task.stage,
        workerId: this.workerId,
        reason: clip(reason, this.opts.maxReasonChars ?? 500),
      });
      const completed = await this.completeSafely(task.id, token, {
        outcome: "RETRY",
        summary: "execution failed",
        reason: clip(reason, this.opts.maxReasonChars ?? 500),
      });
      if (!completed) return { status: "stale_completion", taskId: task.id, reason: "completion rejected after worker failure" };
      return { status: "completed", taskId: task.id, adapter: chosen.name, outcome: "RETRY" };
    }

    const bounded: WorkerResult = {
      outcome: result.outcome,
      summary: clip(result.summary, this.opts.maxSummaryChars ?? 4000),
      blockedCategory: result.blockedCategory,
      reason: result.reason ? clip(result.reason, this.opts.maxReasonChars ?? 500) : undefined,
    };
    const completed = await this.completeSafely(task.id, token, bounded);
    if (!completed) return { status: "stale_completion", taskId: task.id, reason: "completion rejected (stale token)" };
    return { status: "completed", taskId: task.id, adapter: chosen.name, outcome: bounded.outcome };
  }

  private async completeSafely(taskId: string, token: string, result: WorkerResult) {
    try {
      return await this.orchestrator.complete(taskId, token, result);
    } catch {
      return null;
    }
  }

  /**
   * Hard execution bound: resolves with the worker result, or rejects with a
   * timeout error once timeoutMs elapses — even if the adapter ignores the
   * AbortSignal. Late completions from the worker are discarded.
   */
  private withHardTimeout(promise: Promise<WorkerResult>, timeoutMs: number, controller: AbortController): Promise<WorkerResult> {
    return new Promise<WorkerResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        const timeoutErr = new Error(`worker timed out after ${timeoutMs}ms`);
        timeoutErr.name = "AbortError";
        reject(timeoutErr);
      }, timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  private async checkReadiness(adapter: WorkerAdapter): Promise<ReadinessResult> {
    const ttl = this.opts.readinessTtlMs ?? 60_000;
    const cached = this.readinessCache.get(adapter.name);
    if (cached && Date.now() - cached.at < ttl) return cached.result;
    let result: ReadinessResult;
    try {
      result = await adapter.readiness();
    } catch (err) {
      result = {
        ok: false,
        detail: `readiness probe crashed: ${err instanceof Error ? err.message : String(err)}`,
        checkedAt: new Date().toISOString(),
      };
    }
    this.readinessCache.set(adapter.name, { at: Date.now(), result });
    return result;
  }
}
