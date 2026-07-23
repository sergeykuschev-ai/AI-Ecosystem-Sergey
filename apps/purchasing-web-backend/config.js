const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_RUNS_ROOT = path.join(
  REPOSITORY_ROOT,
  'output/purchasing-web/runs'
);
const DEFAULT_RETENTION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ARTIFACT_NAMES = Object.freeze([
  'result.json',
  'matrix-draft.json',
  'manual-review.json',
  'owner-review.json',
  'owner-review-report.md',
  'recommendation-explanations.json',
  'recommendation-explanations-report.md',
  'matrix-report.txt',
  'run-metadata.json',
]);

function isValidRunId(runId) {
  return typeof runId === 'string' && RUN_ID_PATTERN.test(runId);
}

module.exports = {
  ARTIFACT_NAMES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_RETENTION_TTL_MS,
  DEFAULT_RUNS_ROOT,
  MAX_PAGE_SIZE,
  REPOSITORY_ROOT,
  RUN_ID_PATTERN,
  isValidRunId,
};
