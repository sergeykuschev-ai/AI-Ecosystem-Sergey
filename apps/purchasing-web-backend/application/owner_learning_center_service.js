const crypto = require('node:crypto');

const OWNER_LEARNING_CENTER_INVALID_INPUT =
  'OWNER_LEARNING_CENTER_INVALID_INPUT';
const OWNER_LEARNING_CENTER_UNAVAILABLE =
  'OWNER_LEARNING_CENTER_UNAVAILABLE';
const MANUAL_REVIEW_CODE = 'ATTENTION_REQUIRES_MANUAL_REVIEW';
const NAVIGATION_TARGETS = Object.freeze({
  decisions: 'DECISION_HISTORY',
  candidates: 'CANDIDATES',
  rules: 'MATERIALIZED_RULES',
  effectiveness: 'RULE_EFFECTIVENESS',
  knowledgeHealth: 'KNOWLEDGE_HEALTH',
});
const PRIORITY_ORDER = Object.freeze({
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
});

class OwnerLearningCenterServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerLearningCenterServiceError';
    this.code = code;
  }
}

function invalidInput(message) {
  throw new OwnerLearningCenterServiceError(
    OWNER_LEARNING_CENTER_INVALID_INPUT,
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

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function strictIsoUtc(value, name) {
  const normalized = optionalText(value);
  const timestamp = normalized ? Date.parse(normalized) : NaN;
  if (
    !normalized ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
      normalized
    ) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 19) !==
      normalized.slice(0, 19)
  ) {
    invalidInput(`${name} должен быть ISO UTC datetime.`);
  }
  return new Date(Date.parse(normalized)).toISOString();
}

