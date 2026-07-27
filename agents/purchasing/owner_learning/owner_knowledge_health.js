const crypto = require('node:crypto');

const SCHEMA_VERSION = 'owner-knowledge-health-v1.1';
const ERROR_CODE = 'OWNER_KNOWLEDGE_HEALTH_INVALID_INPUT';
const DAY_MS = 24 * 60 * 60 * 1000;
const SUPPORTED_STATUSES = Object.freeze(['ACTIVE', 'DISABLED']);
const SUPPORTED_DECISIONS = Object.freeze(['BUY', 'SKIP', 'DEFER']);
const SUPPORTED_RULE_TYPES = Object.freeze([
  'ITEM_DECISION',
  'ITEM_DECISION_OVERRIDE',
]);
const DIMENSION_WEIGHTS = Object.freeze({
  consistency: 25,
  effectiveness: 20,
  freshness: 15,
  dataQuality: 15,
  safety: 15,
  maintainability: 10,
});
const DEFAULT_OPTIONS = Object.freeze({
  staleRuleAfterDays: 90,
  oldRuleAfterDays: 365,
  noEffectRunThreshold: 5,
  minEffectivenessRuns: 3,
});
const SEVERITY_ORDER = Object.freeze({
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
});
const SEVERITY_PENALTY = Object.freeze({
  CRITICAL: 30,
  HIGH: 18,
  MEDIUM: 10,
  LOW: 5,
  INFO: 0,
});
const FINDING_DIMENSION = Object.freeze({
  RULE_CONFLICT: 'consistency',
  RULE_DUPLICATE: 'maintainability',
  RULE_STALE: 'freshness',
  RULE_NO_EFFECT: 'effectiveness',
  RULE_REVIEW_RECOMMENDED: 'effectiveness',
  RULE_LOW_CONFIDENCE: 'dataQuality',
  RULE_LOW_PRIORITY: 'maintainability',
  RULE_MISSING_PROVENANCE: 'dataQuality',
  RULE_MATERIALIZATION_MISSING: 'consistency',
  RULE_LIFECYCLE_INCONSISTENT: 'consistency',
  RULE_STATUS_HISTORY_INCONSISTENT: 'consistency',
  RULE_EFFECTIVENESS_UNAVAILABLE: 'effectiveness',
  RULE_SCOPE_TOO_BROAD: 'safety',
  RULE_UNSUPPORTED_TYPE: 'safety',
  RULE_DATA_QUALITY_ISSUE: 'dataQuality',
  ACTIVE_RULE_WITHOUT_EFFECT_DATA: 'effectiveness',
  DISABLED_RULE_WITH_EFFECT_EVENTS: 'consistency',
  ACTIVE_RULE_NEVER_APPLIED: 'effectiveness',
  RULE_LAST_UPDATED_TOO_OLD: 'freshness',
});
const EXPLANATION_CODES = Object.freeze([
  'KNOWLEDGE_HEALTH_SCORE_IS_OBSERVATIONAL',
  'CONFLICTING_ACTIVE_RULES',
  'DUPLICATE_ACTIVE_RULES',
  'DUPLICATE_DISABLED_RULES',
  'MIXED_STATUS_DUPLICATES',
  'RULE_EFFECTIVENESS_HEALTHY',
  'RULE_EFFECTIVENESS_WEAK',
  'RULE_EFFECTIVENESS_MISSING',
  'RULE_IS_STALE',
  'RULE_IS_OLD',
  'RULE_HAS_LOW_CONFIDENCE',
  'RULE_HAS_LOW_PRIORITY',
  'RULE_PROVENANCE_MISSING',
  'RULE_MATERIALIZATION_MISSING',
  'RULE_LIFECYCLE_INCONSISTENT',
  'RULE_STATUS_HISTORY_INCONSISTENT',
  'RULE_REQUIRES_MANUAL_REVIEW',
  'DATA_QUALITY_INVALID_RULES',
  'KNOWLEDGE_BASE_HEALTHY',
  'KNOWLEDGE_BASE_DEGRADED',
  'KNOWLEDGE_BASE_CRITICAL',
]);

class OwnerKnowledgeHealthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OwnerKnowledgeHealthError';
    this.code = ERROR_CODE;
  }
}

function invalid(message) {
  throw new OwnerKnowledgeHealthError(message);
}

function optionalText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function upper(value) {
  return optionalText(value)?.toUpperCase() || null;
}

function strictIsoUtc(value, name) {
  const normalized = optionalText(value);
  if (
    !normalized ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
      normalized
    ) ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    invalid(`${name} должен быть ISO UTC datetime.`);
  }
  return new Date(Date.parse(normalized)).toISOString();
}

