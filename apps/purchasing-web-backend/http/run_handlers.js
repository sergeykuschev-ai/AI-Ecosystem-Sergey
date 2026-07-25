const crypto = require('node:crypto');

const {
  runOrderAgentFromSmartZapasXlsxWithDemand,
} = require('../../../agents/purchasing/order_agent');
const {
  buildMatrixDraftFromSmartZapasXlsx,
} = require(
  '../../../agents/purchasing/matrix_builder/matrix_builder'
);
const {
  DEFAULT_SERVER_PATHS,
  DEFAULT_UPLOAD_ROOT,
} = require('../config');
const {
  runPurchasingWebOrchestrator,
} = require('../application/purchasing_run_orchestrator');
const {
  DEFAULT_RUN_EXECUTION_LOCK,
} = require('../application/run_execution_lock');
const {
  cleanupUploadDirectory,
  parseExcelUpload,
} = require('./upload_handler');
const { streamArtifact } = require('./artifact_handler');
const { HttpError } = require('./responses');
const {
  mapOwnerDecisionAnalytics,
} = require('../dto/owner_decision_analytics_mapper');
const {
  mapOwnerLearningCandidates,
} = require('../dto/owner_learning_candidates_mapper');
const {
  OWNER_DECISIONS,
  REASON_CODES,
  SOURCES,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);

const MAX_DECISION_BODY_BYTES = 4096;
const MAX_ANALYTICS_ITEMS = 100;
const ANALYTICS_FILTER_NAMES = Object.freeze([
  'source',
  'supplier',
  'brand',
  'category',
  'stableItemKey',
  'ownerDecision',
  'reasonCode',
  'dateFrom',
  'dateTo',
]);
const ANALYTICS_OPTION_NAMES = Object.freeze([
  'minOccurrences',
  'dominantShareThreshold',
  'maxItems',
]);
const ANALYTICS_QUERY_NAMES = new Set([
  ...ANALYTICS_FILTER_NAMES,
  ...ANALYTICS_OPTION_NAMES,
]);
const CANDIDATE_CONFIDENCE_OPTION_NAMES = Object.freeze([
  'asOf',
  'maxEvidenceDecisionIds',
  'includeLowConfidence',
]);
const CANDIDATE_RANKING_OPTION_NAMES = Object.freeze([
  'minOccurrencesForEligibility',
  'minDominantShareForEligibility',
  'maxContradictionShareForEligibility',
  'includeIneligible',
  'limit',
]);
const CANDIDATE_QUERY_NAMES = new Set([
  ...ANALYTICS_FILTER_NAMES,
  ...ANALYTICS_OPTION_NAMES,
  ...CANDIDATE_CONFIDENCE_OPTION_NAMES,
  ...CANDIDATE_RANKING_OPTION_NAMES,
]);

function analyticsInputError(message) {
  return new HttpError(
    'OWNER_DECISION_ANALYTICS_INVALID_INPUT',
    message
  );
}

function queryText(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > 512 ||
    value.includes('\0')
  ) {
    throw analyticsInputError(`Параметр ${name} имеет неверное значение.`);
  }
  return value.trim();
}

function queryEnum(value, name, values) {
  const normalized = queryText(value, name).toUpperCase();
  if (!values.includes(normalized)) {
    throw analyticsInputError(`Параметр ${name} не поддерживается.`);
  }
  return normalized;
}

function queryDate(value, name) {
  const normalized = queryText(value, name);
  const timestamp = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? `${normalized}T00:00:00.000Z`
      : normalized
  );
  if (
    !Number.isFinite(timestamp) ||
    (/^\d{4}-\d{2}-\d{2}$/.test(normalized) &&
      new Date(timestamp).toISOString().slice(0, 10) !== normalized)
  ) {
    throw analyticsInputError(`Параметр ${name} должен быть датой.`);
  }
  return normalized;
}

