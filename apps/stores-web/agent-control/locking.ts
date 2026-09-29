import { randomUUID } from "node:crypto";
import type { PidProbe, TaskRecord } from "./types";
import { defaultPidProbe } from "./types";

export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

/**
 * Atomically starts a new execution attempt for a claimed task:
 * increments and persists `attempts`, rotates the attempt token, and issues
 * a fresh lease. This is the single place attempt accounting happens, so
 * `maxAttempts` is enforced against exactly the number of real claims.
 */
export function newAttempt(
  task: TaskRecord,
  workerId: string,
  now: Date,
  leaseMs: number = DEFAULT_LEASE_MS,
  pid: number = process.pid,
): TaskRecord {
  if (task.status !== "pending") {
    throw new Error(`task ${task.id} is ${task.status}; only pending tasks can start a new attempt`);
  }
  const iso = now.toISOString();
  task.attempts += 1;
  task.attemptToken = randomUUID();
  task.workerId = workerId;
  task.status = "running";
  task.lease = {
    owner: workerId,
    pid,
    attemptToken: task.attemptToken,
    startedAt: iso,
    heartbeatAt: iso,
    expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
  };
  task.updatedAt = iso;
  task.history.push({
    at: iso,
    event: "claimed",
    workerId,
    attempts: task.attempts,
  });
  return task;
}

/** A lease is active only while unexpired AND held by a live pid. */
export function isLeaseActive(task: TaskRecord, now: Date, probe: PidProbe = defaultPidProbe): boolean {
  const lease = task.lease;
  if (!lease || task.status !== "running") return false;
  if (now.getTime() > Date.parse(lease.expiresAt)) return false;
  return probe(lease.pid);
}

export function releaseLease(task: TaskRecord, now: Date): TaskRecord {
  task.lease = null;
  task.workerId = null;
  task.attemptToken = null;
  task.updatedAt = now.toISOString();
  return task;
}
