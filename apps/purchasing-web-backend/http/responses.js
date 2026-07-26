const {
  safeDetails,
  safePublicText,
} = require('../dto/api_error_mapper');

const HTTP_STATUS_BY_CODE = Object.freeze({
  INVALID_MULTIPART: 400,
  FILE_REQUIRED: 400,
  MULTIPLE_FILES: 400,
  INVALID_REPORT_DATE: 400,
  INVALID_QUERY: 400,
  INVALID_RUN_ID: 400,
  INVALID_ITEM_ID: 400,
  INVALID_OWNER_DECISION: 400,
  OWNER_DECISION_ANALYTICS_INVALID_INPUT: 400,
  OWNER_LEARNING_CANDIDATES_INVALID_INPUT: 400,
  OWNER_LEARNING_LIFECYCLE_INVALID_INPUT: 400,
  OWNER_MATERIALIZED_RULES_INVALID_INPUT: 400,
  OWNER_RULE_EFFECTIVENESS_INVALID_INPUT: 400,
  OWNER_RULE_MATERIALIZATION_INVALID_INPUT: 400,
  OWNER_RULE_MATERIALIZATION_CONFIRMATION_REQUIRED: 400,
  OWNER_RULE_STATUS_INVALID_INPUT: 400,
  OWNER_RULE_STATUS_CONFIRMATION_REQUIRED: 400,
  INVALID_ARTIFACT_NAME: 400,
  INVALID_STATIC_PATH: 400,
  ARTIFACT_NOT_ALLOWED: 403,
  RUN_NOT_FOUND: 404,
  ITEM_NOT_FOUND: 404,
  ARTIFACT_NOT_FOUND: 404,
  OWNER_MATERIALIZED_RULE_NOT_FOUND: 404,
  OWNER_RULE_EFFECTIVENESS_RULE_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  RUN_NOT_READY: 409,
  RUN_FAILED: 409,
  OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID: 409,
  OWNER_RULE_STATUS_TRANSITION_INVALID: 409,
  PREVIEW_REQUIRED: 409,
  PREVIEW_EXPIRED: 409,
  PREVIEW_STALE: 409,
  PREVIEW_TARGET_MISMATCH: 409,
  RULE_NOT_MATERIALIZED: 409,
  RULE_NOT_MANAGEABLE: 409,
  CANDIDATE_NOT_AVAILABLE: 409,
  CANDIDATE_NOT_APPROVED: 409,
  CANDIDATE_NOT_ELIGIBLE: 409,
  CANDIDATE_TYPE_NOT_MATERIALIZABLE: 409,
  RUN_ALREADY_IN_PROGRESS: 409,
  ITEM_DECISION_UNAVAILABLE: 409,
  UPLOAD_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  INVALID_WORKBOOK: 422,
  INPUT_CONTRACT_ERROR: 422,
  RULE_ACTIVATION_NOT_FINANCIALLY_PERMITTED: 422,
  ARTIFACT_STREAM_ERROR: 500,
  STORAGE_ERROR: 507,
  OWNER_DECISION_STORAGE_ERROR: 507,
  OWNER_LEARNING_LIFECYCLE_UNAVAILABLE: 503,
  OWNER_LEARNING_LIFECYCLE_CORRUPTED: 503,
  OWNER_LEARNING_LIFECYCLE_SCHEMA_UNSUPPORTED: 503,
  OWNER_LEARNING_LIFECYCLE_WRITE_FAILED: 503,
  RULE_REGISTRY_UNAVAILABLE: 503,
  RULE_STATUS_STORAGE_UNAVAILABLE: 503,
  RULE_ACTIVATION_PREVIEW_UNAVAILABLE: 503,
  RULE_MATERIALIZATION_STORAGE_UNAVAILABLE: 503,
});

class HttpError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'HttpError';
    this.code = code;
    this.statusCode = options.statusCode || HTTP_STATUS_BY_CODE[code] || 500;
    this.details = Array.isArray(options.details) ? options.details : [];
  }

  toPublicData() {
    return {
      code: this.code,
      message: this.message,
    };
  }
}

function sendJson(response, statusCode, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function sendSuccess(response, statusCode, data, headers) {
  sendJson(response, statusCode, {
    api_version: 'v1',
    data,
  }, headers);
}

function normalizeHttpError(error) {
  if (error instanceof HttpError) return error;

  if (error?.code === 'RUN_STORAGE_ERROR' ||
      error?.code === 'RUN_DATA_INVALID') {
    return new HttpError(
      'STORAGE_ERROR',
      'Не удалось сохранить или прочитать данные run.',
      { statusCode: 507, cause: error }
    );
  }

  if (HTTP_STATUS_BY_CODE[error?.code]) {
    return new HttpError(error.code, error.message, {
      statusCode: HTTP_STATUS_BY_CODE[error.code],
      cause: error,
    });
  }

  return new HttpError(
    'RUN_FAILED',
    'Не удалось выполнить запрос.',
    { statusCode: 500, cause: error }
  );
}

function sendError(response, error, context = {}) {
  const normalized = normalizeHttpError(error);
  sendJson(response, normalized.statusCode, {
    api_version: 'v1',
    error: {
      code: safePublicText(normalized.code, 'RUN_FAILED'),
      message: safePublicText(
        normalized.message,
        'Не удалось выполнить запрос.'
      ),
      request_id: typeof context.requestId === 'string'
        ? context.requestId
        : null,
      run_id: typeof context.runId === 'string' ? context.runId : null,
      details: safeDetails(normalized.details),
    },
  });
}

module.exports = {
  HTTP_STATUS_BY_CODE,
  HttpError,
  normalizeHttpError,
  sendError,
  sendJson,
  sendSuccess,
};
