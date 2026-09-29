/**
 * AgentControl orchestration core — shared contracts.
 *
 * Outcome semantics are explicit: a process exit code of 0 is NOT treated as
 * success. Workers must report one of the WorkerOutcome values below and the
 * orchestrator routes each one through a distinct path.
 */

export type WorkerOutcome =
  | "SUCCESS"
  | "RETRY"
  | "BLOCKED"
  | "APPROVAL_REQUIRED"
  | "FAIL";

/** How a BLOCKED result must be routed. */
export type BlockedCategory = "review" | "approval" | "policy";

export type TaskStatus =
  | "pending"
  | "running"
  | "review"
  | "approval"
  | "done"
  | "failed";

export interface Lease {
  owner: string;
  pid: number;
  attemptToken: string;
  startedAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface HistoryEntry {
  at: string;
  event: string;
  workerId?: string;
  outcome?: WorkerOutcome;
  reason?: string;
  attempts?: number;
}

export interface TaskRecord {
  id: string;
  pipelineId: string;
  stage: string;
  logicalKey: string;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  workerId: string | null;
  attemptToken: string | null;
  lease: Lease | null;
  blockedCategory: BlockedCategory | null;
  blockedReason: string | null;
  payload: Record<string, unknown>;
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface PipelineState {
  pipelineId: string;
  stageIndex: number;
  completedStages: string[];
  status: "running" | "done" | "failed";
  updatedAt: string;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  reason?: string;
}

export type GateCheck = (task: TaskRecord) => GateResult | Promise<GateResult>;

export interface PipelineDefinition {
  pipelineId: string;
  stages: string[];
  gates?: Record<string, GateCheck[]>;
}

export interface WorkerResult {
  outcome: WorkerOutcome;
  summary: string;
  blockedCategory?: BlockedCategory;
  reason?: string;
}

export interface ReadinessResult {
  ok: boolean;
  detail: string;
  checkedAt: string;
}

export interface WorkerAdapter {
  readonly name: string;
  readiness(): Promise<ReadinessResult>;
  execute(task: TaskRecord, signal: AbortSignal): Promise<WorkerResult>;
}

export type AuditType =
  | "enqueued"
  | "duplicate_suppressed"
  | "claimed"
  | "stale_token_rejected"
  | "completed"
  | "retry_scheduled"
  | "terminal_failure"
  | "blocked_routed"
  | "review_resolved"
  | "approval_resolved"
  | "gate_passed"
  | "gate_failed"
  | "stage_advanced"
  | "pipeline_done"
  | "pipeline_failed"
  | "watchdog_requeued"
  | "watchdog_failed"
  | "readiness_failed"
  | "worker_assigned"
  | "worker_timeout"
  | "worker_crashed";

export interface AuditEvent {
  seq: number;
  at: string;
  type: AuditType;
  pipelineId?: string;
  taskId?: string;
  stage?: string;
  workerId?: string;
  outcome?: WorkerOutcome;
  reason?: string;
  details?: Record<string, unknown>;
}

export type PidProbe = (pid: number) => boolean;

export function defaultPidProbe(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