function dateFilter(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = optionalText(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(normalized || '');
  const source = dateOnly
    ? `${normalized}T${
      name === 'dateTo' ? '23:59:59.999' : '00:00:00.000'
    }Z`
    : normalized;
  if (
    !source ||
    !Number.isFinite(Date.parse(source)) ||
    (!dateOnly && !source.endsWith('Z')) ||
    (
      dateOnly &&
      new Date(Date.parse(source)).toISOString().slice(0, 10) !==
        normalized
    )
  ) {
    invalidInput(`${name} должен быть UTC-датой.`);
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
    'supplier',
    'brand',
    'category',
    'dateFrom',
    'dateTo',
  ]);
  const allowedOptions = new Set([
    'attentionLimit',
    'activityLimit',
    'asOf',
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
  const normalizedFilters = {};
  for (const name of ['supplier', 'brand', 'category']) {
    if (filters[name] === undefined || filters[name] === null ||
        filters[name] === '') {
      continue;
    }
    const value = optionalText(filters[name]);
    if (
      !value ||
      value.length > 512 ||
      value.includes('\0')
    ) {
      invalidInput(`Фильтр ${name} имеет неверное значение.`);
    }
    normalizedFilters[name] = value;
  }
  for (const name of ['dateFrom', 'dateTo']) {
    const value = dateFilter(filters[name], name);
    if (value) normalizedFilters[name] = value;
  }
  if (
    normalizedFilters.dateFrom &&
    normalizedFilters.dateTo &&
    Date.parse(normalizedFilters.dateFrom) >
      Date.parse(normalizedFilters.dateTo)
  ) {
    invalidInput('dateFrom не может быть позже dateTo.');
  }
  const limit = (name, fallback) => {
    const value = options[name] === undefined
      ? fallback
      : options[name];
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      invalidInput(`Option ${name} должен быть от 1 до 100.`);
    }
    return value;
  };
  let asOf;
  if (options.asOf) {
    asOf = strictIsoUtc(options.asOf, 'asOf');
  } else {
    const nowValue = now();
    const nowDate = nowValue instanceof Date
      ? nowValue
      : new Date(nowValue);
    if (!Number.isFinite(nowDate.getTime())) {
      invalidInput('now должен возвращать допустимую дату.');
    }
    asOf = nowDate.toISOString();
  }
  return {
    filters: normalizedFilters,
    options: {
      attentionLimit: limit('attentionLimit', 20),
      activityLimit: limit('activityLimit', 20),
      asOf,
    },
  };
}

function component(status, warning = null) {
  return {
    status: ['AVAILABLE', 'EMPTY'].includes(status)
      ? status
      : 'UNAVAILABLE',
    warning: safeText(warning),
  };
}

function availability(result, itemCount, warning) {
  if (!result || result.status !== 'AVAILABLE') {
    return component('UNAVAILABLE', warning || result?.warning);
  }
  return component(itemCount === 0 ? 'EMPTY' : 'AVAILABLE');
}

function maxTimestamp(values) {
  return values
    .filter(value => safeText(value) && Number.isFinite(Date.parse(value)))
    .sort((left, right) =>
      Date.parse(right) - Date.parse(left) ||
      right.localeCompare(left, 'en')
    )[0] || null;
}

function displayScope(value = {}) {
  return {
    primary:
      safeText(value.primary) || 'Объект без названия',
    secondary: safeText(value.secondary),
  };
}

function digestAttention({
  type,
  entityType,
  entityId,
  state,
  sourceVersion,
}) {
  return crypto.createHash('sha256').update(JSON.stringify([
    type,
    entityType,
    entityId,
    state || null,
    sourceVersion || 'NO_SOURCE_VERSION',
  ]), 'utf8').digest('hex');
}

function attentionItem(input) {
  const item = {
    attentionId: digestAttention(input),
    type: input.type,
    priority: input.priority,
    title: input.title,
    description: input.description,
    displayScope: displayScope(input.displayScope),
    entityType: input.entityType,
    entityId: safeText(input.entityId),
    navigationTarget: input.navigationTarget,
    createdAt: safeText(input.createdAt),
    explanationCodes: [
      MANUAL_REVIEW_CODE,
      ...(input.explanationCodes || []),
    ].filter((value, index, values) =>
      safeText(value) && values.indexOf(value) === index
    ),
  };
  return item;
}

function compareAttention(left, right) {
  const priority =
    PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
  if (priority !== 0) return priority;
  const time =
    (Date.parse(right.createdAt) || 0) -
    (Date.parse(left.createdAt) || 0);
  if (time !== 0) return time;
  return left.attentionId.localeCompare(right.attentionId, 'en');
}

function compareActivity(left, right) {
  const time =
    (Date.parse(right.recordedAt) || 0) -
    (Date.parse(left.recordedAt) || 0);
  if (time !== 0) return time;
  return [
    left.activityType,
    left.navigationTarget,
    left.description,
    left.displayScope?.primary,
    left.displayScope?.secondary,
    left.status,
    left.decision,
    left.amountDelta,
    left.quantityDelta,
  ].join('\0').localeCompare([
    right.activityType,
    right.navigationTarget,
    right.description,
    right.displayScope?.primary,
    right.displayScope?.secondary,
    right.status,
    right.decision,
    right.amountDelta,
    right.quantityDelta,
  ].join('\0'), 'ru');
}

function candidateSummary(result) {
  if (!result || result.status !== 'AVAILABLE') return null;
  const candidates = Array.isArray(result.candidates)
    ? result.candidates
    : [];
  const lifecycle = status => candidates.filter(candidate =>
    candidate.lifecycle?.status === status
  ).length;
  return {
    total: count(result.summary?.totalCandidates),
    eligible: count(result.summary?.eligible),
    reviewOnly: count(result.summary?.reviewOnly),
    ineligible: count(result.summary?.ineligible),
    approved: lifecycle('APPROVED'),
    postponed: lifecycle('POSTPONED'),
    rejected: lifecycle('REJECTED'),
  };
}

function effectivenessSummary(result) {
  if (!result || result.status !== 'AVAILABLE') return null;
  const rules = Array.isArray(result.rules) ? result.rules : [];
  const classification = value => rules.filter(rule =>
    rule.effectiveness?.classification === value
  ).length;
  return {
    withData: rules.filter(rule =>
      count(rule.effectiveness?.population?.totalEvents) > 0
    ).length,
    effective: classification('EFFECTIVE'),
    occasional: classification('OCCASIONAL'),
    noEffectYet: classification('NO_EFFECT_YET'),
    stale: classification('STALE'),
    reviewRecommended: classification('REVIEW_RECOMMENDED'),
    insufficientData: classification('INSUFFICIENT_DATA'),
    totalOrderAmountDelta:
      safeNumber(result.summary?.totalOrderAmountDelta) ?? 0,
  };
}

function summary(results) {
  const analytics = results.decisions?.analytics;
  const rulesSummary = results.rules?.summary;
  return {
    decisions:
      results.decisions?.status === 'AVAILABLE' && analytics
        ? {
          total: count(analytics.population?.filteredEntries),
          uniqueItems: count(analytics.population?.uniqueItems),
          agreementRate:
            safeNumber(analytics.agreementAnalysis?.agreementRate),
        }
        : null,
    candidates: candidateSummary(results.candidates),
    rules:
      results.rules?.status === 'AVAILABLE' && rulesSummary
        ? {
          total: count(rulesSummary.totalRules),
          active: count(rulesSummary.activeRules),
          disabled: count(rulesSummary.disabledRules),
          buy: count(rulesSummary.buyRules),
          skip: count(rulesSummary.skipRules),
          defer: count(rulesSummary.deferRules),
        }
        : null,
    effectiveness: effectivenessSummary(results.effectiveness),
    knowledgeHealth:
      ['AVAILABLE', 'PARTIAL'].includes(results.knowledgeHealth?.status)
        ? {
          score: safeNumber(results.knowledgeHealth.score),
          grade: safeText(results.knowledgeHealth.grade),
          criticalFindings: (results.knowledgeHealth.findings || [])
            .filter(item => item.severity === 'CRITICAL').length,
          attentionFindings: (results.knowledgeHealth.findings || [])
            .filter(item => [
              'HIGH',
              'MEDIUM',
              'LOW',
            ].includes(item.severity)).length,
          conflictGroups:
            count(results.knowledgeHealth.summary?.conflictGroups),
          duplicateGroups:
            count(results.knowledgeHealth.summary?.duplicateGroups),
          staleRules:
            count(results.knowledgeHealth.summary?.staleRules),
        }
        : null,
  };
}

function knowledgeHealthAttention(result) {
  if (!['AVAILABLE', 'PARTIAL'].includes(result?.status)) return [];
  const attentionTypes = new Set([
    'RULE_CONFLICT',
    'RULE_DUPLICATE',
    'RULE_STALE',
    'RULE_REVIEW_RECOMMENDED',
    'RULE_MISSING_PROVENANCE',
    'RULE_LIFECYCLE_INCONSISTENT',
  ]);
  return (result.findings || []).filter(item =>
    attentionTypes.has(item.type) &&
    (
      item.type !== 'RULE_DUPLICATE' ||
      item.evidence?.duplicateType === 'ACTIVE_DUPLICATE'
    )
  ).map(item => attentionItem({
    type: item.type,
    priority: item.severity === 'CRITICAL'
      ? 'CRITICAL'
      : (
        item.severity === 'HIGH'
          ? 'HIGH'
          : (item.severity === 'MEDIUM' ? 'MEDIUM' : 'LOW')
      ),
    title: item.titleCode,
    description: item.descriptionCode,
    displayScope: item.displayScopes?.[0],
    entityType: 'KNOWLEDGE_HEALTH_FINDING',
    entityId: item.findingId,
    navigationTarget: NAVIGATION_TARGETS.knowledgeHealth,
    createdAt: result.generatedAt,
    state: `${item.type}:${item.severity}`,
    sourceVersion: item.findingId,
    explanationCodes: item.explanationCodes,
  }));
}

function candidateAttention(result) {
  if (!result || result.status !== 'AVAILABLE') return [];
  return (result.candidates || []).flatMap(candidate => {
    const items = [];
    const lifecycle = candidate.lifecycle || {};
    const materialization = candidate.materialization || {};
    const common = {
      entityType: 'CANDIDATE',
      entityId: candidate.candidateId,
      displayScope: candidate.displayScope,
      navigationTarget: NAVIGATION_TARGETS.candidates,
      createdAt: lifecycle.lastRecordedAt,
      sourceVersion:
        lifecycle.lastRecordedAt ||
        materialization.materializedAt ||
        candidate.generatedAt,
    };
    if (
      lifecycle.status === 'APPROVED' &&
      materialization.status === 'NOT_MATERIALIZED'
    ) {
      items.push(attentionItem({
        ...common,
        type: 'APPROVED_CANDIDATE_NOT_MATERIALIZED',
        priority: 'HIGH',
        state: `${lifecycle.status}:${materialization.status}`,
        title: 'Одобренный кандидат ещё не материализован',
        description:
          'Проверьте кандидата и при необходимости вручную создайте правило.',
      }));
    }
    if (lifecycle.status === 'POSTPONED') {
      items.push(attentionItem({
        ...common,
        type: 'CANDIDATE_POSTPONED',
        priority: 'MEDIUM',
        state: lifecycle.status,
        title: 'Проверка кандидата отложена',
        description:
          'Вернитесь к кандидату и решите, достаточно ли данных для проверки.',
      }));
    }
    if (
      ['NEW', 'UNDER_REVIEW'].includes(lifecycle.status) &&
      candidate.eligibility?.status === 'ELIGIBLE'
    ) {
      items.push(attentionItem({
        ...common,
        type: 'CANDIDATE_AWAITING_REVIEW',
        priority: 'MEDIUM',
        state: `${lifecycle.status}:ELIGIBLE`,
        title: 'Кандидат ожидает ручной проверки',
        description:
          'История соответствует критериям кандидата, но решение принимает владелец.',
      }));
    } else if (
      lifecycle.status === 'NEW' &&
      candidate.eligibility?.status === 'REVIEW_ONLY'
    ) {
      items.push(attentionItem({
        ...common,
        type: 'CANDIDATE_AWAITING_REVIEW',
        priority: 'LOW',
        state: `${lifecycle.status}:REVIEW_ONLY`,
        title: 'Кандидат доступен только для наблюдения',
        description:
          'Данных недостаточно для обычного рассмотрения; возможен только ручной анализ.',
      }));
    }
    return items;
  });
}

function ruleAttention(rulesResult, effectivenessResult) {
  if (!rulesResult || rulesResult.status !== 'AVAILABLE') return [];
  const effectivenessById = new Map(
    (effectivenessResult?.rules || []).map(rule => [rule.ruleId, rule])
  );
  return (rulesResult.rules || []).flatMap(rule => {
    const items = [];
    const effectivenessRule = effectivenessById.get(rule.ruleId);
    const effectiveness =
      effectivenessRule?.effectiveness || rule.effectiveness || {};
    const classification = effectiveness.classification;
    const createdAt =
      effectiveness.activity?.lastEvaluatedAt ||
      effectiveness.activity?.lastAppliedAt ||
      rule.management?.lastStatusChangeAt ||
      rule.timestamps?.updatedAt;
    const common = {
      entityType: 'RULE',
      entityId: rule.ruleId,
      displayScope: rule.displayScope,
      navigationTarget: NAVIGATION_TARGETS.effectiveness,
      createdAt,
      sourceVersion: createdAt,
    };
    if (
      rule.status === 'DISABLED' &&
      rule.lifecycle?.status === 'APPROVED'
    ) {
      items.push(attentionItem({
        ...common,
        type: 'DISABLED_RULE_READY_FOR_REVIEW',
        priority: 'LOW',
        state: `${rule.status}:${rule.lifecycle.status}`,
        navigationTarget: NAVIGATION_TARGETS.rules,
        title: 'Неактивное правило готово к проверке',
        description:
          'Правило остаётся неактивным; его статус можно изменить только вручную.',
      }));
    }
    if (rule.status !== 'ACTIVE') return items;
    if (classification === 'REVIEW_RECOMMENDED') {
      const fallbackRuns = count(effectiveness.population?.fallbackRuns);
      items.push(attentionItem({
        ...common,
        type: 'ACTIVE_RULE_REVIEW_RECOMMENDED',
        priority: fallbackRuns > 0 ? 'CRITICAL' : 'HIGH',
        state: `${rule.status}:${classification}:${fallbackRuns}`,
        title: 'Активное правило требует ручной проверки',
        description: fallbackRuns > 0
          ? 'Для правила зафиксирован fallback; проверьте историю применения.'
          : 'Накопленные результаты указывают на необходимость ручной проверки.',
        explanationCodes: effectiveness.explanationCodes,
      }));
    } else if (classification === 'STALE') {
      items.push(attentionItem({
        ...common,
        type: 'ACTIVE_RULE_STALE',
        priority: 'HIGH',
        state: `${rule.status}:${classification}`,
        title: 'Активное правило давно не срабатывало',
        description:
          'Проверьте актуальность правила и его область применения.',
        explanationCodes: effectiveness.explanationCodes,
      }));
    } else if (classification === 'NO_EFFECT_YET') {
      items.push(attentionItem({
        ...common,
        type: 'ACTIVE_RULE_NO_EFFECT_YET',
        priority: 'MEDIUM',
        state: `${rule.status}:${classification}`,
        title: 'Активное правило пока не изменяло заказ',
        description:
          'Проверьте правило после накопления достаточной истории запусков.',
        explanationCodes: effectiveness.explanationCodes,
      }));
    }
    return items;
  });
}

function dataQualityAttention(results) {
  const warnings =
    results.decisions?.analytics?.dataQuality?.warnings || [];
  if (warnings.length === 0) return [];
  const analytics = results.decisions.analytics;
  return [attentionItem({
    type: 'DECISION_HISTORY_DATA_QUALITY',
    priority: 'LOW',
    title: 'В истории решений есть предупреждения качества данных',
    description:
      'Проверьте полноту истории перед использованием выводов для обучения.',
    displayScope: { primary: 'История решений' },
    entityType: 'COMPONENT',
    entityId: 'decisionHistory',
    navigationTarget: NAVIGATION_TARGETS.decisions,
    createdAt: null,
    state: warnings.join(','),
    sourceVersion: warnings.join(','),
    explanationCodes: warnings,
  })];
}

function unavailableAttention(health) {
  return Object.entries(health.components).flatMap(([name, value]) => {
    if (value.status !== 'UNAVAILABLE') return [];
    const critical = [
      'approvedRulesRegistry',
      'materializations',
      'ruleStatusEvents',
    ].includes(name);
    const effectiveness = name === 'ruleEffectiveness';
    return [attentionItem({
      type: effectiveness
        ? 'RULE_EFFECTIVENESS_UNAVAILABLE'
        : 'OWNER_LEARNING_COMPONENT_UNAVAILABLE',
      priority: critical ? 'CRITICAL' : (effectiveness ? 'MEDIUM' : 'LOW'),
      title: effectiveness
        ? 'Эффективность правил временно недоступна'
        : 'Компонент базы знаний временно недоступен',
      description:
        'Доступные read-only разделы продолжают работать; требуется ручная проверка состояния данных.',
      displayScope: { primary: name },
      entityType: 'COMPONENT',
      entityId: name,
      navigationTarget: effectiveness
        ? NAVIGATION_TARGETS.effectiveness
        : (
          name === 'decisionHistory'
            ? NAVIGATION_TARGETS.decisions
            : NAVIGATION_TARGETS.rules
        ),
      createdAt: null,
      state: value.status,
      sourceVersion: value.warning || value.status,
      explanationCodes: value.warning ? [value.warning] : [],
    })];
  });
}

function candidateActivities(candidatesResult, lifecycleResult) {
  if (!lifecycleResult || !Array.isArray(lifecycleResult.states)) return [];
  const candidates = new Map(
    (candidatesResult?.candidates || []).map(candidate => [
      candidate.candidateId,
      candidate,
    ])
  );
  return lifecycleResult.states.flatMap(state => {
    const event = state.lastEvent;
    if (!event) return [];
    const candidate = candidates.get(state.candidateId);
    const scope = candidate?.displayScope ||
      event.candidateSnapshot?.displayScope;
    return [{
      activityType: 'CANDIDATE_STATUS_CHANGED',
      recordedAt: safeText(event.recordedAt),
      displayScope: displayScope(scope),
      description: 'Статус кандидата изменён владельцем.',
      status: safeText(event.toStatus),
      decision:
        safeText(candidate?.proposedAction?.decision) ||
        safeText(event.candidateSnapshot?.proposedDecision),
      amountDelta: null,
      quantityDelta: null,
      navigationTarget: NAVIGATION_TARGETS.candidates,
    }];
  });
}

function ruleActivities(rulesResult) {
  if (!rulesResult || rulesResult.status !== 'AVAILABLE') return [];
  const rulesById = new Map(
    (rulesResult.rules || []).map(rule => [rule.ruleId, rule])
  );
  const snapshot = rulesResult.centerSnapshot || {};
  const materializations = (snapshot.materializationEvents || []).map(event => {
    const rule = rulesById.get(event.ruleId);
    return {
      activityType: 'RULE_MATERIALIZED',
      recordedAt: safeText(event.recordedAt),
      displayScope: displayScope(rule?.displayScope),
      description: 'Кандидат вручную материализован в неактивное правило.',
      status: safeText(event.ruleStatus),
      decision:
        safeText(rule?.action?.decision) ||
        safeText(event.snapshot?.proposedDecision),
      amountDelta: null,
      quantityDelta: null,
      navigationTarget: NAVIGATION_TARGETS.rules,
    };
  });
  const statuses = (snapshot.statusEvents || []).map(event => {
    const activated = event.toStatus === 'ACTIVE';
    const rule = rulesById.get(event.ruleId);
    return {
      activityType: activated
        ? 'RULE_ACTIVATED'
        : 'RULE_DEACTIVATED',
      recordedAt: safeText(event.recordedAt),
      displayScope: displayScope(rule?.displayScope),
      description: activated
        ? 'Правило активировано владельцем.'
        : 'Правило отключено владельцем.',
      status: safeText(event.toStatus),
      decision:
        safeText(rule?.action?.decision) ||
        safeText(event.ruleSnapshot?.decision),
      amountDelta: null,
      quantityDelta: null,
      navigationTarget: NAVIGATION_TARGETS.rules,
    };
  });
  return [...materializations, ...statuses];
}

function effectivenessActivities(result) {
  const events = result?.centerSnapshot?.events || [];
  const rulesById = new Map(
    (result?.rules || []).map(rule => [rule.ruleId, rule])
  );
  return events.flatMap(event => {
    const fallback = event.effectStatus === 'FALLBACK_TO_BASELINE';
    if (event.effectStatus !== 'APPLIED_EFFECT' && !fallback) return [];
    const rule = rulesById.get(event.ruleId);
    return [{
      activityType: fallback
        ? 'RULE_FALLBACK_RECORDED'
        : 'RULE_APPLIED_EFFECT',
      recordedAt: safeText(event.recordedAt),
      displayScope: displayScope({
        primary:
          event.scopeSnapshot?.displayPrimary ||
          rule?.displayScope?.primary,
        secondary:
          event.scopeSnapshot?.displaySecondary ||
          rule?.displayScope?.secondary,
      }),
      description: fallback
        ? 'Зафиксирован безопасный возврат к baseline.'
        : 'Правило изменило рассчитанный заказ.',
      status: safeText(event.effectStatus),
      decision: safeText(event.decision || rule?.decision),
      amountDelta: safeNumber(event.impact?.orderAmountDelta),
      quantityDelta: safeNumber(event.impact?.quantityDelta),
      navigationTarget: NAVIGATION_TARGETS.effectiveness,
    }];
  });
}

function buildHealth(results) {
  const rules = results.rules?.rules || [];
  const ruleCount = count(results.rules?.summary?.totalRules);
  const decisionCount =
    count(results.decisions?.analytics?.population?.filteredEntries);
  const candidateCount =
    count(results.candidates?.summary?.totalCandidates);
  const lifecycleCount = Array.isArray(results.lifecycle?.states)
    ? results.lifecycle.states.length
    : 0;
  const effectivenessCount =
    count(results.effectiveness?.summary?.totalRules);
  const ruleWarnings = new Set([
    results.rules?.warning,
    ...(results.rules?.centerSnapshot?.warnings || []),
  ].filter(Boolean));
  const components = {
    decisionHistory: availability(
      results.decisions,
      decisionCount,
      'OWNER_DECISION_ANALYTICS_UNAVAILABLE'
    ),
    candidates: availability(
      results.candidates,
      candidateCount,
      'OWNER_LEARNING_CANDIDATES_UNAVAILABLE'
    ),
    candidateLifecycle: results.lifecycle
      ? component(lifecycleCount === 0 ? 'EMPTY' : 'AVAILABLE')
      : component(
        'UNAVAILABLE',
        'OWNER_LEARNING_LIFECYCLE_UNAVAILABLE'
      ),
    materializations: ruleWarnings.has(
      'OWNER_RULE_MATERIALIZATION_HISTORY_UNAVAILABLE'
    ) || results.candidates?.materializationWarning
      ? component(
        'UNAVAILABLE',
        'OWNER_RULE_MATERIALIZATION_HISTORY_UNAVAILABLE'
      )
      : component(ruleCount === 0 ? 'EMPTY' : 'AVAILABLE'),
    approvedRulesRegistry: availability(
      results.rules,
      ruleCount,
      'OWNER_MATERIALIZED_RULES_UNAVAILABLE'
    ),
    ruleStatusEvents: ruleWarnings.has(
      'OWNER_RULE_STATUS_HISTORY_UNAVAILABLE'
    )
      ? component(
        'UNAVAILABLE',
        'OWNER_RULE_STATUS_HISTORY_UNAVAILABLE'
      )
      : component(
        rules.some(rule => rule.management?.lastStatusChangeAt)
          ? 'AVAILABLE'
          : 'EMPTY'
      ),
    ruleActivationPreviews: component('EMPTY'),
    ruleEffectiveness: availability(
      results.effectiveness,
      effectivenessCount,
      'OWNER_RULE_EFFECTIVENESS_UNAVAILABLE'
    ),
    knowledgeHealth: results.knowledgeHealth === undefined
      ? component('EMPTY')
      : (
        ['AVAILABLE', 'PARTIAL'].includes(
          results.knowledgeHealth?.status
        )
          ? component('AVAILABLE')
          : component(
            'UNAVAILABLE',
            'OWNER_KNOWLEDGE_HEALTH_UNAVAILABLE'
          )
      ),
  };
  const dataQualityWarnings = [
    ...(results.decisions?.analytics?.dataQuality?.warnings || []),
    ...(results.effectiveness?.rules || []).flatMap(rule =>
      rule.effectiveness?.quality?.warnings || []
    ),
  ].filter((value, index, values) =>
    safeText(value) && values.indexOf(value) === index
  );
  const criticalUnavailable =
    components.decisionHistory.status === 'UNAVAILABLE' &&
    components.approvedRulesRegistry.status === 'UNAVAILABLE';
  const anyUnavailable = Object.values(components).some(value =>
    value.status === 'UNAVAILABLE'
  );
  return {
    overallStatus: criticalUnavailable
      ? 'UNAVAILABLE'
      : (anyUnavailable ? 'DEGRADED' : 'HEALTHY'),
    components,
    dataQualityWarnings,
    lastKnowledgeChangeAt: maxTimestamp([
      results.lifecycle?.summary?.lastRecordedAt,
      ...rules.map(rule => rule.provenance?.materializedAt),
    ]),
    lastRuleStatusChangeAt: maxTimestamp(
      rules.map(rule => rule.management?.lastStatusChangeAt)
    ),
    lastRuleEffectAt: maxTimestamp(
      (results.effectiveness?.rules || []).map(rule =>
        rule.effectiveness?.activity?.lastAppliedAt
      )
    ),
  };
}

function sections(results, attention) {
  const countByTarget = target => attention.filter(item =>
    item.navigationTarget === target
  ).length;
  const rules = results.rules?.summary;
  return {
    decisionHistory: {
      status: results.decisions?.status === 'AVAILABLE'
        ? (
          count(results.decisions.analytics?.population?.filteredEntries) > 0
            ? 'AVAILABLE'
            : 'EMPTY'
        )
        : 'UNAVAILABLE',
      count:
        count(results.decisions?.analytics?.population?.filteredEntries),
      navigationTarget: NAVIGATION_TARGETS.decisions,
    },
    candidates: {
      status: results.candidates?.status === 'AVAILABLE'
        ? (
          count(results.candidates.summary?.totalCandidates) > 0
            ? 'AVAILABLE'
            : 'EMPTY'
        )
        : 'UNAVAILABLE',
      count: count(results.candidates?.summary?.totalCandidates),
      attentionCount: countByTarget(NAVIGATION_TARGETS.candidates),
      navigationTarget: NAVIGATION_TARGETS.candidates,
    },
    materializedRules: {
      status: results.rules?.status === 'AVAILABLE'
        ? (count(rules?.totalRules) > 0 ? 'AVAILABLE' : 'EMPTY')
        : 'UNAVAILABLE',
      count: count(rules?.totalRules),
      activeCount: count(rules?.activeRules),
      navigationTarget: NAVIGATION_TARGETS.rules,
    },
    effectiveness: {
      status: results.effectiveness?.status === 'AVAILABLE'
        ? (
          count(results.effectiveness.summary?.totalRules) > 0
            ? 'AVAILABLE'
            : 'EMPTY'
        )
        : 'UNAVAILABLE',
      count: count(results.effectiveness?.summary?.totalRules),
      attentionCount: countByTarget(NAVIGATION_TARGETS.effectiveness),
      navigationTarget: NAVIGATION_TARGETS.effectiveness,
    },
    knowledgeHealth: {
      status: results.knowledgeHealth === undefined
        ? 'EMPTY'
        : (
          ['AVAILABLE', 'PARTIAL'].includes(
            results.knowledgeHealth?.status
          )
            ? (
              count(results.knowledgeHealth?.summary?.totalRules) > 0
                ? results.knowledgeHealth.status
                : 'EMPTY'
            )
            : 'UNAVAILABLE'
        ),
      score: safeNumber(results.knowledgeHealth?.score),
      grade: safeText(results.knowledgeHealth?.grade),
      attentionCount: countByTarget(
        NAVIGATION_TARGETS.knowledgeHealth
      ),
      navigationTarget: NAVIGATION_TARGETS.knowledgeHealth,
    },
  };
}

class OwnerLearningCenterService {
  constructor(options = {}) {
    for (const name of [
      'decisionAnalyticsService',
      'candidatesService',
      'candidateLifecycleService',
      'materializedRulesService',
      'ruleEffectivenessService',
    ]) {
      if (!options[name]) {
        throw new TypeError(`${name} обязателен.`);
      }
    }
    this.decisionAnalyticsService = options.decisionAnalyticsService;
    this.candidatesService = options.candidatesService;
    this.candidateLifecycleService = options.candidateLifecycleService;
    this.materializedRulesService = options.materializedRulesService;
    this.ruleEffectivenessService = options.ruleEffectivenessService;
    this.knowledgeHealthService = options.knowledgeHealthService || null;
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date());
  }

  warn(code) {
    if (typeof this.logger?.warn === 'function') {
      try {
        this.logger.warn(`[${code}] Owner Learning Center component unavailable.`);
      } catch {}
    }
  }

  read(code, operation) {
    try {
      return operation();
    } catch (error) {
      if (error?.code === OWNER_LEARNING_CENTER_INVALID_INPUT) throw error;
      this.warn(code);
      return null;
    }
  }

  getOverview(input = {}) {
    const normalized = normalizeInput(input, this.now);
    const filters = normalized.filters;
    const dateFilters = Object.fromEntries(
      ['dateFrom', 'dateTo']
        .filter(name => filters[name])
        .map(name => [name, filters[name]])
    );
    const serviceOptions = {
      asOf: normalized.options.asOf,
      limit: 100,
    };
    const results = {
      decisions: this.read(
        'OWNER_DECISION_ANALYTICS_UNAVAILABLE',
        () => this.decisionAnalyticsService.getAnalytics({
          filters,
          options: { generatedAt: normalized.options.asOf },
        })
      ),
      candidates: this.read(
        'OWNER_LEARNING_CANDIDATES_UNAVAILABLE',
        () => this.candidatesService.getCandidates({
          filters,
          confidenceOptions: { asOf: normalized.options.asOf },
          rankingOptions: { limit: 100 },
        })
      ),
      lifecycle: this.read(
        'OWNER_LEARNING_LIFECYCLE_UNAVAILABLE',
        () => this.candidateLifecycleService.getCandidateStates()
      ),
      rules: this.read(
        'OWNER_MATERIALIZED_RULES_UNAVAILABLE',
        () => {
          const method = typeof this.materializedRulesService
            .getCenterSnapshot === 'function'
            ? 'getCenterSnapshot'
            : 'listRules';
          return this.materializedRulesService[method]({
            filters: dateFilters,
            options: { limit: 100 },
          });
        }
      ),
      effectiveness: this.read(
        'OWNER_RULE_EFFECTIVENESS_UNAVAILABLE',
        () => {
          const method = typeof this.ruleEffectivenessService
            .getCenterSnapshot === 'function'
            ? 'getCenterSnapshot'
            : 'listRuleEffectiveness';
          return this.ruleEffectivenessService[method]({
            filters: dateFilters,
            options: serviceOptions,
          });
        }
      ),
    };
    if (this.knowledgeHealthService) {
      results.knowledgeHealth = this.read(
        'OWNER_KNOWLEDGE_HEALTH_UNAVAILABLE',
        () => this.knowledgeHealthService.getKnowledgeHealth({
          options: {
            asOf: normalized.options.asOf,
            limit: 100,
          },
        })
      );
    }
    const health = buildHealth(results);
    const centerUnavailable =
      health.overallStatus === 'UNAVAILABLE';
    if (centerUnavailable) {
      return {
        status: 'UNAVAILABLE',
        generatedAt: null,
        summary: null,
        attention: { total: 0, items: [] },
        recentActivity: [],
        systemHealth: health,
        sections: sections(results, []),
        warnings: [OWNER_LEARNING_CENTER_UNAVAILABLE],
      };
    }
    const allAttention = [
      ...candidateAttention(results.candidates),
      ...ruleAttention(results.rules, results.effectiveness),
      ...knowledgeHealthAttention(results.knowledgeHealth),
      ...dataQualityAttention(results),
      ...unavailableAttention(health),
    ].sort(compareAttention);
    const recentActivity = [
      ...candidateActivities(results.candidates, results.lifecycle),
      ...ruleActivities(results.rules),
      ...effectivenessActivities(results.effectiveness),
    ].filter(item => item.recordedAt).sort(compareActivity)
      .slice(0, normalized.options.activityLimit);
    const warnings = Object.values(health.components)
      .map(value => value.warning)
      .filter((value, index, values) =>
        value && values.indexOf(value) === index
      );
    return {
      status: warnings.length > 0 ? 'PARTIAL' : 'AVAILABLE',
      generatedAt: normalized.options.asOf,
      summary: summary(results),
      attention: {
        total: allAttention.length,
        items: allAttention.slice(0, normalized.options.attentionLimit),
      },
      recentActivity,
      systemHealth: health,
      sections: sections(results, allAttention),
      warnings,
    };
  }
}

module.exports = {
  MANUAL_REVIEW_CODE,
  NAVIGATION_TARGETS,
  OWNER_LEARNING_CENTER_INVALID_INPUT,
  OWNER_LEARNING_CENTER_UNAVAILABLE,
  OwnerLearningCenterService,
  OwnerLearningCenterServiceError,
  compareActivity,
  compareAttention,
  digestAttention,
  normalizeInput,
};
