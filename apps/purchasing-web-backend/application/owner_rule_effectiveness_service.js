const {
  loadApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_registry'
);
const {
  CLASSIFICATIONS,
  findRuleEffectivenessEvents,
  loadRuleEffectivenessEvents,
  summarizeRuleEffectiveness,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_effectiveness'
);

const UNAVAILABLE_WARNING = 'OWNER_RULE_EFFECTIVENESS_UNAVAILABLE';
const FILTER_VALUES = Object.freeze({
  ruleStatus: Object.freeze(['ACTIVE', 'DISABLED']),
  decision: Object.freeze(['BUY', 'SKIP', 'DEFER']),
  classification: CLASSIFICATIONS,
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
  'lastAppliedAt',
  'effectRate',
  'totalOrderAmountDelta',
  'evaluatedRuns',
  'classification',
  'updatedAt',
]);
const CLASSIFICATION_PRIORITY = Object.freeze({
  REVIEW_RECOMMENDED: 0,
  STALE: 1,
  NO_EFFECT_YET: 2,
  OCCASIONAL: 3,
  EFFECTIVE: 4,
  INSUFFICIENT_DATA: 5,
});

class OwnerRuleEffectivenessServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerRuleEffectivenessServiceError';
    this.code = code;
  }
}

function invalidInput(message) {
  throw new OwnerRuleEffectivenessServiceError(
    'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
    message
  );
}

function optionalText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function safeText(value) {
  const normalized = optionalText(value);
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('file://') ||
    /^[a-zA-Z]:[\\/]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function isoDate(value, name) {
  const normalized = optionalText(value);
  if (
    !normalized ||
    !normalized.endsWith('Z') ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    invalidInput(`${name} должен быть ISO UTC datetime.`);
  }
  return new Date(Date.parse(normalized)).toISOString();
}

function dateBoundary(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = optionalText(value);
  if (!normalized) invalidInput(`${name} имеет неверное значение.`);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  const source = dateOnly
    ? `${normalized}T${
      name === 'dateTo' ? '23:59:59.999' : '00:00:00.000'
    }Z`
    : normalized;
  if (
    !Number.isFinite(Date.parse(source)) ||
    (!dateOnly && !normalized.endsWith('Z'))
  ) {
    invalidInput(`${name} должен быть UTC-датой.`);
  }
  return new Date(Date.parse(source)).toISOString();
}

function enumFilter(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = optionalText(value)?.toUpperCase();
  if (!normalized || !FILTER_VALUES[name].includes(normalized)) {
    invalidInput(`Фильтр ${name} не поддерживается.`);
  }
  return normalized;
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
    invalidInput('Filters и options должны быть объектами.');
  }
  const allowedFilters = new Set([
    ...Object.keys(FILTER_VALUES),
    'dateFrom',
    'dateTo',
    'search',
  ]);
  const allowedOptions = new Set([
    'asOf',
    'staleAfterDays',
    'reviewAfterConsecutiveNoEffect',
    'minEvaluatedRuns',
    'sortBy',
    'sortDirection',
    'limit',
  ]);
  for (const name of Object.keys(filters)) {
    if (!allowedFilters.has(name)) {
      invalidInput(`Фильтр ${name} не поддерживается.`);
    }
  }
  for (const name of Object.keys(options)) {
    if (!allowedOptions.has(name)) {
      invalidInput(`Option ${name} не поддерживается.`);
    }
  }
  const normalizedFilters = Object.fromEntries(
    Object.keys(FILTER_VALUES).map(name => [
      name,
      enumFilter(filters[name], name),
    ])
  );
  normalizedFilters.dateFrom = dateBoundary(filters.dateFrom, 'dateFrom');
  normalizedFilters.dateTo = dateBoundary(filters.dateTo, 'dateTo');
  if (
    normalizedFilters.dateFrom &&
    normalizedFilters.dateTo &&
    Date.parse(normalizedFilters.dateFrom) >
      Date.parse(normalizedFilters.dateTo)
  ) {
    invalidInput('dateFrom не может быть позже dateTo.');
  }
  if (filters.search !== undefined && filters.search !== null) {
    const search = optionalText(filters.search);
    if (!search || search.length > 512 || search.includes('\0')) {
      invalidInput('Фильтр search имеет неверное значение.');
    }
    normalizedFilters.search = search.toLocaleLowerCase('ru');
  } else {
    normalizedFilters.search = null;
  }
  const integer = (name, fallback) => {
    const value = options[name] === undefined
      ? fallback
      : options[name];
    if (!Number.isInteger(value) || value < 1) {
      invalidInput(`Option ${name} должен быть положительным целым.`);
    }
    return value;
  };
  const sortBy = optionalText(options.sortBy);
  if (sortBy && !SORT_FIELDS.includes(sortBy)) {
    invalidInput('Option sortBy не поддерживается.');
  }
  const sortDirection =
    optionalText(options.sortDirection)?.toLowerCase() || 'desc';
  if (!['asc', 'desc'].includes(sortDirection)) {
    invalidInput('Option sortDirection не поддерживается.');
  }
  const limit = integer('limit', 100);
  if (limit > 100) {
    invalidInput('Option limit должен быть от 1 до 100.');
  }
  const nowValue = now();
  const nowDate = nowValue instanceof Date
    ? nowValue
    : new Date(nowValue);
  if (!Number.isFinite(nowDate.getTime())) {
    invalidInput('now должен возвращать допустимую дату.');
  }
  return {
    filters: normalizedFilters,
    options: {
      asOf: options.asOf
        ? isoDate(options.asOf, 'asOf')
        : nowDate.toISOString(),
      staleAfterDays: integer('staleAfterDays', 90),
      reviewAfterConsecutiveNoEffect: integer(
        'reviewAfterConsecutiveNoEffect',
        5
      ),
      minEvaluatedRuns: integer('minEvaluatedRuns', 3),
      sortBy,
      sortDirection,
      limit,
    },
  };
}

