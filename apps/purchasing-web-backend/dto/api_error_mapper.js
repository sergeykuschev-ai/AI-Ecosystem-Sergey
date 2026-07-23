const {
  PurchasingWebApplicationError,
} = require('../application/application_error');

const ABSOLUTE_PATH_PATTERN = /(?:file:\/\/|[a-zA-Z]:\\|\/(?:Users|home|private|tmp|var|etc|opt)\b)/;

function safePublicText(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  if (ABSOLUTE_PATH_PATTERN.test(value)) return fallback;
  return value.trim();
}

function safeDetails(details) {
  if (!Array.isArray(details)) return [];
  return details.slice(0, 20).map(detail => ({
    field: safePublicText(detail?.field, 'request'),
    reason: safePublicText(detail?.reason, 'invalid'),
  }));
}

function mapApiError(error, context = {}) {
  const isApplicationError = error instanceof PurchasingWebApplicationError;
  const publicData = isApplicationError
    ? error.toPublicData()
    : {
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка application layer.',
    };
  return {
    api_version: 'v1',
    code: safePublicText(publicData.code, 'INTERNAL_ERROR'),
    message: safePublicText(
      publicData.message,
      'Внутренняя ошибка application layer.'
    ),
    request_id: typeof context.requestId === 'string'
      ? context.requestId
      : null,
    run_id: typeof context.runId === 'string' ? context.runId : null,
    details: safeDetails(context.details),
  };
}

module.exports = {
  ABSOLUTE_PATH_PATTERN,
  mapApiError,
  safeDetails,
  safePublicText,
};