function queryInteger(value, name, maximum = null) {
  const normalized = queryText(value, name);
  if (!/^\d+$/.test(normalized)) {
    throw analyticsInputError(
      `Параметр ${name} должен быть положительным целым числом.`
    );
  }
  const number = Number(normalized);
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    (maximum !== null && number > maximum)
  ) {
    throw analyticsInputError(`Параметр ${name} вне допустимого диапазона.`);
  }
  return number;
}

function parseOwnerDecisionAnalyticsQuery(query = {}) {
  for (const name of Object.keys(query)) {
    if (!ANALYTICS_QUERY_NAMES.has(name)) {
      throw analyticsInputError(`Параметр ${name} не поддерживается.`);
    }
  }
  const filters = {};
  const options = {};
  for (const name of ['supplier', 'brand', 'category', 'stableItemKey']) {
    if (query[name] !== undefined) {
      filters[name] = queryText(query[name], name);
    }
  }
  if (query.source !== undefined) {
    filters.source = queryEnum(query.source, 'source', SOURCES);
  }
  if (query.ownerDecision !== undefined) {
    filters.ownerDecision = queryEnum(
      query.ownerDecision,
      'ownerDecision',
      OWNER_DECISIONS
    );
  }
  if (query.reasonCode !== undefined) {
    filters.reasonCode = queryEnum(
      query.reasonCode,
      'reasonCode',
      REASON_CODES
    );
  }
  for (const name of ['dateFrom', 'dateTo']) {
    if (query[name] !== undefined) {
      filters[name] = queryDate(query[name], name);
    }
  }
  if (
    filters.dateFrom &&
    filters.dateTo &&
    Date.parse(filters.dateFrom) > Date.parse(filters.dateTo)
  ) {
    throw analyticsInputError('dateFrom не может быть позже dateTo.');
  }
  if (query.minOccurrences !== undefined) {
    options.minOccurrences = queryInteger(
      query.minOccurrences,
      'minOccurrences'
    );
  }
  if (query.maxItems !== undefined) {
    options.maxItems = queryInteger(
      query.maxItems,
      'maxItems',
      MAX_ANALYTICS_ITEMS
    );
  }
  if (query.dominantShareThreshold !== undefined) {
    const normalized = queryText(
      query.dominantShareThreshold,
      'dominantShareThreshold'
    );
    if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(normalized)) {
      throw analyticsInputError(
        'dominantShareThreshold должен быть числом от 0 до 1.'
      );
    }
    const threshold = Number(normalized);
    if (
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      threshold > 1
    ) {
      throw analyticsInputError(
        'dominantShareThreshold должен быть числом от 0 до 1.'
      );
    }
    options.dominantShareThreshold = threshold;
  }
  return { filters, options };
}

function candidateInputError(message) {
  return new HttpError(
    'OWNER_LEARNING_CANDIDATES_INVALID_INPUT',
    message
  );
}

function candidateText(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > 512 ||
    value.includes('\0')
  ) {
    throw candidateInputError(
      `Параметр ${name} имеет неверное значение.`
    );
  }
  return value.trim();
}

function candidateEnum(value, name, values) {
  const normalized = candidateText(value, name).toUpperCase();
  if (!values.includes(normalized)) {
    throw candidateInputError(`Параметр ${name} не поддерживается.`);
  }
  return normalized;
}

function candidateInteger(value, name, maximum = null) {
  const normalized = candidateText(value, name);
  const number = Number(normalized);
  if (
    !/^\d+$/.test(normalized) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    (maximum !== null && number > maximum)
  ) {
    throw candidateInputError(
      `Параметр ${name} вне допустимого диапазона.`
    );
  }
  return number;
}

function candidateShare(value, name) {
  const normalized = candidateText(value, name);
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(normalized)) {
    throw candidateInputError(
      `Параметр ${name} должен быть числом от 0 до 1.`
    );
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw candidateInputError(
      `Параметр ${name} должен быть числом от 0 до 1.`
    );
  }
  return number;
}

