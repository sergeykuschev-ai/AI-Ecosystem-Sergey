import { spawn } from "node:child_process";
import { validateProjectRoot } from "./project-validation";
import type { TopLevelResolver } from "./project-validation";
import type { ReadinessResult, TaskRecord, WorkerAdapter, WorkerResult } from "./types";

export interface CliAdapterOptions {
  name: string;
  /** Command used for the bounded readiness probe; exit 0 means authenticated/ready. */
  readinessCommand: string;
  readinessArgs?: string[];
  readinessTimeoutMs?: number;
  /** Command executed per task; the task JSON is passed on stdin. */
  executeCommand: string;
  executeArgs?: string[];
  executeTimeoutMs?: number;
  /** Hard cap on the serialized prompt payload sent to the worker. */
  maxPayloadChars?: number;
  cwd: string;
  /**
   * Optional fail-closed project guard. When set, readiness also runs
   * validateProjectRoot() against the adapter's cwd: the worker must be
   * rooted at the exact Git top-level expected for the project, so work can
   * never fall through to a parent/unrelated repository. Pass projectPath
   * identical to `cwd` (the allowlist pins the exact top-level).
   */
  project?: {
    projectPath: string;
    allowedTopLevels?: string[];
    resolveTopLevel?: TopLevelResolver;
  };
}

function runBounded(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ code: -1, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${err.message}`, timedOut: false });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut: false });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Adapter for CLI-based workers (e.g. Kimi / Codex CLIs on the AgentControl
 * host). Readiness is proven by a bounded probe command — never inferred
 * from a process merely existing. Execution receives a bounded JSON payload
 * on stdin and is killed on timeout. The caller (WorkerRouter) adds the
 * outer AbortSignal timeout as a second bound.
 */
export function createCliAdapter(options: CliAdapterOptions): WorkerAdapter {
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 20_000;
  const executeTimeoutMs = options.executeTimeoutMs ?? 110_000;
  const maxPayloadChars = options.maxPayloadChars ?? 12_000;

  return {
    name: options.name,
    async readiness(): Promise<ReadinessResult> {
      const checkedAt = new Date().toISOString();
      if (options.project) {
        const validation = await validateProjectRoot({
          projectPath: options.project.projectPath,
          allowedTopLevels: options.project.allowedTopLevels,
          resolveTopLevel: options.project.resolveTopLevel,
        });
        if (!validation.ok) {
          return { ok: false, detail: `project root validation failed: ${validation.reason}`, checkedAt };
        }
      }
      const probe = await runBounded(
        options.readinessCommand,
        options.readinessArgs ?? [],
        "",
        readinessTimeoutMs,
        options.cwd,
      );
      return {
        ok: !probe.timedOut && probe.code === 0,
        detail: probe.timedOut
          ? `readiness probe timed out after ${readinessTimeoutMs}ms`
          : probe.code === 0
            ? "readiness probe passed"
            : `readiness probe exited ${probe.code}: ${probe.stderr.trim().slice(0, 300)}`,
        checkedAt,
      };
    },
    async execute(task: TaskRecord, signal: AbortSignal): Promise<WorkerResult> {
      let payload = JSON.stringify({
        taskId: task.id,
        pipelineId: task.pipelineId,
        stage: task.stage,
        logicalKey: task.logicalKey,
        attempts: task.attempts,
        payload: task.payload,
      });
      if (payload.length > maxPayloadChars) {
        payload = JSON.stringify({
          taskId: task.id,
          pipelineId: task.pipelineId,
          stage: task.stage,
          logicalKey: task.logicalKey,
          attempts: task.attempts,
          payload: { truncated: true },
        });
      }
      const result = await runBounded(options.executeCommand, options.executeArgs ?? [], payload, executeTimeoutMs, options.cwd);
      if (signal.aborted) {
        throw new Error("execution aborted by router timeout");
      }
      if (result.timedOut) {
        throw new Error(`worker execution timed out after ${executeTimeoutMs}ms`);
      }
      if (result.code !== 0) {
        throw new Error(`worker exited ${result.code}: ${result.stderr.trim().slice(0, 300)}`);
      }
      try {
        return JSON.parse(result.stdout.trim()) as WorkerResult;
      } catch {
        return { outcome: "FAIL", summary: "worker returned non-JSON result", reason: result.stdout.trim().slice(0, 300) };
      }
    },
  };
}
