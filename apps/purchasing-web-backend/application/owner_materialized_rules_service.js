const {
  loadApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_registry'
);
const {
  findMaterializationByRule,
  loadMaterializationJournal,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_materialization_journal'
);
const {
  getCandidateLifecycleState,
  loadCandidateLifecycle,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_candidate_lifecycle'
);
const {
  getCurrentRuleStatusHistory,
  loadRuleStatusEvents,
  validateRuleStatusTransition,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_status_manager'
);
const {
  loadRuleEffectivenessEvents,
  summarizeRuleEffectiveness,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_effectiveness'
);

const UNAVAILABLE_WARNING = 'OWNER_MATERIALIZED_RULES_UNAVAILABLE';
const MATERIALIZATION_HISTORY_WARNING =
  'OWNER_RULE_MATERIALIZATION_HISTORY_UNAVAILABLE';
const CANDIDATE_CONTEXT_WARNING =
  'OWNER_MATERIALIZED_RULES_CANDIDATE_CONTEXT_UNAVAILABLE';
const LIFECYCLE_CONTEXT_WARNING =
  'OWNER_MATERIALIZED_RULES_LIFECYCLE_CONTEXT_UNAVAILABLE';
const STATUS_HISTORY_WARNING =
  'OWNER_RULE_STATUS_HISTORY_UNAVAILABLE';
const EFFECTIVENESS_WARNING =
  'OWNER_RULE_EFFECTIVENESS_UNAVAILABLE';
const FILTER_VALUES = Object.freeze({
  status: Object.freeze(['ACTIVE', 'DISABLED']),
  decision: Object.freeze(['BUY', 'SKIP', 'DEFER']),
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
  lifecycleStatus: Object.freeze([
    'NEW',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'POSTPONED',
  ]),
  candidateAvailability: Object.freeze([
    'AVAILABLE',
    'UNAVAILABLE',
  ]),
});
const SORT_FIELDS = Object.freeze([
  'materializedAt',
  'updatedAt',
  'confidenceScore',
  'priorityScore',
  'decision',
  'status',
]);

class OwnerMaterializedRulesServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerMaterializedRulesServiceError';
    this.code = code;
  }
}

function invalidInput(message) {
  throw new OwnerMaterializedRulesServiceError(
    'OWNER_MATERIALIZED_RULES_INVALID_INPUT',
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

function nowIso(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    invalidInput('now должен возвращать допустимую дату.');
  }
  return date.toISOString();
}

function enumFilter(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = optionalText(value)?.toUpperCase();
  if (!normalized || !FILTER_VALUES[name].includes(normalized)) {
    invalidInput(`Фильтр ${name} не поддерживается.`);
  }
  return normalized;
}

function dateBoundary(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = optionalText(value);
  if (!normalized) invalidInput(`Фильтр ${name} имеет неверное значение.`);
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
    invalidInput(`Фильтр ${name} должен быть UTC-датой.`);
  }
  return new Date(Date.parse(source)).toISOString();
}

function normalizeInput({ filters = {}, options = {} } = {}) {
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
  for (const name of Object.keys(filters)) {
    if (
      !Object.hasOwn(FILTER_VALUES, name) &&
      !['dateFrom', 'dateTo', 'search'].includes(name)
    ) {
      invalidInput(`Фильтр ${name} не поддерживается.`);
    }
  }
  for (const name of Object.keys(options)) {
    if (!['sortBy', 'sortDirection', 'limit'].includes(name)) {
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
    if (
      !search ||
      search.length > 512 ||
      search.includes('\0')
    ) {
      invalidInput('Фильтр search имеет неверное значение.');
    }
    normalizedFilters.search = search.toLocaleLowerCase('ru');
  } else {
    normalizedFilters.search = null;
  }
  const sortBy = optionalText(options.sortBy) || 'materializedAt';
  if (!SORT_FIELDS.includes(sortBy)) {
    invalidInput('Option sortBy не поддерживается.');
  }
  const sortDirection =
    optionalText(options.sortDirection)?.toLowerCase() || 'desc';
  if (!['asc', 'desc'].includes(sortDirection)) {
    invalidInput('Option sortDirection не поддерживается.');
  }
  const limit = options.limit === undefined ? 100 : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    invalidInput('Option limit должен быть целым числом от 1 до 100.');
  }
  return {
    filters: normalizedFilters,
    options: { sortBy, sortDirection, limit },
  };
}

