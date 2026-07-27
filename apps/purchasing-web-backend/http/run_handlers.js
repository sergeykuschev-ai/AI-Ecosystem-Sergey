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
  mapOwnerLearningCenter,
} = require('../dto/owner_learning_center_mapper');
const {
  mapFindings: mapKnowledgeHealthFindings,
  mapKnowledgeHealth,
  mapRuleHealth: mapKnowledgeRuleHealth,
} = require('../dto/owner_knowledge_health_mapper');
const {
  mapLifecycleList,
  mapLifecycleState,
} = require('../dto/owner_learning_candidate_lifecycle_mapper');
const {
  mapMaterializationEvent,
  mapMaterializationList,
  mapMaterializationResult,
} = require('../dto/owner_rule_materialization_mapper');
const {
  mapOwnerMaterializedRuleDetail,
  mapOwnerMaterializedRules,
} = require('../dto/owner_materialized_rules_mapper');
const {
  mapStatusChange,
  mapStatusHistory,
  mapStatusPreview,
} = require('../dto/owner_rule_status_mapper');
const {
  mapDetail: mapRuleEffectivenessDetail,
  mapEvents: mapRuleEffectivenessEvents,
  mapList: mapRuleEffectivenessList,
} = require('../dto/owner_rule_effectiveness_mapper');
const {
  ACTIONS: LIFECYCLE_ACTIONS,
  MAX_OWNER_COMMENT_LENGTH,
  REASON_CODES: LIFECYCLE_REASON_CODES,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_candidate_lifecycle'
);
const {
  OWNER_DECISIONS,
  REASON_CODES,
  SOURCES,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);

const MAX_DECISION_BODY_BYTES = 4096;
const MAX_LIFECYCLE_BODY_BYTES = 4096;
const MAX_MATERIALIZATION_BODY_BYTES = 1024;
const MAX_RULE_STATUS_BODY_BYTES = 4096;
const RULE_STATUS_PREVIEW_BODY_FIELDS = new Set([
  'targetStatus',
  'runId',
]);
const RULE_STATUS_BODY_FIELDS = new Set([
  'targetStatus',
  'previewId',
  'confirmation',
  'reasonCode',
  'ownerComment',
]);
const LIFECYCLE_TARGET_STATUSES = Object.freeze([
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'POSTPONED',
]);
const LIFECYCLE_BODY_FIELDS = new Set([
  'targetStatus',
  'action',
  'reasonCode',
  'ownerComment',
]);
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
const MATERIALIZED_RULE_FILTER_NAMES = Object.freeze([
  'status',
  'decision',
  'confidenceLevel',
  'priorityLevel',
  'lifecycleStatus',
  'candidateAvailability',
  'dateFrom',
  'dateTo',
  'search',
]);
const MATERIALIZED_RULE_OPTION_NAMES = Object.freeze([
  'sortBy',
  'sortDirection',
  'limit',
]);
const MATERIALIZED_RULE_QUERY_NAMES = new Set([
  ...MATERIALIZED_RULE_FILTER_NAMES,
  ...MATERIALIZED_RULE_OPTION_NAMES,
]);
const RULE_EFFECTIVENESS_FILTER_NAMES = Object.freeze([
  'ruleStatus',
  'decision',
  'classification',
  'confidenceLevel',
  'priorityLevel',
  'dateFrom',
  'dateTo',
  'search',
]);
const RULE_EFFECTIVENESS_OPTION_NAMES = Object.freeze([
  'asOf',
  'staleAfterDays',
  'reviewAfterConsecutiveNoEffect',
  'minEvaluatedRuns',
  'sortBy',
  'sortDirection',
  'limit',
]);
const RULE_EFFECTIVENESS_QUERY_NAMES = new Set([
  ...RULE_EFFECTIVENESS_FILTER_NAMES,
  ...RULE_EFFECTIVENESS_OPTION_NAMES,
]);
const OWNER_LEARNING_CENTER_QUERY_NAMES = new Set([
  'supplier',
  'brand',
  'category',
  'dateFrom',
  'dateTo',
  'attentionLimit',
  'activityLimit',
  'asOf',
]);
const KNOWLEDGE_HEALTH_FILTER_NAMES = Object.freeze([
  'status',
  'decision',
  'grade',
  'classification',
  'findingType',
  'severity',
  'confidenceLevel',
  'priorityLevel',
  'search',
]);
const KNOWLEDGE_HEALTH_OPTION_NAMES = Object.freeze([
  'asOf',
  'staleRuleAfterDays',
  'oldRuleAfterDays',
  'noEffectRunThreshold',
  'minEffectivenessRuns',
  'sortBy',
  'sortDirection',
  'limit',
]);
const KNOWLEDGE_HEALTH_QUERY_NAMES = new Set([
  ...KNOWLEDGE_HEALTH_FILTER_NAMES,
  ...KNOWLEDGE_HEALTH_OPTION_NAMES,
]);