function validTimestamp(value) {
  return Boolean(
    optionalText(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function normalizeOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    invalid('options должен быть объектом.');
  }
  const allowed = new Set([
    'asOf',
    'staleRuleAfterDays',
    'oldRuleAfterDays',
    'noEffectRunThreshold',
    'minEffectivenessRuns',
  ]);
  for (const name of Object.keys(options)) {
    if (!allowed.has(name)) invalid(`Option ${name} не поддерживается.`);
  }
  const asOf = options.asOf === undefined
    ? new Date().toISOString()
    : strictIsoUtc(options.asOf, 'asOf');
  const integer = name => {
    const value = options[name] ?? DEFAULT_OPTIONS[name];
    if (!Number.isInteger(value) || value < 1) {
      invalid(`${name} должен быть положительным целым числом.`);
    }
    return value;
  };
  return {
    asOf,
    staleRuleAfterDays: integer('staleRuleAfterDays'),
    oldRuleAfterDays: integer('oldRuleAfterDays'),
    noEffectRunThreshold: integer('noEffectRunThreshold'),
    minEffectivenessRuns: integer('minEffectivenessRuns'),
  };
}

function validateArrays(input) {
  for (const name of [
    'rules',
    'materializations',
    'lifecycleStates',
    'effectivenessSummaries',
    'statusEvents',
  ]) {
    if (!Array.isArray(input[name])) {
      invalid(`${name} должен быть массивом.`);
    }
  }
}

function digest(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function unique(values) {
  return values.filter((value, index) =>
    value && values.indexOf(value) === index
  );
}

function ruleId(rule, index = 0) {
  return optionalText(rule?.ruleId) || `INVALID_RULE_${index + 1}`;
}

function statusOf(rule) {
  return upper(rule?.status);
}

function actionOf(rule) {
  const decision = upper(
    rule?.action?.decision ??
    rule?.approvedDecision ??
    rule?.decision
  );
  const quantityStrategy = upper(rule?.action?.quantityStrategy);
  const quantityValue =
    typeof rule?.action?.quantityValue === 'number' &&
    Number.isFinite(rule.action.quantityValue)
      ? rule.action.quantityValue
      : null;
  return { decision, quantityStrategy, quantityValue };
}

function scopeOf(rule) {
  const scopeType = upper(rule?.scopeType) || (
    optionalText(rule?.stableItemKey) ? 'ITEM' : null
  );
  const scopeKey =
    optionalText(rule?.scopeKey) ||
    optionalText(rule?.stableItemKey);
  return { scopeType, scopeKey };
}

function displayScopeOf(rule) {
  const primary =
    optionalText(rule?.displayScope?.primary) ||
    optionalText(rule?.name) ||
    null;
  const secondary =
    optionalText(rule?.displayScope?.secondary) ||
    optionalText(rule?.brand) ||
    null;
  return { primary, secondary };
}

function timestampsOf(rule) {
  return {
    createdAt:
      optionalText(rule?.timestamps?.createdAt) ||
      optionalText(rule?.createdAt) ||
      optionalText(rule?.approvedAt),
    updatedAt:
      optionalText(rule?.timestamps?.updatedAt) ||
      optionalText(rule?.updatedAt) ||
      optionalText(rule?.approvedAt),
  };
}

function provenanceOf(rule) {
  const source = rule?.provenance;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    return source;
  }
  const serviceView = rule?.source;
  return (
    serviceView &&
    typeof serviceView === 'object' &&
    upper(serviceView.type) === 'OWNER_LEARNING_CANDIDATE'
  )
    ? rule.provenance || null
    : null;
}

function confidenceOf(rule) {
  return upper(
    rule?.provenance?.confidenceLevel ??
    rule?.confidence?.level
  );
}

function priorityOf(rule) {
  return upper(
    rule?.provenance?.priorityLevel ??
    rule?.priority?.level
  );
}

function effectivenessOf(summary) {
  const value = summary?.effectiveness || summary || {};
  const population = value.population || {};
  const effects = value.effects || {};
  const activity = value.activity || {};
  const totalEvents =
    integerOrNull(population.totalEvents) ??
    integerOrNull(value.totalEvents) ??
    0;
  const evaluatedRuns =
    integerOrNull(population.evaluatedRuns) ??
    integerOrNull(value.evaluatedRuns) ??
    0;
  const appliedEffectRuns =
    integerOrNull(effects.appliedEffectRuns) ??
    integerOrNull(value.appliedEffectRuns) ??
    0;
  return {
    classification: upper(value.classification),
    totalEvents,
    evaluatedRuns,
    appliedEffectRuns,
    consecutiveNoEffectRuns:
      integerOrNull(activity.consecutiveNoEffectRuns) ?? 0,
    lastAppliedAt:
      optionalText(activity.lastAppliedAt) ||
      optionalText(value.lastAppliedAt),
    daysSinceLastApplied:
      integerOrNull(activity.daysSinceLastApplied) ??
      integerOrNull(value.daysSinceLastApplied),
  };
}

function integerOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function safeScopeHash(rule) {
  const scope = scopeOf(rule);
  return scope.scopeKey
    ? digest([scope.scopeType, scope.scopeKey])
    : null;
}

function duplicateSignature(rule) {
  const scope = scopeOf(rule);
  const action = actionOf(rule);
  return JSON.stringify([
    scope.scopeType,
    scope.scopeKey,
    upper(rule?.ruleType),
    action.decision,
    action.quantityStrategy,
    action.quantityValue,
  ]);
}

function conflictSignature(rule) {
  const scope = scopeOf(rule);
  return JSON.stringify([scope.scopeType, scope.scopeKey]);
}

function detectRuleDuplicates({ rules, options = {} } = {}) {
  if (!Array.isArray(rules)) invalid('rules должен быть массивом.');
  normalizeOptions(options);
  const groups = new Map();
  rules.forEach((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return;
    const scope = scopeOf(rule);
    const action = actionOf(rule);
    if (!scope.scopeKey || !action.decision) return;
    const key = duplicateSignature(rule);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ rule, index });
  });
  return Array.from(groups.values())
    .filter(group => group.length > 1)
    .map(group => {
      const ordered = group
        .map(({ rule, index }) => ({
          id: ruleId(rule, index),
          status: statusOf(rule),
          action: actionOf(rule),
        }))
        .sort((left, right) => left.id.localeCompare(right.id, 'en'));
      const statuses = unique(ordered.map(value => value.status)).sort();
      const allActive = statuses.length === 1 && statuses[0] === 'ACTIVE';
      const allDisabled =
        statuses.length === 1 && statuses[0] === 'DISABLED';
      const duplicateType = allActive
        ? 'ACTIVE_DUPLICATE'
        : (allDisabled ? 'DISABLED_DUPLICATE' : 'MIXED_STATUS_DUPLICATE');
      const explanationCode = allActive
        ? 'DUPLICATE_ACTIVE_RULES'
        : (
          allDisabled
            ? 'DUPLICATE_DISABLED_RULES'
            : 'MIXED_STATUS_DUPLICATES'
        );
      const ids = ordered.map(value => value.id);
      return {
        duplicateId: digest(['DUPLICATE', duplicateType, ids]),
        duplicateType,
        ruleIds: ids,
        count: ids.length,
        statuses,
        action: ordered[0].action,
        explanationCodes: [explanationCode],
      };
    })
    .sort((left, right) =>
      left.duplicateId.localeCompare(right.duplicateId, 'en')
    );
}