function candidateBoolean(value, name) {
  const normalized = candidateText(value, name);
  if (normalized !== 'true' && normalized !== 'false') {
    throw candidateInputError(
      `Параметр ${name} должен быть true или false.`
    );
  }
  return normalized === 'true';
}

function candidateDate(value, name) {
  const normalized = candidateText(value, name);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  const timestamp = Date.parse(
    dateOnly ? `${normalized}T00:00:00.000Z` : normalized
  );
  if (
    !Number.isFinite(timestamp) ||
    (dateOnly &&
      new Date(timestamp).toISOString().slice(0, 10) !== normalized)
  ) {
    throw candidateInputError(
      `Параметр ${name} должен быть датой.`
    );
  }
  return normalized;
}

function candidateAsOf(value) {
  const normalized = candidateText(value, 'asOf');
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
      normalized
    ) ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    throw candidateInputError(
      'Параметр asOf должен быть ISO UTC datetime.'
    );
  }
  return new Date(Date.parse(normalized)).toISOString();
}

function parseOwnerLearningCandidatesQuery(query = {}) {
  for (const name of Object.keys(query)) {
    if (!CANDIDATE_QUERY_NAMES.has(name)) {
      throw candidateInputError(`Параметр ${name} не поддерживается.`);
    }
  }
  const filters = {};
  const analyticsOptions = {};
  const confidenceOptions = {};
  const rankingOptions = {};
  for (const name of ['supplier', 'brand', 'category', 'stableItemKey']) {
    if (query[name] !== undefined) {
      filters[name] = candidateText(query[name], name);
    }
  }
  if (query.source !== undefined) {
    filters.source = candidateEnum(query.source, 'source', SOURCES);
  }
  if (query.ownerDecision !== undefined) {
    filters.ownerDecision = candidateEnum(
      query.ownerDecision,
      'ownerDecision',
      OWNER_DECISIONS
    );
  }
  if (query.reasonCode !== undefined) {
    filters.reasonCode = candidateEnum(
      query.reasonCode,
      'reasonCode',
      REASON_CODES
    );
  }
  for (const name of ['dateFrom', 'dateTo']) {
    if (query[name] !== undefined) {
      filters[name] = candidateDate(query[name], name);
    }
  }
  if (
    filters.dateFrom &&
    filters.dateTo &&
    Date.parse(filters.dateFrom) > Date.parse(filters.dateTo)
  ) {
    throw candidateInputError('dateFrom не может быть позже dateTo.');
  }
  if (query.minOccurrences !== undefined) {
    analyticsOptions.minOccurrences = candidateInteger(
      query.minOccurrences,
      'minOccurrences'
    );
  }
  if (query.dominantShareThreshold !== undefined) {
    analyticsOptions.dominantShareThreshold = candidateShare(
      query.dominantShareThreshold,
      'dominantShareThreshold'
    );
  }
  if (query.maxItems !== undefined) {
    analyticsOptions.maxItems = candidateInteger(
      query.maxItems,
      'maxItems',
      MAX_ANALYTICS_ITEMS
    );
  }
  if (query.asOf !== undefined) {
    confidenceOptions.asOf = candidateAsOf(query.asOf);
  }
  if (query.maxEvidenceDecisionIds !== undefined) {
    confidenceOptions.maxEvidenceDecisionIds = candidateInteger(
      query.maxEvidenceDecisionIds,
      'maxEvidenceDecisionIds',
      100
    );
  }
  if (query.includeLowConfidence !== undefined) {
    confidenceOptions.includeLowConfidence = candidateBoolean(
      query.includeLowConfidence,
      'includeLowConfidence'
    );
  }
  if (query.minOccurrencesForEligibility !== undefined) {
    rankingOptions.minOccurrencesForEligibility = candidateInteger(
      query.minOccurrencesForEligibility,
      'minOccurrencesForEligibility'
    );
  }
  for (const name of [
    'minDominantShareForEligibility',
    'maxContradictionShareForEligibility',
  ]) {
    if (query[name] !== undefined) {
      rankingOptions[name] = candidateShare(query[name], name);
    }
  }
  if (query.includeIneligible !== undefined) {
    rankingOptions.includeIneligible = candidateBoolean(
      query.includeIneligible,
      'includeIneligible'
    );
  }
  if (query.limit !== undefined) {
    rankingOptions.limit = candidateInteger(query.limit, 'limit', 100);
  }
  return {
    filters,
    analyticsOptions,
    confidenceOptions,
    rankingOptions,
  };
}