function parseOwnerKnowledgeHealthQuery(query = {}) {
  for (const name of Object.keys(query)) {
    if (!KNOWLEDGE_HEALTH_QUERY_NAMES.has(name)) {
      throw new HttpError(
        'OWNER_KNOWLEDGE_HEALTH_INVALID_INPUT',
        `Параметр ${name} не поддерживается.`
      );
    }
  }
  const filters = {};
  const options = {};
  for (const name of KNOWLEDGE_HEALTH_FILTER_NAMES) {
    if (query[name] !== undefined) filters[name] = query[name];
  }
  for (const name of [
    'asOf',
    'sortBy',
    'sortDirection',
  ]) {
    if (query[name] !== undefined) options[name] = query[name];
  }
  for (const name of [
    'staleRuleAfterDays',
    'oldRuleAfterDays',
    'noEffectRunThreshold',
    'minEffectivenessRuns',
    'limit',
  ]) {
    if (query[name] === undefined) continue;
    if (!/^\d+$/.test(query[name])) {
      throw new HttpError(
        'OWNER_KNOWLEDGE_HEALTH_INVALID_INPUT',
        `Параметр ${name} должен быть положительным целым числом.`
      );
    }
    const value = Number(query[name]);
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      (name === 'limit' && value > 100)
    ) {
      throw new HttpError(
        'OWNER_KNOWLEDGE_HEALTH_INVALID_INPUT',
        `Параметр ${name} вне допустимого диапазона.`
      );
    }
    options[name] = value;
  }
  return { filters, options };
}

function centerInputError(message) {
  return new HttpError(
    'OWNER_LEARNING_CENTER_INVALID_INPUT',
    message
  );
}

function centerText(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > 512 ||
    value.includes('\0')
  ) {
    throw centerInputError(
      `Параметр ${name} имеет неверное значение.`
    );
  }
  return value.trim();
}

function parseOwnerLearningCenterQuery(query = {}) {
  for (const name of Object.keys(query)) {
    if (!OWNER_LEARNING_CENTER_QUERY_NAMES.has(name)) {
      throw centerInputError(`Параметр ${name} не поддерживается.`);
    }
  }
  const filters = {};
  const options = {};
  for (const name of ['supplier', 'brand', 'category']) {
    if (query[name] !== undefined) {
      filters[name] = centerText(query[name], name);
    }
  }
  for (const name of ['dateFrom', 'dateTo']) {
    if (query[name] !== undefined) {
      filters[name] = centerText(query[name], name);
    }
  }
  if (
    filters.dateFrom &&
    filters.dateTo &&
    Date.parse(filters.dateFrom) > Date.parse(filters.dateTo)
  ) {
    throw centerInputError('dateFrom не может быть позже dateTo.');
  }
  for (const name of ['attentionLimit', 'activityLimit']) {
    if (query[name] === undefined) continue;
    const normalized = centerText(query[name], name);
    const value = Number(normalized);
    if (
      !/^\d+$/.test(normalized) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > 100
    ) {
      throw centerInputError(
        `Параметр ${name} должен быть от 1 до 100.`
      );
    }
    options[name] = value;
  }
  if (query.asOf !== undefined) {
    const normalized = centerText(query.asOf, 'asOf');
    const timestamp = Date.parse(normalized);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
        normalized
      ) ||
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 19) !==
        normalized.slice(0, 19)
    ) {
      throw centerInputError(
        'Параметр asOf должен быть ISO UTC datetime.'
      );
    }
    options.asOf = new Date(timestamp).toISOString();
  }
  return { filters, options };
}

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

function materializedRulesInputError(message) {
  return new HttpError(
    'OWNER_MATERIALIZED_RULES_INVALID_INPUT',
    message
  );
}

function materializedRulesText(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > 512 ||
    value.includes('\0')
  ) {
    throw materializedRulesInputError(
      `Параметр ${name} имеет неверное значение.`
    );
  }
  return value.trim();
}