function incompatibleQuantity(left, right) {
  if (left.decision !== right.decision) return false;
  return (
    left.quantityStrategy !== right.quantityStrategy ||
    left.quantityValue !== right.quantityValue
  );
}

function detectRuleConflicts({ rules, options = {} } = {}) {
  if (!Array.isArray(rules)) invalid('rules должен быть массивом.');
  normalizeOptions(options);
  const groups = new Map();
  rules.forEach((rule, index) => {
    if (
      !rule ||
      typeof rule !== 'object' ||
      Array.isArray(rule) ||
      statusOf(rule) !== 'ACTIVE'
    ) {
      return;
    }
    const scope = scopeOf(rule);
    if (scope.scopeType !== 'ITEM' || !scope.scopeKey) return;
    const key = conflictSignature(rule);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ rule, index });
  });
  return Array.from(groups.values()).flatMap(group => {
    if (group.length < 2) return [];
    const decisions = unique(
      group.map(({ rule }) => actionOf(rule).decision)
    ).filter(Boolean).sort();
    const quantityConflict = group.some((left, leftIndex) =>
      group.slice(leftIndex + 1).some(right =>
        incompatibleQuantity(actionOf(left.rule), actionOf(right.rule))
      )
    );
    if (decisions.length < 2 && !quantityConflict) return [];
    const ordered = group.slice().sort((left, right) =>
      ruleId(left.rule, left.index).localeCompare(
        ruleId(right.rule, right.index),
        'en'
      )
    );
    const ids = ordered.map(({ rule, index }) => ruleId(rule, index));
    const first = ordered[0].rule;
    return [{
      conflictId: digest(['CONFLICT', safeScopeHash(first), ids, decisions]),
      scopeType: 'ITEM',
      safeScopeHash: safeScopeHash(first),
      ruleIds: ids,
      decisions,
      severity: 'CRITICAL',
      activeRuleCount: ids.length,
      explanationCodes: ['CONFLICTING_ACTIVE_RULES'],
    }];
  }).sort((left, right) =>
    left.conflictId.localeCompare(right.conflictId, 'en')
  );
}

function finding({
  type,
  severity,
  rules,
  evidence = {},
  recommendedReviewAction,
  navigationTarget,
  explanationCodes = [],
}) {
  const normalizedRules = rules
    .map((rule, index) => ({
      id: typeof rule === 'string' ? rule : ruleId(rule, index),
      scope: typeof rule === 'string'
        ? { primary: null, secondary: null }
        : displayScopeOf(rule),
    }))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const ids = normalizedRules.map(value => value.id);
  return {
    findingId: digest([type, severity, ids, evidence]),
    type,
    severity,
    ruleIds: ids,
    displayScopes: normalizedRules.map(value => value.scope),
    titleCode: type,
    descriptionCode: type,
    evidence,
    recommendedReviewAction,
    navigationTarget,
    explanationCodes: unique(explanationCodes),
  };
}