async function readDecisionBody(request) {
  const contentType = String(request.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(
      'INVALID_OWNER_DECISION',
      'Решение должно быть передано как application/json.'
    );
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_DECISION_BODY_BYTES) {
      throw new HttpError(
        'INVALID_OWNER_DECISION',
        'Тело решения превышает допустимый размер.'
      );
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new HttpError(
      'INVALID_OWNER_DECISION',
      'Решение содержит некорректный JSON.',
      { cause: error }
    );
  }
}

function reportDateDependencies(reportDate) {
  if (!reportDate) return {};
  return {
    runAgent: (inputPath, phase2Inputs, options) =>
      runOrderAgentFromSmartZapasXlsxWithDemand(
        inputPath,
        phase2Inputs,
        { ...options, reportDate }
      ),
    buildMatrix: (inputPath, options) =>
      buildMatrixDraftFromSmartZapasXlsx(inputPath, {
        ...options,
        reportDate,
      }),
  };
}

function orchestrationHttpError(error) {
  if (error?.code === 'INVALID_RUN_REQUEST') {
    return new HttpError(
      'INPUT_CONTRACT_ERROR',
      'Входные параметры run не соответствуют контракту.',
      { cause: error }
    );
  }
  if (error?.code === 'PURCHASING_RUN_FAILED') {
    const causeText = String(error.cause?.message || '');
    const inputContract = /required|обязательн|column|колонк/i.test(causeText);
    return new HttpError(
      inputContract ? 'INPUT_CONTRACT_ERROR' : 'INVALID_WORKBOOK',
      inputContract
        ? 'Excel-файл не соответствует входному контракту SmartZapas.'
        : 'Excel-файл не удалось прочитать как отчёт SmartZapas.',
      { cause: error }
    );
  }
  return error;
}

