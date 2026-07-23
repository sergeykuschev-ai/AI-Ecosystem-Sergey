const { mapApiError } = require('./api_error_mapper');

const RUN_STATUSES = Object.freeze([
  'processing',
  'completed',
  'failed',
]);

function safeOriginalName(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const segments = value.trim().split(/[\\/]/);
  return segments.at(-1).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) ||
    null;
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizeSourceMetadata(source = {}) {
  return {
    original_name: safeOriginalName(
      source.original_name || source.originalName || source.filePath
    ),
    size_bytes: finiteOrNull(source.size_bytes ?? source.sizeBytes),
    sha256: typeof source.sha256 === 'string' ? source.sha256 : null,
  };
}

function mapRunStatus(input) {
  if (!RUN_STATUSES.includes(input.status)) {
    throw new TypeError('Run status is not supported.');
  }
  const runId = input.runId;
  return {
    run_id: runId,
    status: input.status,
    stage: input.stage || null,
    created_at: input.createdAt || null,
    started_at: input.startedAt || null,
    completed_at: input.completedAt || null,
    source: sanitizeSourceMetadata(input.source),
    warnings_count: Number.isInteger(input.warningsCount)
      ? input.warningsCount
      : 0,
    error: input.error
      ? mapApiError(input.error, {
        requestId: input.requestId,
        runId,
        details: input.errorDetails,
      })
      : null,
    links: {
      self: `/api/v1/runs/${runId}`,
      summary: `/api/v1/runs/${runId}/summary`,
      items: `/api/v1/runs/${runId}/items`,
      owner_review: `/api/v1/runs/${runId}/owner-review`,
      artifacts: `/api/v1/runs/${runId}/artifacts`,
    },
  };
}

module.exports = {
  RUN_STATUSES,
  finiteOrNull,
  mapRunStatus,
  safeOriginalName,
  sanitizeSourceMetadata,
};