function lifecycleView(state) {
  if (!state?.lastEvent) {
    return {
      status: state?.status === 'NEW' ? 'NEW' : null,
      lastAction: null,
      lastRecordedAt: null,
      reasonCode: null,
    };
  }
  return {
    status: safeText(state.status),
    lastAction: safeText(state.lastAction),
    lastRecordedAt: safeText(state.lastRecordedAt),
    reasonCode: safeText(state.reasonCode),
  };
}

function skuFromSecondary(value) {
  const normalized = safeText(value);
  if (!normalized) return null;
  return normalized.replace(/^SKU\s+/i, '').trim() || null;
}

function inferredSku(rule) {
  const stableItemKey = optionalText(rule?.stableItemKey);
  return stableItemKey?.startsWith('sku:')
    ? stableItemKey.slice('sku:'.length)
    : null;
}

function displayScope(rule, candidate, lifecycleState) {
  const currentPrimary = safeText(candidate?.displayScope?.primary);
  const currentSku = skuFromSecondary(
    candidate?.displayScope?.secondary
  );
  const snapshot =
    lifecycleState?.lastEvent?.candidateSnapshot || null;
  const snapshotPrimary = safeText(snapshot?.displayScope?.primary);
  const snapshotSku = skuFromSecondary(
    snapshot?.displayScope?.secondary
  );
  const registryName = safeText(rule.name);
  const sku = currentSku || snapshotSku || inferredSku(rule);
  return {
    primary:
      currentPrimary ||
      snapshotPrimary ||
      registryName ||
      sku ||
      'Товар без названия',
    secondary: sku || '—',
  };
}

function buildRuleView({
  rule,
  event,
  candidate,
  lifecycleState,
  lifecycleAvailable,
  statusEvent,
  statusHistoryAvailable = false,
  effectiveness,
}) {
  const provenance = rule.provenance || {};
  const snapshot = event?.snapshot || {};
  const status = rule.status;
  return {
    ruleId: rule.ruleId,
    status,
    ruleType: rule.ruleType,
    displayScope: displayScope(rule, candidate, lifecycleState),
    action: {
      decision:
        safeText(rule.action?.decision) ||
        safeText(rule.approvedDecision),
      quantityStrategy:
        safeText(rule.action?.quantityStrategy),
      quantityValue:
        typeof rule.action?.quantityValue === 'number' &&
        Number.isFinite(rule.action.quantityValue)
          ? rule.action.quantityValue
          : null,
    },
    source: {
      type: 'OWNER_LEARNING_CANDIDATE',
      label: 'Кандидат Owner Learning',
    },
    provenance: {
      candidateId: safeText(provenance.candidateId),
      patternType:
        safeText(provenance.patternType) ||
        safeText(snapshot.patternType),
      confidenceScore:
        Number.isInteger(provenance.confidenceScore)
          ? provenance.confidenceScore
          : (
            Number.isInteger(snapshot.confidenceScore)
              ? snapshot.confidenceScore
              : null
          ),
      confidenceLevel:
        safeText(provenance.confidenceLevel) ||
        safeText(snapshot.confidenceLevel),
      priorityScore:
        Number.isInteger(provenance.priorityScore)
          ? provenance.priorityScore
          : (
            Number.isInteger(snapshot.priorityScore)
              ? snapshot.priorityScore
              : null
          ),
      priorityLevel:
        safeText(provenance.priorityLevel) ||
        safeText(snapshot.priorityLevel),
      eligibilityStatus:
        safeText(provenance.eligibilityStatus),
      materializedAt:
        safeText(event?.recordedAt) ||
        safeText(provenance.materializedAt),
      materializationVersion:
        safeText(provenance.materializationVersion),
    },
    lifecycle: lifecycleAvailable
      ? lifecycleView(lifecycleState)
      : {
        status: null,
        lastAction: null,
        lastRecordedAt: null,
        reasonCode: null,
      },
    candidateAvailability: {
      status: candidate ? 'AVAILABLE' : 'UNAVAILABLE',
    },
    timestamps: {
      createdAt:
        safeText(rule.createdAt) || safeText(rule.approvedAt),
      updatedAt:
        safeText(rule.updatedAt) || safeText(rule.approvedAt),
    },
    safety: {
      affectsPurchasing: status === 'ACTIVE',
      message: status === 'ACTIVE'
        ? 'Правило активно и может влиять на закупку.'
        : 'Правило неактивно и не влияет на закупку.',
    },
    management: managementView({
      rule,
      statusEvent,
      statusHistoryAvailable,
    }),
    effectiveness,
  };
}