function materializedRules(registry) {
  return (registry?.rules || []).filter(rule =>
    rule?.source === 'OWNER_LEARNING_CANDIDATE' &&
    rule?.provenance?.source === 'OWNER_LEARNING_CANDIDATE'
  );
}

function inferredSku(rule) {
  const stableItemKey = optionalText(rule?.stableItemKey);
  return stableItemKey?.startsWith('sku:')
    ? stableItemKey.slice('sku:'.length)
    : null;
}

function ruleContext(rule, effectiveness) {
  const decision = safeText(
    rule.action?.decision ?? rule.approvedDecision
  );
  return {
    ruleId: safeText(rule.ruleId),
    displayScope: {
      primary:
        safeText(rule.name) || inferredSku(rule) || 'Товар без названия',
      secondary: inferredSku(rule) || '—',
    },
    status: safeText(rule.status),
    decision,
    confidence: {
      score: Number.isInteger(rule.provenance?.confidenceScore)
        ? rule.provenance.confidenceScore
        : null,
      level: safeText(rule.provenance?.confidenceLevel),
    },
    priority: {
      score: Number.isInteger(rule.provenance?.priorityScore)
        ? rule.provenance.priorityScore
        : null,
      level: safeText(rule.provenance?.priorityLevel),
    },
    updatedAt: safeText(rule.updatedAt || rule.approvedAt),
    effectiveness,
    safety: {
      observationalOnly: true,
      changesRuleStatus: false,
      message:
        'Эффективность является исторической read-only аналитикой.',
    },
  };
}

function filteredEvents(events, filters) {
  const from = filters.dateFrom
    ? Date.parse(filters.dateFrom)
    : null;
  const to = filters.dateTo ? Date.parse(filters.dateTo) : null;
  return events.filter(event => {
    const timestamp = Date.parse(event?.recordedAt);
    return (
      (!from || timestamp >= from) &&
      (!to || timestamp <= to)
    );
  });
}

function matchesFilters(rule, filters) {
  const values = {
    ruleStatus: rule.status,
    decision: rule.decision,
    classification: rule.effectiveness.classification,
    confidenceLevel: rule.confidence.level,
    priorityLevel: rule.priority.level,
  };
  for (const name of Object.keys(FILTER_VALUES)) {
    if (filters[name] && values[name] !== filters[name]) return false;
  }
  if (filters.search) {
    const haystack = [
      rule.displayScope.primary,
      rule.displayScope.secondary,
      rule.ruleId,
    ].join('\n').toLocaleLowerCase('ru');
    if (!haystack.includes(filters.search)) return false;
  }
  return true;
}