function materializedRulesEnum(value, name, values) {
  const normalized = materializedRulesText(
    value,
    name
  ).toUpperCase();
  if (!values.includes(normalized)) {
    throw materializedRulesInputError(
      `Параметр ${name} не поддерживается.`
    );
  }
  return normalized;
}

function materializedRulesDate(value, name) {
  const normalized = materializedRulesText(value, name);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  const source = dateOnly
    ? `${normalized}T${
      name === 'dateTo' ? '23:59:59.999' : '00:00:00.000'
    }Z`
    : normalized;
  if (
    !Number.isFinite(Date.parse(source)) ||
    (!dateOnly && !normalized.endsWith('Z')) ||
    (
      dateOnly &&
      new Date(Date.parse(source)).toISOString().slice(0, 10) !==
        normalized
    )
  ) {
    throw materializedRulesInputError(
      `Параметр ${name} должен быть UTC-датой.`
    );
  }
  return new Date(Date.parse(source)).toISOString();
}

function parseOwnerMaterializedRulesQuery(query = {}) {
  for (const name of Object.keys(query)) {
    if (!MATERIALIZED_RULE_QUERY_NAMES.has(name)) {
      throw materializedRulesInputError(
        `Параметр ${name} не поддерживается.`
      );
    }
  }
  const filters = {};
  const options = {};
  const enums = {
    status: ['ACTIVE', 'DISABLED'],
    decision: ['BUY', 'SKIP', 'DEFER'],
    confidenceLevel: ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'],
    priorityLevel: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    lifecycleStatus: [
      'NEW',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'POSTPONED',
    ],
    candidateAvailability: ['AVAILABLE', 'UNAVAILABLE'],
  };
  for (const [name, values] of Object.entries(enums)) {
    if (query[name] !== undefined) {
      filters[name] = materializedRulesEnum(
        query[name],
        name,
        values
      );
    }
  }
  for (const name of ['dateFrom', 'dateTo']) {
    if (query[name] !== undefined) {
      filters[name] = materializedRulesDate(query[name], name);
    }
  }
  if (
    filters.dateFrom &&
    filters.dateTo &&
    Date.parse(filters.dateFrom) > Date.parse(filters.dateTo)
  ) {
    throw materializedRulesInputError(
      'dateFrom не может быть позже dateTo.'
    );
  }
  if (query.search !== undefined) {
    filters.search = materializedRulesText(query.search, 'search');
  }
  if (query.sortBy !== undefined) {
    const sortBy = materializedRulesText(query.sortBy, 'sortBy');
    if (![
      'materializedAt',
      'updatedAt',
      'confidenceScore',
      'priorityScore',
      'decision',
      'status',
    ].includes(sortBy)) {
      throw materializedRulesInputError(
        'Параметр sortBy не поддерживается.'
      );
    }
    options.sortBy = sortBy;
  }
  if (query.sortDirection !== undefined) {
    const direction = materializedRulesText(
      query.sortDirection,
      'sortDirection'
    ).toLowerCase();
    if (!['asc', 'desc'].includes(direction)) {
      throw materializedRulesInputError(
        'Параметр sortDirection не поддерживается.'
      );
    }
    options.sortDirection = direction;
  }
  if (query.limit !== undefined) {
    const normalized = materializedRulesText(query.limit, 'limit');
    const limit = Number(normalized);
    if (
      !/^\d+$/.test(normalized) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw materializedRulesInputError(
        'Параметр limit должен быть от 1 до 100.'
      );
    }
    options.limit = limit;
  }
  return { filters, options };
}

function ruleEffectivenessInputError(message) {
  return new HttpError(
    'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
    message
  );
}

function ruleEffectivenessText(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > 512 ||
    value.includes('\0')
  ) {
    throw ruleEffectivenessInputError(
      `Параметр ${name} имеет неверное значение.`
    );
  }
  return value.trim();
}