function groupFinding(type, group, rulesById) {
  const rules = group.ruleIds.map(id => rulesById.get(id) || id);
  if (type === 'RULE_CONFLICT') {
    return finding({
      type,
      severity: group.severity,
      rules,
      evidence: {
        conflictId: group.conflictId,
        decisions: group.decisions,
        activeRuleCount: group.activeRuleCount,
      },
      recommendedReviewAction: 'REVIEW_CONFLICT',
      navigationTarget: 'MATERIALIZED_RULES',
      explanationCodes: group.explanationCodes,
    });
  }
  const severity = {
    ACTIVE_DUPLICATE: 'HIGH',
    MIXED_STATUS_DUPLICATE: 'MEDIUM',
    DISABLED_DUPLICATE: 'LOW',
  }[group.duplicateType];
  return finding({
    type,
    severity,
    rules,
    evidence: {
      duplicateId: group.duplicateId,
      duplicateType: group.duplicateType,
      count: group.count,
      statuses: group.statuses,
    },
    recommendedReviewAction: 'REVIEW_DUPLICATE',
    navigationTarget: 'MATERIALIZED_RULES',
    explanationCodes: group.explanationCodes,
  });
}

function componentIndex(values, key) {
  const result = new Map();
  values.forEach(value => {
    const id = optionalText(value?.[key]);
    if (!id) return;
    if (!result.has(id)) result.set(id, []);
    result.get(id).push(value);
  });
  return result;
}

function contextForAnalysis(input, normalizedOptions) {
  const validRules = input.rules.filter(rule =>
    rule &&
    typeof rule === 'object' &&
    !Array.isArray(rule)
  );
  const invalidRules = input.rules.length - validRules.length;
  const rulesById = new Map();
  validRules.forEach((rule, index) => {
    const id = ruleId(rule, index);
    if (!rulesById.has(id)) rulesById.set(id, rule);
  });
  const materializationsByRule = componentIndex(
    input.materializations,
    'ruleId'
  );
  const statusEventsByRule = componentIndex(input.statusEvents, 'ruleId');
  const effectivenessByRule = componentIndex(
    input.effectivenessSummaries,
    'ruleId'
  );
  const lifecycleByCandidate = componentIndex(
    input.lifecycleStates,
    'candidateId'
  );
  const conflicts = detectRuleConflicts({
    rules: validRules,
    options: normalizedOptions,
  });
  const duplicates = detectRuleDuplicates({
    rules: validRules,
    options: normalizedOptions,
  });
  return {
    ...input,
    rawRules: input.rules,
    rules: validRules,
    invalidRules,
    options: normalizedOptions,
    rulesById,
    materializationsByRule,
    statusEventsByRule,
    effectivenessByRule,
    lifecycleByCandidate,
    conflicts,
    duplicates,
  };
}

function daysSince(asOf, timestamp) {
  if (!validTimestamp(timestamp)) return null;
  return Math.max(
    0,
    Math.floor((Date.parse(asOf) - Date.parse(timestamp)) / DAY_MS)
  );
}

function statusHistoryConsistent(rule, events) {
  if (!events || events.length === 0) return null;
  const latest = events.slice().sort((left, right) =>
    (Date.parse(left?.recordedAt) || 0) -
    (Date.parse(right?.recordedAt) || 0)
  ).at(-1);
  return upper(latest?.toStatus) === statusOf(rule);
}

function lifecycleConsistent(rule, context) {
  const candidateId = optionalText(rule?.provenance?.candidateId);
  if (!candidateId) return null;
  const states = context.lifecycleByCandidate.get(candidateId);
  if (!states || states.length === 0) return null;
  return states.some(state => upper(state?.status) === 'APPROVED');
}

