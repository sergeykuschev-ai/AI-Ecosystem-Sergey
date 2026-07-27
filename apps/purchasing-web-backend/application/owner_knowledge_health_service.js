const {
  ERROR_CODE,
  SEVERITY_ORDER,
  analyzeKnowledgeHealth,
} = require(
  '../../../agents/purchasing/owner_learning/owner_knowledge_health'
);

const RULE_NOT_FOUND = 'OWNER_KNOWLEDGE_HEALTH_RULE_NOT_FOUND';
const FILTER_VALUES = Object.freeze({
  status: Object.freeze(['ACTIVE', 'DISABLED']),
  decision: Object.freeze(['BUY', 'SKIP', 'DEFER']),
  grade: Object.freeze([
    'EXCELLENT',
    'GOOD',
    'FAIR',
    'POOR',
    'CRITICAL',
  ]),
  classification: Object.freeze([
    'HEALTHY',
    'MONITOR',
    'REVIEW',
    'CRITICAL',
    'INSUFFICIENT_DATA',
  ]),
  findingType: Object.freeze([
    'RULE_CONFLICT',
    'RULE_DUPLICATE',
    'RULE_STALE',
    'RULE_NO_EFFECT',
    'RULE_REVIEW_RECOMMENDED',
    'RULE_LOW_CONFIDENCE',
    'RULE_LOW_PRIORITY',
    'RULE_MISSING_PROVENANCE',
    'RULE_MATERIALIZATION_MISSING',
    'RULE_LIFECYCLE_INCONSISTENT',
    'RULE_STATUS_HISTORY_INCONSISTENT',
    'RULE_EFFECTIVENESS_UNAVAILABLE',
    'RULE_SCOPE_TOO_BROAD',
    'RULE_UNSUPPORTED_TYPE',
    'RULE_DATA_QUALITY_ISSUE',
    'ACTIVE_RULE_WITHOUT_EFFECT_DATA',
    'DISABLED_RULE_WITH_EFFECT_EVENTS',
    'ACTIVE_RULE_NEVER_APPLIED',
    'RULE_LAST_UPDATED_TOO_OLD',
  ]),
  severity: Object.freeze([
    'INFO',
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL',
  ]),
  confidenceLevel: Object.freeze([
    'LOW',
    'MEDIUM',
    'HIGH',
    'VERY_HIGH',
  ]),
  priorityLevel: Object.freeze([
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL',
  ]),
});
const SORT_FIELDS = Object.freeze([
  'score',
  'grade',
  'severity',
  'updatedAt',
  'lastAppliedAt',
  'displayScope',
]);
const GRADE_ORDER = Object.freeze({
  CRITICAL: 0,
  POOR: 1,
  FAIR: 2,
  GOOD: 3,
  EXCELLENT: 4,
});

class OwnerKnowledgeHealthServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerKnowledgeHealthServiceError';
    this.code = code;
  }
}

function invalid(message) {
  throw new OwnerKnowledgeHealthServiceError(ERROR_CODE, message);
}