function parseOwnerRuleEffectivenessQuery(query = {}) {
  for (const name of Object.keys(query)) {
    if (!RULE_EFFECTIVENESS_QUERY_NAMES.has(name)) {
      throw ruleEffectivenessInputError(
        `Параметр ${name} не поддерживается.`
      );
    }
  }
  const filters = {};
  const options = {};
  const enums = {
    ruleStatus: ['ACTIVE', 'DISABLED'],
    decision: ['BUY', 'SKIP', 'DEFER'],
    classification: [
      'EFFECTIVE',
      'OCCASIONAL',
      'NO_EFFECT_YET',
      'STALE',
      'REVIEW_RECOMMENDED',
      'INSUFFICIENT_DATA',
    ],
    confidenceLevel: ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'],
    priorityLevel: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
  };
  for (const [name, values] of Object.entries(enums)) {
    if (query[name] !== undefined) {
      const normalized = ruleEffectivenessText(
        query[name],
        name
      ).toUpperCase();
      if (!values.includes(normalized)) {
        throw ruleEffectivenessInputError(
          `Параметр ${name} не поддерживается.`
        );
      }
      filters[name] = normalized;
    }
  }
  for (const name of ['dateFrom', 'dateTo']) {
    if (query[name] !== undefined) {
      filters[name] = materializedRulesDate(query[name], name);
    }
  }
  if (
    filters.dateFrom &&
    filters.dateTo &&
    Date.parse(filters.dateFrom) > Date.parse(filters.dateTo)
  ) {
    throw ruleEffectivenessInputError(
      'dateFrom не может быть позже dateTo.'
    );
  }
  if (query.search !== undefined) {
    filters.search = ruleEffectivenessText(query.search, 'search');
  }
  if (query.asOf !== undefined) {
    const asOf = ruleEffectivenessText(query.asOf, 'asOf');
    if (!asOf.endsWith('Z') || !Number.isFinite(Date.parse(asOf))) {
      throw ruleEffectivenessInputError(
        'Параметр asOf должен быть ISO UTC datetime.'
      );
    }
    options.asOf = new Date(Date.parse(asOf)).toISOString();
  }
  for (const name of [
    'staleAfterDays',
    'reviewAfterConsecutiveNoEffect',
    'minEvaluatedRuns',
    'limit',
  ]) {
    if (query[name] !== undefined) {
      const normalized = ruleEffectivenessText(query[name], name);
      const value = Number(normalized);
      if (
        !/^\d+$/.test(normalized) ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        (name === 'limit' && value > 100)
      ) {
        throw ruleEffectivenessInputError(
          `Параметр ${name} имеет неверное значение.`
        );
      }
      options[name] = value;
    }
  }
  if (query.sortBy !== undefined) {
    const sortBy = ruleEffectivenessText(query.sortBy, 'sortBy');
    if (![
      'lastAppliedAt',
      'effectRate',
      'totalOrderAmountDelta',
      'evaluatedRuns',
      'classification',
      'updatedAt',
    ].includes(sortBy)) {
      throw ruleEffectivenessInputError(
        'Параметр sortBy не поддерживается.'
      );
    }
    options.sortBy = sortBy;
  }
  if (query.sortDirection !== undefined) {
    const direction = ruleEffectivenessText(
      query.sortDirection,
      'sortDirection'
    ).toLowerCase();
    if (!['asc', 'desc'].includes(direction)) {
      throw ruleEffectivenessInputError(
        'Параметр sortDirection не поддерживается.'
      );
    }
    options.sortDirection = direction;
  }
  return { filters, options };
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

function lifecycleInputError(message) {
  return new HttpError(
    'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
    message
  );
}

async function readLifecycleBody(request) {
  const contentType = String(request.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw lifecycleInputError(
      'Изменение статуса должно быть передано как application/json.'
    );
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_LIFECYCLE_BODY_BYTES) {
      throw lifecycleInputError(
        'Тело изменения статуса превышает допустимый размер.'
      );
    }
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new HttpError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      'Изменение статуса содержит некорректный JSON.',
      { cause: error }
    );
  }
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    throw lifecycleInputError(
      'Изменение статуса должно быть объектом.'
    );
  }
  for (const name of Object.keys(input)) {
    if (!LIFECYCLE_BODY_FIELDS.has(name)) {
      throw lifecycleInputError(
        `Поле ${name} не поддерживается.`
      );
    }
  }
  const enumField = (name, values, fallback = null) => {
    if (input[name] === undefined && fallback !== null) return fallback;
    if (typeof input[name] !== 'string') {
      throw lifecycleInputError(`Поле ${name} имеет неверное значение.`);
    }
    const normalized = input[name].trim().toUpperCase();
    if (!values.includes(normalized)) {
      throw lifecycleInputError(`Поле ${name} не поддерживается.`);
    }
    return normalized;
  };
  let ownerComment = null;
  if (input.ownerComment !== undefined && input.ownerComment !== null) {
    if (
      typeof input.ownerComment !== 'string' ||
      input.ownerComment.length > MAX_OWNER_COMMENT_LENGTH
    ) {
      throw lifecycleInputError(
        'Комментарий владельца превышает допустимую длину.'
      );
    }
    ownerComment = input.ownerComment.trim() || null;
  }
  return {
    targetStatus: enumField(
      'targetStatus',
      LIFECYCLE_TARGET_STATUSES
    ),
    action: enumField('action', LIFECYCLE_ACTIONS),
    reasonCode: enumField(
      'reasonCode',
      LIFECYCLE_REASON_CODES,
      'NOT_SPECIFIED'
    ),
    ownerComment,
  };
}