function perRuleFindings(rule, context, index = 0) {
  const findings = [];
  const id = ruleId(rule, index);
  const status = statusOf(rule);
  const action = actionOf(rule);
  const scope = scopeOf(rule);
  const provenance = provenanceOf(rule);
  const materializations = context.materializationsByRule.get(id) || [];
  const statusEvents = context.statusEventsByRule.get(id) || [];
  const effectivenessEntry =
    (context.effectivenessByRule.get(id) || [])[0] ||
    (
      rule?.effectiveness
        ? { ruleId: id, effectiveness: rule.effectiveness }
        : null
    );
  const effect = effectivenessEntry
    ? effectivenessOf(effectivenessEntry)
    : null;
  const add = value => findings.push(value);
  const make = (
    type,
    severity,
    evidence,
    recommendedReviewAction,
    navigationTarget,
    explanationCodes
  ) => finding({
    type,
    severity,
    rules: [rule],
    evidence,
    recommendedReviewAction,
    navigationTarget,
    explanationCodes,
  });

  if (!SUPPORTED_RULE_TYPES.includes(upper(rule?.ruleType))) {
    add(make(
      'RULE_UNSUPPORTED_TYPE',
      'HIGH',
      { ruleType: upper(rule?.ruleType) },
      'REVIEW_RULE',
      'MATERIALIZED_RULES',
      ['RULE_REQUIRES_MANUAL_REVIEW']
    ));
  }
  if (scope.scopeType !== 'ITEM' || !scope.scopeKey) {
    add(make(
      'RULE_SCOPE_TOO_BROAD',
      'HIGH',
      { scopeType: scope.scopeType },
      'REVIEW_RULE',
      'MATERIALIZED_RULES',
      ['RULE_REQUIRES_MANUAL_REVIEW']
    ));
  }
  if (!provenance || Object.keys(provenance).length === 0) {
    add(make(
      'RULE_MISSING_PROVENANCE',
      'HIGH',
      {},
      'REVIEW_PROVENANCE',
      'MATERIALIZED_RULES',
      ['RULE_PROVENANCE_MISSING']
    ));
  }
  if (
    upper(rule?.source?.type ?? rule?.source) ===
      'OWNER_LEARNING_CANDIDATE' &&
    materializations.length === 0
  ) {
    add(make(
      'RULE_MATERIALIZATION_MISSING',
      'HIGH',
      {},
      'REVIEW_PROVENANCE',
      'MATERIALIZED_RULES',
      ['RULE_MATERIALIZATION_MISSING']
    ));
  }
  if (confidenceOf(rule) === 'LOW') {
    add(make(
      'RULE_LOW_CONFIDENCE',
      'MEDIUM',
      { confidenceLevel: 'LOW' },
      'COLLECT_MORE_DATA',
      'MATERIALIZED_RULES',
      ['RULE_HAS_LOW_CONFIDENCE']
    ));
  }
  if (priorityOf(rule) === 'LOW') {
    add(make(
      'RULE_LOW_PRIORITY',
      'LOW',
      { priorityLevel: 'LOW' },
      'REVIEW_RULE',
      'MATERIALIZED_RULES',
      ['RULE_HAS_LOW_PRIORITY']
    ));
  }
  if (
    lifecycleConsistent(rule, context) === false
  ) {
    add(make(
      'RULE_LIFECYCLE_INCONSISTENT',
      'HIGH',
      { lifecycleStatus: upper(
        context.lifecycleByCandidate
          .get(rule?.provenance?.candidateId)?.[0]?.status
      ) },
      'REVIEW_RULE',
      'MATERIALIZED_RULES',
      ['RULE_LIFECYCLE_INCONSISTENT']
    ));
  }
  if (statusHistoryConsistent(rule, statusEvents) === false) {
    add(make(
      'RULE_STATUS_HISTORY_INCONSISTENT',
      'HIGH',
      { status, eventStatus: upper(statusEvents.at(-1)?.toStatus) },
      'REVIEW_RULE',
      'MATERIALIZED_RULES',
      ['RULE_STATUS_HISTORY_INCONSISTENT']
    ));
  }
  if (!effectivenessEntry) {
    add(make(
      status === 'ACTIVE'
        ? 'ACTIVE_RULE_WITHOUT_EFFECT_DATA'
        : 'RULE_EFFECTIVENESS_UNAVAILABLE',
      status === 'ACTIVE' ? 'MEDIUM' : 'INFO',
      {},
      'COLLECT_MORE_DATA',
      'RULE_EFFECTIVENESS',
      ['RULE_EFFECTIVENESS_MISSING']
    ));
  } else {
    const classification = effect.classification;
    const lastAppliedDays = effect.daysSinceLastApplied ??
      daysSince(context.options.asOf, effect.lastAppliedAt);
    const stale = (
      classification === 'STALE' ||
      (
        status === 'ACTIVE' &&
        effect.appliedEffectRuns > 0 &&
        lastAppliedDays !== null &&
        lastAppliedDays > context.options.staleRuleAfterDays
      )
    );
    if (stale) {
      add(make(
        'RULE_STALE',
        'HIGH',
        { daysSinceLastApplied: lastAppliedDays },
        'REVIEW_EFFECTIVENESS',
        'RULE_EFFECTIVENESS',
        ['RULE_IS_STALE']
      ));
    }
    if (
      classification === 'NO_EFFECT_YET' ||
      effect.consecutiveNoEffectRuns >=
        context.options.noEffectRunThreshold
    ) {
      add(make(
        'RULE_NO_EFFECT',
        'MEDIUM',
        {
          evaluatedRuns: effect.evaluatedRuns,
          appliedEffectRuns: effect.appliedEffectRuns,
        },
        'REVIEW_EFFECTIVENESS',
        'RULE_EFFECTIVENESS',
        ['RULE_EFFECTIVENESS_WEAK']
      ));
    }
    if (classification === 'REVIEW_RECOMMENDED') {
      add(make(
        'RULE_REVIEW_RECOMMENDED',
        'HIGH',
        { effectivenessClassification: classification },
        'REVIEW_EFFECTIVENESS',
        'RULE_EFFECTIVENESS',
        ['RULE_REQUIRES_MANUAL_REVIEW']
      ));
    }
    if (
      status === 'ACTIVE' &&
      effect.evaluatedRuns >= context.options.minEffectivenessRuns &&
      effect.appliedEffectRuns === 0
    ) {
      add(make(
        'ACTIVE_RULE_NEVER_APPLIED',
        'MEDIUM',
        {
          evaluatedRuns: effect.evaluatedRuns,
          appliedEffectRuns: 0,
        },
        'REVIEW_EFFECTIVENESS',
        'RULE_EFFECTIVENESS',
        ['RULE_EFFECTIVENESS_WEAK']
      ));
    }
    if (status === 'DISABLED' && effect.totalEvents > 0) {
      add(make(
        'DISABLED_RULE_WITH_EFFECT_EVENTS',
        'MEDIUM',
        { totalEvents: effect.totalEvents },
        'REVIEW_EFFECTIVENESS',
        'RULE_EFFECTIVENESS',
        ['RULE_REQUIRES_MANUAL_REVIEW']
      ));
    }
  }
  const timestamps = timestampsOf(rule);
  const updatedAge = daysSince(context.options.asOf, timestamps.updatedAt);
  if (
    updatedAge !== null &&
    updatedAge > context.options.oldRuleAfterDays
  ) {
    add(make(
      'RULE_LAST_UPDATED_TOO_OLD',
      'MEDIUM',
      { daysSinceUpdated: updatedAge },
      'REVIEW_RULE',
      'MATERIALIZED_RULES',
      ['RULE_IS_OLD']
    ));
  }
  if (
    !SUPPORTED_STATUSES.includes(status) ||
    !SUPPORTED_DECISIONS.includes(action.decision) ||
    !validTimestamp(timestamps.updatedAt) ||
    !displayScopeOf(rule).primary
  ) {
    add(make(
      'RULE_DATA_QUALITY_ISSUE',
      'MEDIUM',
      {
        supportedStatus: SUPPORTED_STATUSES.includes(status),
        supportedDecision: SUPPORTED_DECISIONS.includes(action.decision),
        validUpdatedAt: validTimestamp(timestamps.updatedAt),
        displayScopeAvailable: Boolean(displayScopeOf(rule).primary),
      },
      'REVIEW_RULE',
      'MATERIALIZED_RULES',
      ['RULE_REQUIRES_MANUAL_REVIEW']
    ));
  }
  return findings;
}

