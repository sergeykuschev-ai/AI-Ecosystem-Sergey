'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_RUNS_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'output',
  'purchasing-web',
  'runs'
);

function isValidRunId(runId) {
  return typeof runId === 'string' && RUN_ID_PATTERN.test(runId);
}

function resolveRunsRoot(options = {}) {
  const envRoot = typeof process !== 'undefined'
    ? process.env.PURCHASING_RUNS_ROOT
    : undefined;
  const root = options.runsRoot || envRoot || DEFAULT_RUNS_ROOT;
  return path.resolve(root);
}

function isInsideRunsRoot(runsRoot, targetPath) {
  const resolvedRoot = path.resolve(runsRoot);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function safeRunDirectory(runsRoot, runId) {
  if (!isValidRunId(runId)) {
    throw new PurchasingRunError('INVALID_RUN_ID', `Некорректный run ID: ${runId}`);
  }
  const runDirectory = path.join(path.resolve(runsRoot), runId);
  if (!isInsideRunsRoot(runsRoot, runDirectory)) {
    throw new PurchasingRunError('RUN_PATH_ESCAPE', `Run ID ${runId} выходит за пределы runs root`);
  }
  return runDirectory;
}

class PurchasingRunError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'PurchasingRunError';
    this.code = code;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

function readJson(fsModule, filePath, missingCode) {
  try {
    return JSON.parse(fsModule.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new PurchasingRunError(missingCode, `Файл не найден: ${filePath}`);
    }
    throw new PurchasingRunError(
      'RUN_DATA_INVALID',
      `Не удалось прочитать ${filePath}: ${error.message}`,
      { cause: error }
    );
  }
}

function readRunMetadata(fsModule, runsRoot, runId) {
  const runDirectory = safeRunDirectory(runsRoot, runId);
  const status = readJson(fsModule, path.join(runDirectory, 'run.json'), 'RUN_STATUS_NOT_FOUND');
  return {
    run_id: status.run_id || runId,
    status: status.status || null,
    completed_at: status.completed_at || null,
    created_at: status.created_at || null,
    source: status.source || {},
  };
}

function listRunDirectories(fsModule, runsRoot) {
  if (!fsModule.existsSync(runsRoot)) {
    return [];
  }
  const entries = fsModule.readdirSync(runsRoot, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && isValidRunId(entry.name))
    .map(entry => entry.name);
}

function findCompletedRuns(fsModule, runsRoot) {
  const runIds = listRunDirectories(fsModule, runsRoot);
  const completed = [];
  for (const runId of runIds) {
    try {
      const metadata = readRunMetadata(fsModule, runsRoot, runId);
      if (metadata.status === 'completed' && metadata.completed_at) {
        completed.push({
          ...metadata,
          completed_at_timestamp: new Date(metadata.completed_at).getTime(),
        });
      }
    } catch {
      // Skip malformed run directories.
    }
  }
  return completed.sort((a, b) => b.completed_at_timestamp - a.completed_at_timestamp);
}

function findLatestCompletedRun(options = {}) {
  const fsModule = options.fsModule || fs;
  const runsRoot = resolveRunsRoot(options);
  const completed = findCompletedRuns(fsModule, runsRoot);
  return completed.length > 0 ? completed[0] : null;
}

function resolveRunId(options = {}) {
  if (options.runId) {
    if (!isValidRunId(options.runId)) {
      throw new PurchasingRunError('INVALID_RUN_ID', `Некорректный run ID: ${options.runId}`);
    }
    return options.runId;
  }
  const latest = findLatestCompletedRun(options);
  return latest ? latest.run_id : null;
}

function getRunSummary(fsModule, runsRoot, runId) {
  const runDirectory = safeRunDirectory(runsRoot, runId);
  return readJson(fsModule, path.join(runDirectory, 'summary.json'), 'RUN_SUMMARY_NOT_FOUND');
}

function getOwnerReview(fsModule, runsRoot, runId) {
  const runDirectory = safeRunDirectory(runsRoot, runId);
  return readJson(fsModule, path.join(runDirectory, 'owner-review-compact.json'), 'OWNER_REVIEW_NOT_FOUND');
}

function createRunResolver(options = {}) {
  const fsModule = options.fsModule || fs;
  const runsRoot = resolveRunsRoot(options);

  return {
    runsRoot,
    resolveRunId: (opts = {}) => resolveRunId({ fsModule, runsRoot, ...opts }),
    findLatestCompletedRun: () => findLatestCompletedRun({ fsModule, runsRoot }),
    getRunMetadata: (runId) => readRunMetadata(fsModule, runsRoot, runId),
    getRunSummary: (runId) => getRunSummary(fsModule, runsRoot, runId),
    getOwnerReview: (runId) => getOwnerReview(fsModule, runsRoot, runId),
  };
}

module.exports = {
  RUN_ID_PATTERN,
  DEFAULT_RUNS_ROOT,
  PurchasingRunError,
  createRunResolver,
  resolveRunsRoot,
  isValidRunId,
  findLatestCompletedRun,
  resolveRunId,
  readRunMetadata,
  getRunSummary,
  getOwnerReview,
  listRunDirectories,
  findCompletedRuns,
};