async function readMaterializationBody(request) {
  const contentType = String(request.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
      'Materialization должна быть передана как application/json.'
    );
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_MATERIALIZATION_BODY_BYTES) {
      throw new HttpError(
        'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
        'Тело materialization превышает допустимый размер.'
      );
    }
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new HttpError(
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
      'Materialization содержит некорректный JSON.',
      { cause: error }
    );
  }
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(name => name !== 'confirmation')
  ) {
    throw new HttpError(
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
      'Materialization содержит неподдерживаемые поля.'
    );
  }
  if (input.confirmation !== true) {
    throw new HttpError(
      'OWNER_RULE_MATERIALIZATION_CONFIRMATION_REQUIRED',
      'Необходимо явно подтвердить создание неактивного правила.'
    );
  }
  return { confirmation: true };
}

async function readRuleStatusJson(request, allowedFields) {
  const contentType = String(request.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'Запрос статуса правила должен быть application/json.'
    );
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_RULE_STATUS_BODY_BYTES) {
      throw new HttpError(
        'OWNER_RULE_STATUS_INVALID_INPUT',
        'Тело запроса статуса правила превышает допустимый размер.'
      );
    }
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (cause) {
    throw new HttpError(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'Запрос статуса правила содержит некорректный JSON.',
      { cause }
    );
  }
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(name => !allowedFields.has(name))
  ) {
    throw new HttpError(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'Запрос статуса правила содержит неподдерживаемые поля.'
    );
  }
  return input;
}

async function readRuleStatusPreviewBody(request) {
  return readRuleStatusJson(
    request,
    RULE_STATUS_PREVIEW_BODY_FIELDS
  );
}