function ruleScore(findings) {
  return Math.max(
    0,
    100 - findings.reduce(
      (total, item) => total + SEVERITY_PENALTY[item.severity],
      0
    )
  );
}

function getKnowledgeHealthGrade(score) {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    invalid('score должен быть целым числом от 0 до 100.');
  }
  if (score >= 90) return 'EXCELLENT';
  if (score >= 75) return 'GOOD';
  if (score >= 50) return 'FAIR';
  if (score >= 25) return 'POOR';
  return 'CRITICAL';
}

function classificationFor(score, findings, hasData) {
  if (!hasData) return 'INSUFFICIENT_DATA';
  if (
    findings.some(item => item.severity === 'CRITICAL') ||
    score < 25
  ) return 'CRITICAL';
  if (
    findings.some(item => item.severity === 'HIGH') ||
    score < 50
  ) return 'REVIEW';
  if (findings.length > 0 || score < 90) return 'MONITOR';
  return 'HEALTHY';
}

function analyzeRuleHealth({ rule, context = {}, options = {} } = {}) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    invalid('rule должен быть объектом.');
  }
  const normalizedOptions = normalizeOptions(options);
  const normalizedContext = context.rulesById instanceof Map
    ? context
    : contextForAnalysis({
      rules: Array.isArray(context.rules) ? context.rules : [rule],
      materializations: context.materializations || [],
      lifecycleStates: context.lifecycleStates || [],
      effectivenessSummaries: context.effectivenessSummaries || [],
      statusEvents: context.statusEvents || [],
    }, normalizedOptions);
  const id = ruleId(rule);
  const own = perRuleFindings(rule, normalizedContext);
  const groupFindings = [
    ...normalizedContext.conflicts
      .filter(group => group.ruleIds.includes(id))
      .map(group => groupFinding(
        'RULE_CONFLICT',
        group,
        normalizedContext.rulesById
      )),
    ...normalizedContext.duplicates
      .filter(group => group.ruleIds.includes(id))
      .map(group => groupFinding(
        'RULE_DUPLICATE',
        group,
        normalizedContext.rulesById
      )),
  ];
  const findings = sortFindings([...own, ...groupFindings]);
  const score = ruleScore(findings);
  const effectivenessEntry =
    (normalizedContext.effectivenessByRule.get(id) || [])[0] ||
    (rule.effectiveness ? { effectiveness: rule.effectiveness } : null);
  const effect = effectivenessEntry
    ? effectivenessOf(effectivenessEntry)
    : null;
  const statusEvents =
    normalizedContext.statusEventsByRule.get(id) || [];
  const lifecycleStatus = optionalText(rule?.lifecycle?.status) ||
    optionalText(
      normalizedContext.lifecycleByCandidate
        .get(rule?.provenance?.candidateId)?.[0]?.status
    );
  return {
    ruleId: id,
    status: statusOf(rule),
    decision: actionOf(rule).decision,
    updatedAt: timestampsOf(rule).updatedAt,
    lastAppliedAt: effect?.lastAppliedAt || null,
    displayScope: displayScopeOf(rule),
    score,
    grade: getKnowledgeHealthGrade(score),
    classification: classificationFor(
      score,
      findings,
      Boolean(effectivenessEntry || provenanceOf(rule))
    ),
    signals: {
      hasConflict: groupFindings.some(item =>
        item.type === 'RULE_CONFLICT'
      ),
      hasDuplicate: groupFindings.some(item =>
        item.type === 'RULE_DUPLICATE'
      ),
      isStale: findings.some(item => item.type === 'RULE_STALE'),
      hasEffectivenessData: Boolean(effectivenessEntry),
      effectivenessClassification: effect?.classification || null,
      confidenceLevel: confidenceOf(rule),
      priorityLevel: priorityOf(rule),
      lifecycleStatus: upper(lifecycleStatus),
      provenanceAvailable: Boolean(provenanceOf(rule)),
      materializationAvailable:
        (normalizedContext.materializationsByRule.get(id) || []).length > 0,
      statusHistoryAvailable: statusEvents.length > 0,
    },
    findings,
    explanationCodes: unique(findings.flatMap(item =>
      item.explanationCodes
    )),
  };
}