function createRunHandlers(options) {
  const {
    registry,
    queryService,
    orchestrator = runPurchasingWebOrchestrator,
    uploadRoot = DEFAULT_UPLOAD_ROOT,
    serverPaths = DEFAULT_SERVER_PATHS,
    uuid = crypto.randomUUID,
    now = () => new Date().toISOString(),
    uploadOptions = {},
    runLock = DEFAULT_RUN_EXECUTION_LOCK,
    approvedRuleMode,
    ownerDecisionAnalyticsService,
    ownerLearningCandidatesService,
  } = options;

  if (
    !registry ||
    !queryService ||
    !ownerDecisionAnalyticsService ||
    !ownerLearningCandidatesService
  ) {
    throw new TypeError(
      'Registry, query service и owner learning services обязательны.'
    );
  }

  return {
    async createRun(request, context) {
      const releaseLock = runLock.tryAcquire();
      if (!releaseLock) {
        throw new HttpError(
          'RUN_ALREADY_IN_PROGRESS',
          'Другой purchasing run уже выполняется.'
        );
      }
      let upload = null;
      let runId = null;
      let processingCreated = false;
      try {
        upload = await parseExcelUpload(request, {
          ...uploadOptions,
          uploadRoot,
          requestId: context.requestId,
        });
        runId = uuid();
        const generatedAt = now();
        registry.createProcessingRun({
          runId,
          createdAt: generatedAt,
          startedAt: generatedAt,
          stage: 'purchasing',
          source: {
            original_name: upload.originalName,
            size_bytes: upload.sizeBytes,
            sha256: upload.sha256,
          },
        });
        processingCreated = true;

        const bundle = await orchestrator({
          runId,
          inputPath: upload.inputPath,
          generatedAt,
          financialDataPath: serverPaths.financialDataPath,
          configPath: serverPaths.configPath,
          matrixPath: serverPaths.matrixPath,
          ownerDecisionsPath: serverPaths.ownerDecisionsPath,
          approvedRulesPath: serverPaths.approvedRulesPath,
          approvedRuleMode,
          recommendationConfigPath:
            serverPaths.recommendationConfigPath,
        }, reportDateDependencies(upload.reportDate));
        const saved = registry.saveCompletedRun(bundle, {
          completedAt: now(),
        });
        return {
          statusCode: 201,
          headers: {
            Location: `/api/v1/runs/${runId}`,
          },
          data: saved.status,
          runId,
        };
      } catch (rawError) {
        const error = orchestrationHttpError(rawError);
        if (processingCreated) {
          try {
            registry.saveFailedRun(runId, error, {
              stage: 'failed',
              completedAt: now(),
              requestId: context.requestId,
            });
          } catch (storageError) {
            throw new HttpError(
              'STORAGE_ERROR',
              'Не удалось сохранить ошибку run.',
              { cause: storageError }
            );
          }
        }
        throw Object.assign(error, { runId });
      } finally {
        try {
          if (upload?.cleanup) upload.cleanup();
          else cleanupUploadDirectory(uploadRoot, context.requestId);
        } finally {
          releaseLock();
        }
      }
    },

    getRunStatus(runId) {
      return {
        statusCode: 200,
        data: queryService.getRunStatus(runId),
        runId,
      };
    },

    getRunSummary(runId) {
      return {
        statusCode: 200,
        data: queryService.getRunSummary(runId),
        runId,
      };
    },

    listItems(runId, query) {
      return {
        statusCode: 200,
        data: queryService.listItems(runId, query),
        runId,
      };
    },

    async saveOwnerDecision(runId, itemId, request) {
      const input = await readDecisionBody(request);
      return {
        statusCode: 200,
        data: queryService.saveOwnerDecision(runId, itemId, input),
        runId,
      };
    },

    getOwnerReview(runId, query) {
      return {
        statusCode: 200,
        data: queryService.getOwnerReview(runId, query),
        runId,
      };
    },

    getOwnerDecisionAnalytics(query) {
      const input = parseOwnerDecisionAnalyticsQuery(query);
      const result = ownerDecisionAnalyticsService.getAnalytics(input);
      return {
        statusCode: 200,
        data: mapOwnerDecisionAnalytics(result),
      };
    },

    getOwnerLearningCandidates(query) {
      const input = parseOwnerLearningCandidatesQuery(query);
      const result = ownerLearningCandidatesService.getCandidates(input);
      return {
        statusCode: 200,
        data: mapOwnerLearningCandidates(result),
      };
    },

    listArtifacts(runId) {
      return {
        statusCode: 200,
        data: {
          run_id: runId,
          artifacts: queryService.listArtifacts(runId),
        },
        runId,
      };
    },

    async downloadArtifact(runId, rawArtifactName, response) {
      await streamArtifact({
        artifactStore: registry.artifactStore,
        queryService,
        response,
        runId,
        rawArtifactName,
      });
      return { streamed: true, runId };
    },
  };
}

module.exports = {
  MAX_ANALYTICS_ITEMS,
  MAX_DECISION_BODY_BYTES,
  createRunHandlers,
  orchestrationHttpError,
  readDecisionBody,
  parseOwnerDecisionAnalyticsQuery,
  parseOwnerLearningCandidatesQuery,
  reportDateDependencies,
};