async function readRuleStatusBody(request) {
  return readRuleStatusJson(request, RULE_STATUS_BODY_FIELDS);
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
    ownerLearningCandidateLifecycleService,
    ownerRuleMaterializationService,
    ownerMaterializedRulesService,
    ownerRuleEffectivenessService,
    ownerKnowledgeHealthService,
    ownerRuleStatusService,
    ownerLearningCenterService,
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
          ownerLearningRuleEffectivenessFilePath:
            serverPaths.ownerLearningRuleEffectivenessFilePath,
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

    getOwnerLearningCenter(query) {
      const input = parseOwnerLearningCenterQuery(query);
      return {
        statusCode: 200,
        data: mapOwnerLearningCenter(
          ownerLearningCenterService.getOverview(input)
        ),
      };
    },

    getOwnerKnowledgeHealth(query) {
      const input = parseOwnerKnowledgeHealthQuery(query);
      return {
        statusCode: 200,
        data: mapKnowledgeHealth(
          ownerKnowledgeHealthService.getKnowledgeHealth(input)
        ),
      };
    },

    getOwnerKnowledgeRuleHealth(ruleId, query) {
      const input = parseOwnerKnowledgeHealthQuery(query);
      return {
        statusCode: 200,
        data: mapKnowledgeRuleHealth(
          ownerKnowledgeHealthService.getRuleHealth({
            ruleId,
            options: input.options,
          })
        ),
      };
    },

    getOwnerKnowledgeHealthFindings(query) {
      const input = parseOwnerKnowledgeHealthQuery(query);
      return {
        statusCode: 200,
        data: mapKnowledgeHealthFindings(
          ownerKnowledgeHealthService.getFindings(input)
        ),
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

    getOwnerLearningCandidateStates() {
      const result =
        ownerLearningCandidateLifecycleService.getCandidateStates();
      return {
        statusCode: 200,
        data: mapLifecycleList(result),
      };
    },

    getOwnerLearningCandidateState(candidateId) {
      const result =
        ownerLearningCandidateLifecycleService.getCandidateState({
          candidateId,
        });
      return {
        statusCode: 200,
        data: mapLifecycleState(result, { includeComment: true }),
      };
    },

    async changeOwnerLearningCandidateStatus(candidateId, request) {
      const input = await readLifecycleBody(request);
      const result =
        ownerLearningCandidateLifecycleService.changeCandidateStatus({
          candidateId,
          ...input,
        });
      return {
        statusCode: 200,
        data: {
          ...mapLifecycleState(result.state),
          duplicate: result.added === false,
        },
      };
    },

    listOwnerRuleMaterializations() {
      return {
        statusCode: 200,
        data: mapMaterializationList(
          ownerRuleMaterializationService.listMaterializations()
        ),
      };
    },

    getOwnerRuleMaterialization(candidateId) {
      return {
        statusCode: 200,
        data: mapMaterializationEvent(
          ownerRuleMaterializationService
            .getMaterializationByCandidate({ candidateId })
        ),
      };
    },

    async materializeOwnerRule(candidateId, request) {
      await readMaterializationBody(request);
      const result =
        ownerRuleMaterializationService.materializeCandidateRule({
          candidateId,
        });
      return {
        statusCode: result.status === 'CREATED' ? 201 : 200,
        data: mapMaterializationResult(result),
      };
    },

    listOwnerMaterializedRules(query) {
      const input = parseOwnerMaterializedRulesQuery(query);
      return {
        statusCode: 200,
        data: mapOwnerMaterializedRules(
          ownerMaterializedRulesService.listRules(input)
        ),
      };
    },

    getOwnerMaterializedRule(ruleId) {
      return {
        statusCode: 200,
        data: mapOwnerMaterializedRuleDetail(
          ownerMaterializedRulesService.getRule({ ruleId })
        ),
      };
    },

    listOwnerRuleEffectiveness(query) {
      const input = parseOwnerRuleEffectivenessQuery(query);
      return {
        statusCode: 200,
        data: mapRuleEffectivenessList(
          ownerRuleEffectivenessService
            .listRuleEffectiveness(input)
        ),
      };
    },

    getOwnerRuleEffectiveness(ruleId, query) {
      const input = parseOwnerRuleEffectivenessQuery(query);
      return {
        statusCode: 200,
        data: mapRuleEffectivenessDetail(
          ownerRuleEffectivenessService.getRuleEffectiveness({
            ruleId,
            options: input.options,
          })
        ),
      };
    },

    getOwnerRuleEffectivenessEvents(ruleId, query) {
      const input = parseOwnerRuleEffectivenessQuery(query);
      return {
        statusCode: 200,
        data: mapRuleEffectivenessEvents(
          ownerRuleEffectivenessService
            .getRuleEffectivenessEvents({
              ruleId,
              filters: input.filters,
              options: input.options,
            })
        ),
      };
    },

    async previewOwnerRuleStatus(ruleId, request) {
      const input = await readRuleStatusPreviewBody(request);
      return {
        statusCode: 200,
        data: mapStatusPreview(
          ownerRuleStatusService.previewStatusChange({
            ruleId,
            ...input,
          })
        ),
      };
    },

    async changeOwnerRuleStatus(ruleId, request) {
      const input = await readRuleStatusBody(request);
      return {
        statusCode: 200,
        data: mapStatusChange(
          ownerRuleStatusService.changeStatus({
            ruleId,
            ...input,
          })
        ),
      };
    },

    getOwnerRuleStatusHistory(ruleId) {
      return {
        statusCode: 200,
        data: mapStatusHistory(
          ownerRuleStatusService.getRuleStatusHistory({ ruleId })
        ),
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
  MAX_LIFECYCLE_BODY_BYTES,
  MAX_MATERIALIZATION_BODY_BYTES,
  MAX_RULE_STATUS_BODY_BYTES,
  createRunHandlers,
  orchestrationHttpError,
  readDecisionBody,
  readLifecycleBody,
  readMaterializationBody,
  readRuleStatusBody,
  readRuleStatusPreviewBody,
  parseOwnerDecisionAnalyticsQuery,
  parseOwnerLearningCenterQuery,
  parseOwnerKnowledgeHealthQuery,
  parseOwnerLearningCandidatesQuery,
  parseOwnerMaterializedRulesQuery,
  parseOwnerRuleEffectivenessQuery,
  reportDateDependencies,
};