function optionalText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeInput({ filters = {}, options = {} } = {}, now) {
  if (
    !filters ||
    typeof filters !== 'object' ||
    Array.isArray(filters) ||
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    invalid('Filters и options должны быть объектами.');
  }
  for (const name of Object.keys(filters)) {
    if (!Object.hasOwn(FILTER_VALUES, name) && name !== 'search') {
      invalid(`Фильтр ${name} не поддерживается.`);
    }
  }
  const healthOptions = new Set([
    'asOf',
    'staleRuleAfterDays',
    'oldRuleAfterDays',
    'noEffectRunThreshold',
    'minEffectivenessRuns',
  ]);
  for (const name of Object.keys(options)) {
    if (
      !healthOptions.has(name) &&
      !['sortBy', 'sortDirection', 'limit'].includes(name)
    ) {
      invalid(`Option ${name} не поддерживается.`);
    }
  }
  const normalizedFilters = {};
  for (const [name, values] of Object.entries(FILTER_VALUES)) {
    if (
      filters[name] === undefined ||
      filters[name] === null ||
      filters[name] === ''
    ) {
      normalizedFilters[name] = null;
      continue;
    }
    const value = optionalText(filters[name])?.toUpperCase();
    if (!value || !values.includes(value)) {
      invalid(`Фильтр ${name} не поддерживается.`);
    }
    normalizedFilters[name] = value;
  }
  if (filters.search === undefined || filters.search === null) {
    normalizedFilters.search = null;
  } else {
    const search = optionalText(filters.search);
    if (!search || search.length > 512 || search.includes('\0')) {
      invalid('Фильтр search имеет неверное значение.');
    }
    normalizedFilters.search = search.toLocaleLowerCase('ru');
  }
  const nowValue = now();
  const date = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (!Number.isFinite(date.getTime())) {
    invalid('now должен возвращать допустимую дату.');
  }
  const health = {
    asOf: options.asOf || date.toISOString(),
  };
  for (const name of [
    'staleRuleAfterDays',
    'oldRuleAfterDays',
    'noEffectRunThreshold',
    'minEffectivenessRuns',
  ]) {
    if (options[name] !== undefined) health[name] = options[name];
  }
  const sortBy = optionalText(options.sortBy);
  if (sortBy && !SORT_FIELDS.includes(sortBy)) {
    invalid('Option sortBy не поддерживается.');
  }
  const sortDirection =
    optionalText(options.sortDirection)?.toLowerCase() || 'desc';
  if (!['asc', 'desc'].includes(sortDirection)) {
    invalid('Option sortDirection не поддерживается.');
  }
  const limit = options.limit === undefined ? 100 : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    invalid('Option limit должен быть целым числом от 1 до 100.');
  }
  return {
    filters: normalizedFilters,
    options: {
      health,
      sortBy,
      sortDirection,
      limit,
    },
  };
}

function maximumSeverity(rule) {
  return rule.findings.reduce(
    (current, finding) =>
      Math.min(current, SEVERITY_ORDER[finding.severity]),
    SEVERITY_ORDER.INFO
  );
}

function compareNullable(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left).localeCompare(String(right), 'ru');
}

function sortRules(rules, options) {
  if (!options.sortBy) {
    return rules.slice().sort((left, right) =>
      maximumSeverity(left) - maximumSeverity(right) ||
      left.score - right.score ||
      left.ruleId.localeCompare(right.ruleId, 'en')
    );
  }
  const value = rule => ({
    score: rule.score,
    grade: GRADE_ORDER[rule.grade],
    severity: -maximumSeverity(rule),
    updatedAt: rule.updatedAt,
    lastAppliedAt: rule.lastAppliedAt,
    displayScope: rule.displayScope?.primary,
  })[options.sortBy];
  const direction = options.sortDirection === 'asc' ? 1 : -1;
  return rules.slice().sort((left, right) =>
    compareNullable(value(left), value(right)) * direction ||
    left.ruleId.localeCompare(right.ruleId, 'en')
  );
}

function matchesRule(rule, filters) {
  const value = {
    status: rule.status,
    decision: rule.decision,
    grade: rule.grade,
    classification: rule.classification,
    confidenceLevel: rule.signals.confidenceLevel,
    priorityLevel: rule.signals.priorityLevel,
  };
  for (const name of [
    'status',
    'decision',
    'grade',
    'classification',
    'confidenceLevel',
    'priorityLevel',
  ]) {
    if (filters[name] && value[name] !== filters[name]) return false;
  }
  if (
    filters.findingType &&
    !rule.findings.some(item => item.type === filters.findingType)
  ) return false;
  if (
    filters.severity &&
    !rule.findings.some(item => item.severity === filters.severity)
  ) return false;
  if (filters.search) {
    const haystack = [
      rule.ruleId,
      rule.displayScope?.primary,
      rule.displayScope?.secondary,
    ].filter(Boolean).join('\n').toLocaleLowerCase('ru');
    if (!haystack.includes(filters.search)) return false;
  }
  return true;
}

function matchesFinding(finding, filters, visibleRuleIds) {
  if (filters.findingType && finding.type !== filters.findingType) {
    return false;
  }
  if (filters.severity && finding.severity !== filters.severity) {
    return false;
  }
  return finding.ruleIds.length === 0 ||
    finding.ruleIds.some(id => visibleRuleIds.has(id));
}

function unavailable(warnings = []) {
  return {
    status: 'UNAVAILABLE',
    generatedAt: null,
    score: null,
    grade: null,
    summary: null,
    dimensions: null,
    findings: [],
    rules: [],
    dataQuality: null,
    explanationCodes: [],
    warnings,
  };
}