function compareNullable(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left).localeCompare(String(right), 'en');
}

function sortRules(rules, options) {
  if (!options.sortBy) {
    return [...rules].sort((left, right) => {
      const classification =
        CLASSIFICATION_PRIORITY[left.effectiveness.classification] -
        CLASSIFICATION_PRIORITY[right.effectiveness.classification];
      if (classification !== 0) return classification;
      const lastApplied = compareNullable(
        left.effectiveness.activity.lastAppliedAt,
        right.effectiveness.activity.lastAppliedAt
      );
      if (lastApplied !== 0) return lastApplied * -1;
      return left.ruleId.localeCompare(right.ruleId, 'en');
    });
  }
  const value = rule => ({
    lastAppliedAt: rule.effectiveness.activity.lastAppliedAt,
    effectRate: rule.effectiveness.effects.effectRate,
    totalOrderAmountDelta:
      rule.effectiveness.impact.totalOrderAmountDelta,
    evaluatedRuns: rule.effectiveness.population.evaluatedRuns,
    classification:
      CLASSIFICATION_PRIORITY[rule.effectiveness.classification],
    updatedAt: rule.updatedAt,
  })[options.sortBy];
  const direction = options.sortDirection === 'asc' ? 1 : -1;
  return [...rules].sort((left, right) => {
    const primary = compareNullable(value(left), value(right));
    if (primary !== 0) return primary * direction;
    return left.ruleId.localeCompare(right.ruleId, 'en');
  });
}

function aggregateSummary(rules) {
  return {
    totalRules: rules.length,
    appliedRules: rules.filter(
      rule => rule.effectiveness.effects.appliedEffectRuns > 0
    ).length,
    noEffectRules: rules.filter(rule =>
      rule.effectiveness.population.evaluatedRuns > 0 &&
      rule.effectiveness.effects.appliedEffectRuns === 0
    ).length,
    staleRules: rules.filter(
      rule => rule.effectiveness.classification === 'STALE'
    ).length,
    reviewRecommendedRules: rules.filter(
      rule => rule.effectiveness.classification ===
        'REVIEW_RECOMMENDED'
    ).length,
    totalOrderAmountDelta: rules.reduce(
      (total, rule) =>
        total + rule.effectiveness.impact.totalOrderAmountDelta,
      0
    ),
  };
}

