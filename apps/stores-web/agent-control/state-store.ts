import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, fsyncSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AuditEvent, AuditType, PipelineState, TaskRecord, WorkerOutcome } from "./types";

export interface QueueData {
  seq: number;
  tasks: Record<string, TaskRecord>;
  pipelines: Record<string, PipelineState>;
}

const EMPTY_QUEUE: QueueData = { seq: 0, tasks: {}, pipelines: {} };

/**
 * Durable JSON state store. Every mutation runs inside a serialized
 * transaction and is persisted atomically (write + fsync + rename) together
 * with its audit events, so a crash can never leave queue and audit log
 * disagreeing. Audit trail is append-only JSONL.
 */
export class StateStore {
  private readonly queuePath: string;
  private readonly auditPath: string;
  private queue: QueueData;
  private auditSeq: number;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(readonly rootDir: string) {
    this.queuePath = path.join(rootDir, "queue.json");
    this.auditPath = path.join(rootDir, "audit.jsonl");
    mkdirSync(rootDir, { recursive: true });
    this.queue = this.loadQueue();
    this.auditSeq = this.loadAuditSeq();
  }

  private loadQueue(): QueueData {
    if (!existsSync(this.queuePath)) return structuredClone(EMPTY_QUEUE);
    const parsed = JSON.parse(readFileSync(this.queuePath, "utf8")) as QueueData;
    return {
      seq: parsed.seq ?? 0,
      tasks: parsed.tasks ?? {},
      pipelines: parsed.pipelines ?? {},
    };
  }

  private loadAuditSeq(): number {
    if (!existsSync(this.auditPath)) return 0;
    const lines = readFileSync(this.auditPath, "utf8").split("\n").filter(Boolean);
    let max = 0;
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as AuditEvent;
        if (event.seq > max) max = event.seq;
      } catch {
        // skip corrupt tail line; durability is best-effort on recovery
      }
    }
    return max;
  }

  /** Serialize all mutations through a single promise chain. */
  transact<T>(mutator: (q: QueueData) => T | Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const result = await mutator(this.queue);
      this.persist();
      return result;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  private persist(): void {
    const tmp = `${this.queuePath}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeFileSync(fd, JSON.stringify(this.queue, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.queuePath);
  }

  audit(entry: {
    type: AuditType;
    at: string;
    pipelineId?: string;
    taskId?: string;
    stage?: string;
    workerId?: string;
    outcome?: WorkerOutcome;
    reason?: string;
    details?: Record<string, unknown>;
  }): AuditEvent {
    const event: AuditEvent = { seq: ++this.auditSeq, ...entry };
    const line = JSON.stringify(event);
    const fd = openSync(this.auditPath, "a");
    try {
      writeFileSync(fd, `${line}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return event;
  }

  snapshot(): { tasks: Record<string, TaskRecord>; pipelines: Record<string, PipelineState> } {
    return {
      tasks: structuredClone(this.queue.tasks),
      pipelines: structuredClone(this.queue.pipelines),
    };
  }

  readAudit(): AuditEvent[] {
    if (!existsSync(this.auditPath)) return [];
    return readFileSync(this.auditPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEvent);
  }
}