function sortFindings(findings) {
  return findings.slice().sort((left, right) =>
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
    left.type.localeCompare(right.type, 'en') ||
    left.findingId.localeCompare(right.findingId, 'en')
  );
}

function dataQuality(context) {
  const ruleIds = new Set(context.rulesById.keys());
  const ids = context.rules.map((rule, index) => ruleId(rule, index));
  const duplicateRuleIds = unique(ids.filter((id, index) =>
    ids.indexOf(id) !== index
  )).sort();
  const orphanCount = (values, key) => values.filter(value => {
    const id = optionalText(value?.[key]);
    return id && !ruleIds.has(id);
  }).length;
  const invalidRuleTimestamps = context.rules.filter(rule => {
    const timestamps = timestampsOf(rule);
    return (
      !validTimestamp(timestamps.createdAt) ||
      !validTimestamp(timestamps.updatedAt)
    );
  }).length;
  const result = {
    invalidRules: context.invalidRules,
    rulesMissingProvenance: context.rules.filter(rule =>
      !provenanceOf(rule)
    ).length,
    rulesMissingMaterialization: context.rules.filter(rule =>
      upper(rule?.source?.type ?? rule?.source) ===
        'OWNER_LEARNING_CANDIDATE' &&
      !(context.materializationsByRule.get(ruleId(rule)) || []).length
    ).length,
    invalidRuleTimestamps,
    missingDisplayScope: context.rules.filter(rule =>
      !displayScopeOf(rule).primary
    ).length,
    missingConfidence: context.rules.filter(rule =>
      !confidenceOf(rule)
    ).length,
    missingPriority: context.rules.filter(rule =>
      !priorityOf(rule)
    ).length,
    duplicateRuleIds,
    orphanMaterializations:
      orphanCount(context.materializations, 'ruleId'),
    orphanLifecycleStates: context.lifecycleStates.filter(state => {
      const candidateId = optionalText(state?.candidateId);
      return candidateId && !context.rules.some(rule =>
        optionalText(rule?.provenance?.candidateId) === candidateId
      );
    }).length,
    orphanStatusEvents: orphanCount(context.statusEvents, 'ruleId'),
    orphanEffectivenessSummaries:
      orphanCount(context.effectivenessSummaries, 'ruleId'),
    warnings: [],
  };
  result.warnings = Object.entries(result)
    .filter(([name, value]) =>
      name !== 'warnings' &&
      (
        (Array.isArray(value) && value.length > 0) ||
        (Number.isInteger(value) && value > 0)
      )
    )
    .map(([name]) => `DATA_QUALITY_${name.replace(
      /([a-z])([A-Z])/g,
      '$1_$2'
    ).toUpperCase()}`)
    .sort();
  return result;
}

function dimensionsFromFindings(findings) {
  return Object.fromEntries(
    Object.entries(DIMENSION_WEIGHTS).map(([name, weight]) => {
      const items = findings.filter(item =>
        FINDING_DIMENSION[item.type] === name
      );
      const score = Math.max(
        0,
        100 - items.reduce(
          (total, item) =>
            total + SEVERITY_PENALTY[item.severity],
          0
        )
      );
      return [name, {
        score,
        weight,
        findingsCount: items.length,
        criticalFindings: items.filter(item =>
          item.severity === 'CRITICAL'
        ).length,
        explanationCodes: unique(items.flatMap(item =>
          item.explanationCodes
        )),
      }];
    })
  );
}

