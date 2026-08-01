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
const DEFAULT_UPLOAD_IDEMPOTENCY_PATH = path.join(
  REPOSITORY_ROOT,
  'output/purchasing-web/upload-idempotency.json'
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
const DEFAULT_APPROVED_RULE_MODE = 'PREVIEW';
const PURCHASING_SERVICE_NAME = 'purchasing-web';
const MINMAX_HTTP_CONTRACT_VERSION = 'minmax-upload-idempotency-v1';
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Idempotency keys are URL-safe: the n8n workflow builds them as
// `minmax-<sha256(mailbox|uidvalidity|uid|filename|size)>`.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,512}$/;

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
  'owner-rule-proposals.json',
  'owner-rule-proposals.md',
  'approved-rule-preview.json',
  'approved-rule-preview.md',
  'approved-rule-applications.json',
  'run-metadata.json',
  // Original uploaded Excel report, stored as a binary run artifact
  // (exactly one of the two extensions exists per run; both names are
  // whitelisted so the download route accepts the real one).
  'source-report.xlsx',
  'source-report.xls',
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
  ownerDecisionHistoryPath: path.join(
    REPOSITORY_ROOT,
    'data/purchasing/owner-decision-history.json'
  ),
  ownerLearningCandidateLifecycleFilePath: path.join(
    REPOSITORY_ROOT,
    'data/purchasing/owner-learning-candidate-lifecycle.json'
  ),
  ownerLearningRuleMaterializationsFilePath: path.join(
    REPOSITORY_ROOT,
    'data/purchasing/owner-learning-rule-materializations.json'
  ),
  ownerLearningRuleStatusEventsFilePath: path.join(
    REPOSITORY_ROOT,
    'data/purchasing/owner-learning-rule-status-events.json'
  ),
  ownerLearningRuleActivationPreviewsFilePath: path.join(
    REPOSITORY_ROOT,
    'data/purchasing/owner-learning-rule-activation-previews.json'
  ),
  ownerLearningRuleEffectivenessFilePath: path.join(
    REPOSITORY_ROOT,
    'data/purchasing/owner-learning-rule-effectiveness-events.json'
  ),
  approvedRulesPath: path.join(
    REPOSITORY_ROOT,
    'data/purchasing/owner-approved-rules.json'
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

function isValidIdempotencyKey(key) {
  return typeof key === 'string' && IDEMPOTENCY_KEY_PATTERN.test(key);
}

function resolveHttpPort(value = process.env.PURCHASING_WEB_PORT) {
  if (value === undefined || value === '') return DEFAULT_HTTP_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError('PURCHASING_WEB_PORT должен быть допустимым портом.');
  }
  return port;
}

function resolveHttpHost(value = process.env.PURCHASING_WEB_HOST) {
  // Default stays loopback-only; production sets the value explicitly.
  if (value === undefined || value === '') return DEFAULT_HTTP_HOST;
  const host = String(value).trim();
  if (
    host === '' ||
    host.length > 255 ||
    host.includes('/') ||
    host.includes('\0')
  ) {
    throw new TypeError(
      'PURCHASING_WEB_HOST должен быть допустимым именем хоста или IP.'
    );
  }
  return host;
}

function resolveApiToken(value = process.env.PURCHASING_API_TOKEN) {
  // Token is mandatory only for non-loopback API requests; loopback
  // (the owner's local browser) never needs it. The value is never
  // logged or echoed in responses.
  if (value === undefined || value === '') return null;
  const token = String(value);
  if (token.length < 16 || token.length > 512 || token.includes('\0')) {
    throw new TypeError(
      'PURCHASING_API_TOKEN должен содержать от 16 до 512 символов.'
    );
  }
  return token;
}

function resolveBuildSha(value = process.env.PURCHASING_BUILD_SHA) {
  if (value === undefined || value === '') return null;
  const sha = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(sha)) {
    throw new TypeError(
      'PURCHASING_BUILD_SHA должен быть Git SHA длиной 7–40 символов.'
    );
  }
  return sha;
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

function resolveApprovedRuleMode(
  value = process.env.PURCHASING_APPROVED_RULE_MODE
) {
  return value === undefined || value === ''
    ? DEFAULT_APPROVED_RULE_MODE
    : value;
}

module.exports = {
  ARTIFACT_NAMES,
  DEFAULT_APPROVED_RULE_MODE,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_PAGE_SIZE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RETENTION_TTL_MS,
  DEFAULT_RUNS_ROOT,
  DEFAULT_SERVER_PATHS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_UPLOAD_IDEMPOTENCY_PATH,
  DEFAULT_UPLOAD_ROOT,
  DEFAULT_UPLOAD_TIMEOUT_MS,
  MAX_PAGE_SIZE,
  MAX_REQUEST_BODY_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  MINMAX_HTTP_CONTRACT_VERSION,
  PURCHASING_SERVICE_NAME,
  REPOSITORY_ROOT,
  RUN_ID_PATTERN,
  IDEMPOTENCY_KEY_PATTERN,
  isValidIdempotencyKey,
  isValidRunId,
  resolveApiToken,
  resolveApprovedRuleMode,
  resolveBuildSha,
  resolveHttpHost,
  resolveHttpPort,
  resolveRetentionTtlMs,
};