class OwnerKnowledgeHealthService {
  constructor(options = {}) {
    if (
      !options.materializedRulesService ||
      typeof options.materializedRulesService
        .getKnowledgeHealthSnapshot !== 'function'
    ) {
      throw new TypeError(
        'Materialized Rules Service с health snapshot обязателен.'
      );
    }
    this.materializedRulesService = options.materializedRulesService;
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date());
  }

  snapshot(asOf) {
    try {
      return this.materializedRulesService.getKnowledgeHealthSnapshot({
        asOf,
      });
    } catch (error) {
      if (error?.code === ERROR_CODE) throw error;
      if (typeof this.logger?.warn === 'function') {
        try {
          this.logger.warn(
            '[OWNER_KNOWLEDGE_HEALTH_UNAVAILABLE] ' +
            'Read-only knowledge health недоступен.'
          );
        } catch {}
      }
      return null;
    }
  }

  getKnowledgeHealth(input = {}) {
    const normalized = normalizeInput(input, this.now);
    const snapshot = this.snapshot(normalized.options.health.asOf);
    if (!snapshot || snapshot.status === 'UNAVAILABLE') {
      return unavailable(
        snapshot?.warnings || ['OWNER_KNOWLEDGE_HEALTH_UNAVAILABLE']
      );
    }
    const analysis = analyzeKnowledgeHealth({
      rules: snapshot.rules,
      materializations: snapshot.materializations,
      lifecycleStates: snapshot.lifecycleStates,
      effectivenessSummaries: snapshot.effectivenessSummaries,
      statusEvents: snapshot.statusEvents,
      options: normalized.options.health,
    });
    const visibleRules = sortRules(
      analysis.ruleHealth.filter(rule =>
        matchesRule(rule, normalized.filters)
      ),
      normalized.options
    ).slice(0, normalized.options.limit);
    const visibleRuleIds = new Set(
      visibleRules.map(rule => rule.ruleId)
    );
    const findings = analysis.findings.filter(item =>
      matchesFinding(item, normalized.filters, visibleRuleIds)
    ).slice(0, normalized.options.limit);
    return {
      status: snapshot.status === 'PARTIAL' ? 'PARTIAL' : 'AVAILABLE',
      generatedAt: analysis.generatedAt,
      score: analysis.score,
      grade: analysis.grade,
      summary: analysis.summary,
      dimensions: analysis.dimensions,
      findings,
      rules: visibleRules,
      dataQuality: analysis.dataQuality,
      explanationCodes: analysis.explanationCodes,
      warnings: snapshot.warnings || [],
    };
  }

  getRuleHealth({ ruleId, options = {} } = {}) {
    const normalizedRuleId = optionalText(ruleId);
    if (
      !normalizedRuleId ||
      normalizedRuleId.length > 128 ||
      normalizedRuleId.includes('\0') ||
      normalizedRuleId.includes('/') ||
      normalizedRuleId.includes('\\')
    ) {
      invalid('ruleId имеет неверное значение.');
    }
    const result = this.getKnowledgeHealth({
      filters: { search: normalizedRuleId },
      options: { ...options, limit: 100 },
    });
    if (result.status === 'UNAVAILABLE') {
      return { ...result, rule: null };
    }
    const rule = result.rules.find(value =>
      value.ruleId === normalizedRuleId
    );
    if (!rule) {
      throw new OwnerKnowledgeHealthServiceError(
        RULE_NOT_FOUND,
        'Правило health-анализа не найдено.'
      );
    }
    return {
      status: result.status,
      generatedAt: result.generatedAt,
      rule,
      warnings: result.warnings,
    };
  }

  getFindings(input = {}) {
    const result = this.getKnowledgeHealth(input);
    return {
      status: result.status,
      generatedAt: result.generatedAt,
      findings: result.findings,
      warnings: result.warnings,
    };
  }
}

module.exports = {
  FILTER_VALUES,
  RULE_NOT_FOUND,
  SORT_FIELDS,
  OwnerKnowledgeHealthService,
  OwnerKnowledgeHealthServiceError,
  matchesFinding,
  matchesRule,
  normalizeInput,
  sortRules,
};
