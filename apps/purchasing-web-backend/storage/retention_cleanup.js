const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_RETENTION_TTL_MS,
  DEFAULT_RUNS_ROOT,
  isValidRunId,
} = require('../config');

function cleanupExpiredRuns(options = {}) {
  const fsModule = options.fsModule || fs;
  const runsRoot = path.resolve(options.runsRoot || DEFAULT_RUNS_ROOT);
  const ttlMs = options.ttlMs ?? DEFAULT_RETENTION_TTL_MS;
  const now = new Date(options.now || new Date());
  if (
    typeof ttlMs !== 'number' ||
    !Number.isFinite(ttlMs) ||
    ttlMs < 0 ||
    !Number.isFinite(now.getTime())
  ) {
    throw new TypeError('Retention TTL и текущая дата должны быть корректными.');
  }
  if (!fsModule.existsSync(runsRoot)) {
    return { removed: [], skipped_processing: [], errors: 0 };
  }

  const removed = [];
  const skippedProcessing = [];
  let errors = 0;
  for (const entry of fsModule.readdirSync(runsRoot, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || !isValidRunId(entry.name)) continue;
    const runDirectory = path.join(runsRoot, entry.name);
    try {
      const status = JSON.parse(fsModule.readFileSync(
        path.join(runDirectory, 'run.json'),
        'utf8'
      ));
      if (status.status === 'processing') {
        skippedProcessing.push(entry.name);
        continue;
      }
      if (status.status !== 'completed') continue;
      const completedAt = new Date(
        status.completed_at || status.created_at
      );
      if (
        Number.isFinite(completedAt.getTime()) &&
        now.getTime() - completedAt.getTime() > ttlMs
      ) {
        fsModule.rmSync(runDirectory, { recursive: true, force: true });
        removed.push(entry.name);
      }
    } catch {
      errors += 1;
    }
  }
  return {
    removed,
    skipped_processing: skippedProcessing,
    errors,
  };
}

module.exports = { cleanupExpiredRuns };