class OwnerRuleEffectivenessService {
  constructor(options = {}) {
    if (!options.effectivenessFilePath) {
      throw new TypeError('effectivenessFilePath обязателен.');
    }
    if (!options.approvedRulesFilePath) {
      throw new TypeError('approvedRulesFilePath обязателен.');
    }
    this.effectivenessFilePath = options.effectivenessFilePath;
    this.approvedRulesFilePath = options.approvedRulesFilePath;
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date());
    this.loadEvents = options.loadEvents || loadRuleEffectivenessEvents;
    this.loadRegistry = options.loadRegistry || loadApprovedRules;
  }

  warn() {
    if (typeof this.logger?.warn === 'function') {
      try {
        this.logger.warn(
          `[${UNAVAILABLE_WARNING}] ` +
          'Read-only аналитика эффективности недоступна.'
        );
      } catch {}
    }
  }

  readSources() {
    try {
      return {
        journal: this.loadEvents({
          filePath: this.effectivenessFilePath,
        }),
        registry: this.loadRegistry({
          registryPath: this.approvedRulesFilePath,
          logger: { error() {} },
        }),
      };
    } catch {
      this.warn();
      return null;
    }
  }

  buildRules(sources, normalized) {
    const events = filteredEvents(
      sources.journal.events,
      normalized.filters
    );
    return materializedRules(sources.registry).map(rule =>
      ruleContext(
        rule,
        summarizeRuleEffectiveness({
          events,
          ruleId: rule.ruleId,
          options: normalized.options,
        })
      )
    );
  }

  listRuleEffectiveness(input = {}) {
    const normalized = normalizeInput(input, this.now);
    const sources = this.readSources();
    return this.listFromSources(normalized, sources);
  }

  listFromSources(normalized, sources) {
    if (!sources) {
      return {
        status: 'UNAVAILABLE',
        generatedAt: null,
        summary: null,
        rules: [],
        warning: UNAVAILABLE_WARNING,
      };
    }
    const filtered = this.buildRules(sources, normalized).filter(rule =>
      matchesFilters(rule, normalized.filters)
    );
    return {
      status: 'AVAILABLE',
      generatedAt: normalized.options.asOf,
      summary: aggregateSummary(filtered),
      rules: sortRules(filtered, normalized.options).slice(
        0,
        normalized.options.limit
      ),
      warning: null,
    };
  }

  getCenterSnapshot(input = {}) {
    const normalized = normalizeInput(input, this.now);
    const sources = this.readSources();
    const result = this.listFromSources(normalized, sources);
    if (result.status !== 'AVAILABLE') return result;
    const ruleIds = new Set(result.rules.map(rule => rule.ruleId));
    return {
      ...result,
      centerSnapshot: {
        events: filteredEvents(
          sources.journal.events,
          normalized.filters
        ).filter(event => ruleIds.has(event.ruleId)),
      },
    };
  }

  getRuleEffectiveness({ ruleId, options = {} } = {}) {
    const normalizedRuleId = optionalText(ruleId);
    if (
      !normalizedRuleId ||
      normalizedRuleId.length > 128 ||
      normalizedRuleId.includes('\0') ||
      normalizedRuleId.includes('/') ||
      normalizedRuleId.includes('\\')
    ) {
      invalidInput('ruleId имеет неверное значение.');
    }
    const normalized = normalizeInput({ options }, this.now);
    const sources = this.readSources();
    if (!sources) {
      return {
        status: 'UNAVAILABLE',
        generatedAt: null,
        rule: null,
        warning: UNAVAILABLE_WARNING,
      };
    }
    const rule = this.buildRules(sources, normalized).find(
      value => value.ruleId === normalizedRuleId
    );
    if (!rule) {
      throw new OwnerRuleEffectivenessServiceError(
        'OWNER_RULE_EFFECTIVENESS_RULE_NOT_FOUND',
        'Правило эффективности не найдено.'
      );
    }
    return {
      status: 'AVAILABLE',
      generatedAt: normalized.options.asOf,
      rule,
      effectiveness: rule.effectiveness,
      warning: null,
    };
  }

  getRuleEffectivenessEvents({
    ruleId,
    filters = {},
    options = {},
  } = {}) {
    const detail = this.getRuleEffectiveness({ ruleId, options });
    if (detail.status === 'UNAVAILABLE') {
      return {
        status: 'UNAVAILABLE',
        generatedAt: null,
        ruleId: null,
        events: [],
        warning: UNAVAILABLE_WARNING,
      };
    }
    const normalized = normalizeInput({ filters, options }, this.now);
    const sources = this.readSources();
    if (!sources) {
      return {
        status: 'UNAVAILABLE',
        generatedAt: null,
        ruleId: null,
        events: [],
        warning: UNAVAILABLE_WARNING,
      };
    }
    const events = findRuleEffectivenessEvents({
      events: sources.journal.events,
      ruleId,
      filters: {
        ...(normalized.filters.dateFrom
          ? { dateFrom: normalized.filters.dateFrom }
          : {}),
        ...(normalized.filters.dateTo
          ? { dateTo: normalized.filters.dateTo }
          : {}),
        ...(normalized.filters.decision
          ? { decision: normalized.filters.decision }
          : {}),
        ...(normalized.filters.ruleStatus
          ? { ruleStatus: normalized.filters.ruleStatus }
          : {}),
      },
    }).sort((left, right) =>
      Date.parse(right.recordedAt) - Date.parse(left.recordedAt)
    ).slice(0, normalized.options.limit);
    return {
      status: 'AVAILABLE',
      generatedAt: normalized.options.asOf,
      ruleId,
      events,
      warning: null,
    };
  }
}

module.exports = {
  CLASSIFICATION_PRIORITY,
  FILTER_VALUES,
  SORT_FIELDS,
  UNAVAILABLE_WARNING,
  OwnerRuleEffectivenessService,
  OwnerRuleEffectivenessServiceError,
  aggregateSummary,
  matchesFilters,
  normalizeInput,
  ruleContext,
  sortRules,
};