function managementView({
  rule,
  statusEvent,
  statusHistoryAvailable,
}) {
  let manageable = false;
  try {
    validateRuleStatusTransition({
      rule,
      targetStatus: rule.status === 'ACTIVE'
        ? 'DISABLED'
        : 'ACTIVE',
    });
    manageable = true;
  } catch {}
  return {
    manageable,
    availableActions: manageable
      ? [rule.status === 'ACTIVE' ? 'DEACTIVATE' : 'ACTIVATE']
      : [],
    lastStatusChangeAt: statusHistoryAvailable
      ? safeText(statusEvent?.recordedAt)
      : null,
    lastStatusAction: statusHistoryAvailable
      ? safeText(statusEvent?.action)
      : null,
    previewRequired: true,
  };
}

function matchesFilters(rule, filters) {
  const valueByFilter = {
    status: rule.status,
    decision: rule.action.decision,
    confidenceLevel: rule.provenance.confidenceLevel,
    priorityLevel: rule.provenance.priorityLevel,
    lifecycleStatus: rule.lifecycle.status,
    candidateAvailability: rule.candidateAvailability.status,
  };
  for (const name of Object.keys(FILTER_VALUES)) {
    if (filters[name] && valueByFilter[name] !== filters[name]) {
      return false;
    }
  }
  const timestamp = Date.parse(rule.provenance.materializedAt);
  if (
    filters.dateFrom &&
    (
      !Number.isFinite(timestamp) ||
      timestamp < Date.parse(filters.dateFrom)
    )
  ) {
    return false;
  }
  if (
    filters.dateTo &&
    (
      !Number.isFinite(timestamp) ||
      timestamp > Date.parse(filters.dateTo)
    )
  ) {
    return false;
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
  const fieldValue = (rule, sortBy) => ({
    materializedAt: rule.provenance.materializedAt,
    updatedAt: rule.timestamps.updatedAt,
    confidenceScore: rule.provenance.confidenceScore,
    priorityScore: rule.provenance.priorityScore,
    decision: rule.action.decision,
    status: rule.status,
  })[sortBy];
  const direction = options.sortDirection === 'asc' ? 1 : -1;
  return [...rules].sort((left, right) => {
    const primary = compareNullable(
      fieldValue(left, options.sortBy),
      fieldValue(right, options.sortBy)
    );
    if (primary !== 0) return primary * direction;
    return left.ruleId.localeCompare(right.ruleId, 'en');
  });
}

function summarize(rules) {
  const summary = {
    totalRules: rules.length,
    activeRules: 0,
    disabledRules: 0,
    buyRules: 0,
    skipRules: 0,
    deferRules: 0,
    currentCandidateAvailable: 0,
    currentCandidateUnavailable: 0,
  };
  for (const rule of rules) {
    if (rule.status === 'ACTIVE') summary.activeRules += 1;
    if (rule.status === 'DISABLED') summary.disabledRules += 1;
    if (rule.action.decision === 'BUY') summary.buyRules += 1;
    if (rule.action.decision === 'SKIP') summary.skipRules += 1;
    if (rule.action.decision === 'DEFER') summary.deferRules += 1;
    if (rule.candidateAvailability.status === 'AVAILABLE') {
      summary.currentCandidateAvailable += 1;
    } else {
      summary.currentCandidateUnavailable += 1;
    }
  }
  return summary;
}

class OwnerMaterializedRulesService {
  constructor(options = {}) {
    for (const name of [
      'approvedRulesFilePath',
      'materializationsFilePath',
      'candidateLifecycleFilePath',
      'candidatesService',
    ]) {
      if (!options[name]) {
        throw new TypeError(`${name} обязателен.`);
      }
    }
    this.approvedRulesFilePath = options.approvedRulesFilePath;
    this.materializationsFilePath = options.materializationsFilePath;
    this.candidateLifecycleFilePath =
      options.candidateLifecycleFilePath;
    this.statusEventsFilePath =
      options.statusEventsFilePath || null;
    this.effectivenessFilePath =
      options.effectivenessFilePath || null;
    this.candidatesService = options.candidatesService;
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date());
    this.loadRegistry = options.loadRegistry || loadApprovedRules;
    this.loadMaterializations =
      options.loadMaterializations || loadMaterializationJournal;
    this.loadLifecycle =
      options.loadLifecycle || loadCandidateLifecycle;
    this.loadStatusEvents =
      options.loadStatusEvents || loadRuleStatusEvents;
    this.loadEffectiveness =
      options.loadEffectiveness || loadRuleEffectivenessEvents;
  }

  warn(code, message) {
    if (typeof this.logger?.warn === 'function') {
      this.logger.warn(`[${code}] ${message}`);
    }
  }

  readSources() {
    let registry;
    try {
      registry = this.loadRegistry({
        registryPath: this.approvedRulesFilePath,
        logger: { error() {} },
      });
    } catch {
      this.warn(
        UNAVAILABLE_WARNING,
        'Реестр materialized rules недоступен.'
      );
      return { unavailable: true };
    }

    let journal = null;
    let journalWarning = null;
    try {
      journal = this.loadMaterializations({
        filePath: this.materializationsFilePath,
      });
    } catch {
      journalWarning = MATERIALIZATION_HISTORY_WARNING;
      this.warn(
        journalWarning,
        'История materialization недоступна.'
      );
    }

    let candidates = [];
    let candidateWarning = null;
    try {
      const result = this.candidatesService.getCandidates();
      if (result?.status !== 'AVAILABLE' ||
          !Array.isArray(result.candidates)) {
        throw new Error('Candidates unavailable');
      }
      candidates = result.candidates;
    } catch {
      candidateWarning = CANDIDATE_CONTEXT_WARNING;
      this.warn(
        candidateWarning,
        'Текущий candidate context недоступен.'
      );
    }

    let lifecycle = null;
    let lifecycleWarning = null;
    try {
      lifecycle = this.loadLifecycle({
        filePath: this.candidateLifecycleFilePath,
      });
    } catch {
      lifecycleWarning = LIFECYCLE_CONTEXT_WARNING;
      this.warn(
        lifecycleWarning,
        'Lifecycle context materialized rules недоступен.'
      );
    }

    let statusEvents = null;
    let statusHistoryWarning = null;
    if (this.statusEventsFilePath) {
      try {
        statusEvents = this.loadStatusEvents({
          filePath: this.statusEventsFilePath,
        });
      } catch {
        statusHistoryWarning = STATUS_HISTORY_WARNING;
        this.warn(
          statusHistoryWarning,
          'История изменения статусов правил недоступна.'
        );
      }
    }

    let effectiveness = null;
    let effectivenessWarning = null;
    if (this.effectivenessFilePath) {
      try {
        effectiveness = this.loadEffectiveness({
          filePath: this.effectivenessFilePath,
        });
      } catch {
        effectivenessWarning = EFFECTIVENESS_WARNING;
        this.warn(
          effectivenessWarning,
          'Effectiveness journal materialized rules недоступен.'
        );
      }
    }

    return {
      registry,
      journal,
      candidates,
      lifecycle,
      statusEvents,
      effectiveness,
      warning:
        effectivenessWarning ||
        statusHistoryWarning ||
        journalWarning ||
        candidateWarning ||
        lifecycleWarning ||
        null,
    };
  }

  buildRules(sources) {
    const candidatesById = new Map(
      sources.candidates.map(candidate => [
        candidate.candidateId,
        candidate,
      ])
    );
    return sources.registry.rules
      .filter(rule =>
        rule.provenance?.source === 'OWNER_LEARNING_CANDIDATE'
      )
      .map(rule => {
        const candidateId = rule.provenance.candidateId;
        const candidate = candidatesById.get(candidateId) || null;
        const event = sources.journal
          ? findMaterializationByRule(sources.journal, rule.ruleId)
          : null;
        const lifecycleState = sources.lifecycle
          ? getCandidateLifecycleState({
            lifecycle: sources.lifecycle,
            candidateId,
          })
          : null;
        const statusHistory = sources.statusEvents
          ? getCurrentRuleStatusHistory({
            events: sources.statusEvents.events,
            ruleId: rule.ruleId,
          })
          : [];
        const statusEvent = statusHistory.at(-1) || null;
        const effectivenessSummary = sources.effectiveness
          ? summarizeRuleEffectiveness({
            events: sources.effectiveness.events,
            ruleId: rule.ruleId,
            options: {
              asOf: nowIso(this.now),
            },
          })
          : null;
        const effectiveness = sources.effectiveness
          ? {
            status:
              effectivenessSummary.population.totalEvents > 0
                ? 'AVAILABLE'
                : 'NO_DATA',
            classification:
              effectivenessSummary.classification,
            evaluatedRuns:
              effectivenessSummary.population.evaluatedRuns,
            appliedEffectRuns:
              effectivenessSummary.effects.appliedEffectRuns,
            effectRate: effectivenessSummary.effects.effectRate,
            totalOrderAmountDelta:
              effectivenessSummary.impact.totalOrderAmountDelta,
            lastAppliedAt:
              effectivenessSummary.activity.lastAppliedAt,
            daysSinceLastApplied:
              effectivenessSummary.activity.daysSinceLastApplied,
          }
          : {
            status: 'UNAVAILABLE',
            classification: null,
            evaluatedRuns: 0,
            appliedEffectRuns: 0,
            effectRate: null,
            totalOrderAmountDelta: null,
            lastAppliedAt: null,
            daysSinceLastApplied: null,
          };
        return buildRuleView({
          rule,
          event,
          candidate,
          lifecycleState,
          lifecycleAvailable: Boolean(sources.lifecycle),
          statusEvent,
          statusHistoryAvailable: Boolean(sources.statusEvents),
          effectiveness,
        });
      });
  }

  listRules(input = {}) {
    const normalized = normalizeInput(input);
    const sources = this.readSources();
    if (sources.unavailable) {
      return {
        status: 'UNAVAILABLE',
        generatedAt: null,
        summary: null,
        rules: [],
        warning: UNAVAILABLE_WARNING,
      };
    }
    const filtered = this.buildRules(sources).filter(rule =>
      matchesFilters(rule, normalized.filters)
    );
    return {
      status: 'AVAILABLE',
      generatedAt: nowIso(this.now),
      summary: summarize(filtered),
      rules: sortRules(filtered, normalized.options).slice(
        0,
        normalized.options.limit
      ),
      warning: sources.warning,
    };
  }

  getRule({ ruleId } = {}) {
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
    const sources = this.readSources();
    if (sources.unavailable) {
      return {
        status: 'UNAVAILABLE',
        generatedAt: null,
        rule: null,
        warning: UNAVAILABLE_WARNING,
      };
    }
    const rule = this.buildRules(sources).find(
      value => value.ruleId === normalizedRuleId
    );
    if (!rule) {
      throw new OwnerMaterializedRulesServiceError(
        'OWNER_MATERIALIZED_RULE_NOT_FOUND',
        'Материализованное правило не найдено.'
      );
    }
    return {
      status: 'AVAILABLE',
      generatedAt: nowIso(this.now),
      rule,
      warning: sources.warning,
    };
  }
}

module.exports = {
  CANDIDATE_CONTEXT_WARNING,
  FILTER_VALUES,
  LIFECYCLE_CONTEXT_WARNING,
  MATERIALIZATION_HISTORY_WARNING,
  STATUS_HISTORY_WARNING,
  EFFECTIVENESS_WARNING,
  SORT_FIELDS,
  UNAVAILABLE_WARNING,
  OwnerMaterializedRulesService,
  OwnerMaterializedRulesServiceError,
  buildRuleView,
  displayScope,
  matchesFilters,
  managementView,
  normalizeInput,
  sortRules,
  summarize,
};
