const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_RUNS_ROOT = path.join(
  REPOSITORY_ROOT,
  'output/purchasing-web/runs'
);
const DEFAULT_UPLOAD_ROOT = path.join(
  REPOSITORY_ROOT,
  'output/purchasing-web/uploads'
);
const DEFAULT_HTTP_HOST = '127.0.0.1';
const DEFAULT_HTTP_PORT = 3210;
const MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 21 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 60 * 1000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 30 * 1000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10 * 1000;
const DEFAULT_RETENTION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ARTIFACT_NAMES = Object.freeze([
  'result.json',
  'report.txt',
  'recommendation-explanations.json',
  'recommendation-explanations-report.md',
  'matrix-draft.json',
  'matrix-report.txt',
  'manual-review.json',
  'owner-review.json',
  'owner-review-report.md',
  'owner-learning-report.json',
  'owner-learning-report.md',
  'owner-learning-patterns.json',
  'owner-learning-patterns.md',
  'run-metadata.json',
]);

const DEFAULT_SERVER_PATHS = Object.freeze({
  financialDataPath: path.join(
    REPOSITORY_ROOT,
    'data/purchasing/miska-financial-current.json'
  ),
  configPath: path.join(
    REPOSITORY_ROOT,
    'data/purchasing/miska-matrix-builder-config.json'
  ),
  matrixPath: path.join(
    REPOSITORY_ROOT,
    'data/purchasing/miska-assortment-matrix.json'
  ),
  ownerDecisionsPath: path.join(
    REPOSITORY_ROOT,
    'data/purchasing/miska-owner-decisions.json'
  ),
  recommendationConfigPath: path.join(
    REPOSITORY_ROOT,
    'data/purchasing/miska-recommendation-explainer-config.json'
  ),
  ownerLearningHistoryPath: path.join(
    REPOSITORY_ROOT,
    'output/purchasing/owner-learning-history.json'
  ),
});

function isValidRunId(runId) {
  return typeof runId === 'string' && RUN_ID_PATTERN.test(runId);
}

function resolveHttpPort(value = process.env.PURCHASING_WEB_PORT) {
  if (value === undefined || value === '') return DEFAULT_HTTP_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError('PURCHASING_WEB_PORT должен быть допустимым портом.');
  }
  return port;
}

function resolveRetentionTtlMs(
  value = process.env.PURCHASING_WEB_RETENTION_TTL_MS
) {
  if (value === undefined || value === '') return DEFAULT_RETENTION_TTL_MS;
  const ttlMs = Number(value);
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new TypeError(
      'PURCHASING_WEB_RETENTION_TTL_MS должен быть неотрицательным числом.'
    );
  }
  return ttlMs;
}

module.exports = {
  ARTIFACT_NAMES,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_PAGE_SIZE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RETENTION_TTL_MS,
  DEFAULT_RUNS_ROOT,
  DEFAULT_SERVER_PATHS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_UPLOAD_ROOT,
  DEFAULT_UPLOAD_TIMEOUT_MS,
  MAX_PAGE_SIZE,
  MAX_REQUEST_BODY_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  REPOSITORY_ROOT,
  RUN_ID_PATTERN,
  isValidRunId,
  resolveHttpPort,
  resolveRetentionTtlMs,
};