function analyzeKnowledgeHealth(input = {}) {
  validateArrays(input);
  const normalizedOptions = normalizeOptions(input.options || {});
  const context = contextForAnalysis(input, normalizedOptions);
  const groupFindings = [
    ...context.conflicts.map(group =>
      groupFinding('RULE_CONFLICT', group, context.rulesById)
    ),
    ...context.duplicates.map(group =>
      groupFinding('RULE_DUPLICATE', group, context.rulesById)
    ),
  ];
  const individualFindings = context.rules.flatMap((rule, index) =>
    perRuleFindings(rule, context, index)
  );
  const invalidRuleFindings = context.invalidRules > 0
    ? [finding({
      type: 'RULE_DATA_QUALITY_ISSUE',
      severity: 'MEDIUM',
      rules: [],
      evidence: { invalidRules: context.invalidRules },
      recommendedReviewAction: 'REVIEW_RULE',
      navigationTarget: 'MATERIALIZED_RULES',
      explanationCodes: ['DATA_QUALITY_INVALID_RULES'],
    })]
    : [];
  const findings = sortFindings([
    ...groupFindings,
    ...individualFindings,
    ...invalidRuleFindings,
  ]);
  const ruleHealth = context.rules.map(rule =>
    analyzeRuleHealth({
      rule,
      context,
      options: normalizedOptions,
    })
  ).sort((left, right) =>
    left.ruleId.localeCompare(right.ruleId, 'en')
  );
  const dimensions = dimensionsFromFindings(findings);
  const weightedScore = Math.max(0, Math.min(100, Math.round(
    Object.values(dimensions).reduce(
      (total, dimension) =>
        total + dimension.score * dimension.weight,
      0
    ) / 100
  )));
  const score = context.invalidRules > 0
    ? Math.min(89, weightedScore)
    : weightedScore;
  const grade = getKnowledgeHealthGrade(score);
  const criticalRuleIds = new Set(
    findings.filter(item =>
      ['CRITICAL', 'HIGH'].includes(item.severity)
    ).flatMap(item => item.ruleIds)
  );
  const attentionRuleIds = new Set(
    findings.filter(item =>
      ['MEDIUM', 'LOW'].includes(item.severity)
    ).flatMap(item => item.ruleIds)
  );
  const summary = {
    totalRules: context.rules.length,
    activeRules: context.rules.filter(rule =>
      statusOf(rule) === 'ACTIVE'
    ).length,
    disabledRules: context.rules.filter(rule =>
      statusOf(rule) === 'DISABLED'
    ).length,
    healthyRules: ruleHealth.filter(rule =>
      rule.classification === 'HEALTHY'
    ).length,
    attentionRules: attentionRuleIds.size,
    criticalRules: criticalRuleIds.size,
    duplicateGroups: context.duplicates.length,
    conflictGroups: context.conflicts.length,
    staleRules: ruleHealth.filter(rule =>
      rule.signals.isStale
    ).length,
    noEffectRules: ruleHealth.filter(rule =>
      rule.findings.some(item => item.type === 'RULE_NO_EFFECT')
    ).length,
    inconsistentRules: ruleHealth.filter(rule =>
      rule.findings.some(item => [
        'RULE_LIFECYCLE_INCONSISTENT',
        'RULE_STATUS_HISTORY_INCONSISTENT',
        'RULE_MATERIALIZATION_MISSING',
      ].includes(item.type))
    ).length,
  };
  const healthCode = context.invalidRules > 0
    ? 'KNOWLEDGE_BASE_DEGRADED'
    : score >= 75
    ? 'KNOWLEDGE_BASE_HEALTHY'
    : (score >= 25
      ? 'KNOWLEDGE_BASE_DEGRADED'
      : 'KNOWLEDGE_BASE_CRITICAL');
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: normalizedOptions.asOf,
    score,
    grade,
    summary,
    dimensions,
    findings,
    ruleHealth,
    dataQuality: dataQuality(context),
    explanationCodes: [
      'KNOWLEDGE_HEALTH_SCORE_IS_OBSERVATIONAL',
      healthCode,
    ],
  };
}

module.exports = {
  DEFAULT_OPTIONS,
  DIMENSION_WEIGHTS,
  ERROR_CODE,
  EXPLANATION_CODES,
  FINDING_DIMENSION,
  SCHEMA_VERSION,
  SEVERITY_ORDER,
  SUPPORTED_DECISIONS,
  SUPPORTED_RULE_TYPES,
  SUPPORTED_STATUSES,
  OwnerKnowledgeHealthError,
  analyzeKnowledgeHealth,
  analyzeRuleHealth,
  detectRuleConflicts,
  detectRuleDuplicates,
  getKnowledgeHealthGrade,
  normalizeOptions,
  sortFindings,
};
