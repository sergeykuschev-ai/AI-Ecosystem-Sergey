const {
  buildStableItemKey,
  stableKeyContext,
} = require('./owner_learning_history');
const {
  normalizeAgentRecommendation,
} = require('./owner_learning_report');

const REPORT_VERSION = 'approved-rule-preview-v0.5';
const APPROVED_RULES_SCHEMA_VERSION = 'owner-approved-rules-v0.4';
const PREVIEW_WARNING =
  'Это только предварительный просмотр. Утверждённые правила ещё не ' +
  'изменяют заказ, количество или рекомендацию агента.';
const SUPPORTED_DECISIONS = new Set(['BUY', 'SKIP', 'DEFER']);
const DECISION_LABELS = Object.freeze({
  BUY: 'Заказать',
  SKIP: 'Не заказывать',
  DEFER: 'Отложить',
  UNKNOWN: 'Не определено',
});

function optionalString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function upperString(value) {
  return optionalString(value)?.toUpperCase() || null;
}

function agentJsonFromResult(agentResult) {
  const agentJson = Array.isArray(agentResult)
    ? agentResult[0]?.json
    : agentResult?.json || agentResult;
  if (!agentJson || typeof agentJson !== 'object') {
    throw new TypeError(
      'Approved Rule Preview требует результат Purchasing Agent.'
    );
  }
  return agentJson;
}

function productRows(agentJson) {
  if (Array.isArray(agentJson.workingOrderProducts)) {
    return agentJson.workingOrderProducts;
  }
  return Array.isArray(agentJson.demandProducts)
    ? agentJson.demandProducts
    : [];
}

function itemForStableKey(product) {
  return {
    sku: product.article || product.sku || null,
    barcode: product.barcode || product.matchingHints?.barcode || null,
    rowId: product.rowIdentity || product.rowId || null,
    itemId: product.rowIdentity || product.rowId || null,
    name: product.name || null,
    brand: product.brand || null,
  };
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function currentQuantity(product, decision) {
  const candidates = [
    decision?.approvedOrderQuantity,
    decision?.calculatedOrderQuantity,
    product.approvedOrderQuantity,
    product.provisionalOrderQuantity,
    product.finalRecommendedQuantity,
    product.analyzerCalculatedQuantity,
  ];
  return candidates.find(finiteNumber) ?? null;
}

function indexCurrentItems(agentResult) {
  const agentJson = agentJsonFromResult(agentResult);
  const products = productRows(agentJson);
  const decisions = new Map(
    (Array.isArray(agentJson.decisions) ? agentJson.decisions : [])
      .map(decision => [decision.rowIdentity, decision])
  );
  const stableItems = products.map(itemForStableKey);
  const context = stableKeyContext(stableItems);
  const items = new Map();
  products.forEach((product, index) => {
    const identity = product.rowIdentity || product.rowId;
    const decision = decisions.get(identity);
    const stableItemKey = buildStableItemKey(stableItems[index], context);
    if (items.has(stableItemKey)) {
      throw new TypeError(
        `Approved Rule Preview получил повторный stableItemKey: ${
          stableItemKey
        }.`
      );
    }
    items.set(stableItemKey, {
      stableItemKey,
      name: optionalString(product.name),
      brand: optionalString(product.brand),
      currentAgentDecision:
        normalizeAgentRecommendation(decision?.decision) || 'UNKNOWN',
      currentQuantity: currentQuantity(product, decision),
    });
  });
  return items;
}

function validActiveRule(rule) {
  return Boolean(
    rule &&
    typeof rule === 'object' &&
    optionalString(rule.ruleId) &&
    optionalString(rule.proposalId) &&
    optionalString(rule.stableItemKey) &&
    optionalString(rule.name) &&
    upperString(rule.ruleType) === 'ITEM_DECISION' &&
    SUPPORTED_DECISIONS.has(upperString(rule.approvedDecision))
  );
}

function groupActiveRules(approvedRules) {
  const groups = new Map();
  let activeRulesCount = 0;
  let ignoredInactiveRulesCount = 0;
  let ignoredInvalidRulesCount = 0;
  const rules = Array.isArray(approvedRules?.rules)
    ? approvedRules.rules
    : [];

  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') {
      ignoredInvalidRulesCount += 1;
      continue;
    }
    if (upperString(rule.status) !== 'ACTIVE') {
      ignoredInactiveRulesCount += 1;
      continue;
    }
    activeRulesCount += 1;
    if (!validActiveRule(rule)) {
      ignoredInvalidRulesCount += 1;
      continue;
    }
    const stableItemKey = rule.stableItemKey.trim();
    if (!groups.has(stableItemKey)) groups.set(stableItemKey, []);
    groups.get(stableItemKey).push({
      ruleId: rule.ruleId.trim(),
      proposalId: rule.proposalId.trim(),
      stableItemKey,
      name: rule.name.trim(),
      brand: optionalString(rule.brand),
      ruleType: 'ITEM_DECISION',
      approvedDecision: rule.approvedDecision.trim().toUpperCase(),
    });
  }
  return {
    groups,
    activeRulesCount,
    ignoredInactiveRulesCount,
    ignoredInvalidRulesCount,
  };
}

function sortedRules(rules) {
  return [...rules].sort((left, right) =>
    left.ruleId.localeCompare(right.ruleId)
  );
}

function conflictFromRules(stableItemKey, rules) {
  const byDecision = new Map();
  for (const rule of sortedRules(rules)) {
    if (!byDecision.has(rule.approvedDecision)) {
      byDecision.set(rule.approvedDecision, []);
    }
    byDecision.get(rule.approvedDecision).push(rule.ruleId);
  }
  const first = sortedRules(rules)[0];
  return {
    stableItemKey,
    name: first.name,
    brand: first.brand,
    approvedDecisions: Array.from(byDecision.keys()).sort(),
    ruleIds: sortedRules(rules).map(rule => rule.ruleId),
    decisions: Array.from(byDecision.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([approvedDecision, ruleIds]) => ({
        approvedDecision,
        ruleIds,
      })),
    reason: 'CONFLICTING_ACTIVE_RULES',
  };
}

function effectFor(currentAgentDecision, approvedDecision) {
  if (currentAgentDecision === 'UNKNOWN') {
    return {
      effect: 'UNSUPPORTED',
      wouldChangeDecision: false,
      reason: 'CURRENT_AGENT_DECISION_UNKNOWN',
    };
  }
  if (currentAgentDecision === approvedDecision) {
    return {
      effect: 'NO_CHANGE',
      wouldChangeDecision: false,
      reason: 'APPROVED_RULE_MATCHES_AGENT_DECISION',
    };
  }
  return {
    effect: 'OVERRIDE',
    wouldChangeDecision: true,
    reason: 'APPROVED_RULE_WOULD_OVERRIDE_AGENT_DECISION',
  };
}

function logicalRule(rules) {
  const ordered = sortedRules(rules);
  return {
    primary: ordered[0],
    duplicateRuleIds: ordered.slice(1).map(rule => rule.ruleId),
  };
}

function buildApprovedRulePreview({
  agentResult,
  approvedRules,
  generatedAt,
} = {}) {
  const currentItems = indexCurrentItems(agentResult);
  const grouped = groupActiveRules(approvedRules);
  const matches = [];
  const unmatchedRules = [];
  const conflicts = [];

  const groupEntries = Array.from(grouped.groups.entries())
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [stableItemKey, rules] of groupEntries) {
    const decisions = new Set(rules.map(rule => rule.approvedDecision));
    if (decisions.size > 1) {
      conflicts.push(conflictFromRules(stableItemKey, rules));
      continue;
    }
    const { primary, duplicateRuleIds } = logicalRule(rules);
    const currentItem = currentItems.get(stableItemKey);
    if (!currentItem) {
      unmatchedRules.push({
        ruleId: primary.ruleId,
        proposalId: primary.proposalId,
        stableItemKey,
        name: primary.name,
        brand: primary.brand,
        approvedDecision: primary.approvedDecision,
        duplicateRuleIds,
        reason: 'ITEM_NOT_FOUND_IN_CURRENT_RUN',
      });
      continue;
    }
    const effect = effectFor(
      currentItem.currentAgentDecision,
      primary.approvedDecision
    );
    matches.push({
      ruleId: primary.ruleId,
      proposalId: primary.proposalId,
      stableItemKey,
      name: primary.name,
      brand: primary.brand,
      currentAgentDecision: currentItem.currentAgentDecision,
      approvedDecision: primary.approvedDecision,
      wouldChangeDecision: effect.wouldChangeDecision,
      currentQuantity: currentItem.currentQuantity,
      previewQuantity: null,
      effect: effect.effect,
      reason: effect.reason,
      duplicateRuleIds,
    });
  }

  return {
    reportVersion: REPORT_VERSION,
    generatedAt: optionalString(generatedAt),
    approvedRulesSchemaVersion:
      optionalString(approvedRules?.schemaVersion) ||
      APPROVED_RULES_SCHEMA_VERSION,
    activeRulesCount: grouped.activeRulesCount,
    matchedRulesCount: matches.length,
    unmatchedRulesCount: unmatchedRules.length,
    conflictingRulesCount: conflicts.length,
    wouldChangeDecisionCount: matches.filter(
      match => match.effect === 'OVERRIDE'
    ).length,
    wouldKeepDecisionCount: matches.filter(
      match => match.effect === 'NO_CHANGE'
    ).length,
    ignoredInactiveRulesCount: grouped.ignoredInactiveRulesCount,
    ignoredInvalidRulesCount: grouped.ignoredInvalidRulesCount,
    matches,
    unmatchedRules,
    conflicts,
  };
}

function matchLines(match) {
  return [
    `### ${match.name}`,
    '',
    `- Бренд: ${match.brand || 'не указан'}`,
    `- Текущее решение агента: ${
      DECISION_LABELS[match.currentAgentDecision]
    } (${match.currentAgentDecision})`,
    `- Утверждённое решение владельца: ${
      DECISION_LABELS[match.approvedDecision]
    } (${match.approvedDecision})`,
    `- ruleId: ${match.ruleId}`,
    `- Объяснение: ${match.reason}`,
    '',
  ];
}

function buildApprovedRulePreviewMarkdown(report) {
  const lines = [
    '# Предварительный просмотр утверждённых правил',
    '',
    `- Активных правил: ${report.activeRulesCount}`,
    `- Совпало с товарами запуска: ${report.matchedRulesCount}`,
    `- Не найдено в текущем запуске: ${report.unmatchedRulesCount}`,
    `- Конфликтующих правил: ${report.conflictingRulesCount}`,
    `- Изменили бы решение агента: ${report.wouldChangeDecisionCount}`,
    `- Оставили бы решение без изменения: ${report.wouldKeepDecisionCount}`,
    `- Неактивных правил проигнорировано: ${
      report.ignoredInactiveRulesCount
    }`,
    `- Некорректных правил проигнорировано: ${
      report.ignoredInvalidRulesCount
    }`,
    '',
    PREVIEW_WARNING,
    '',
  ];
  if (report.activeRulesCount === 0) {
    lines.push(
      'Пока нет активных утверждённых правил для предварительного просмотра.',
      ''
    );
  }
  const sections = [
    [
      '## Правила, которые изменили бы решение',
      report.matches.filter(match => match.effect === 'OVERRIDE'),
      matchLines,
    ],
    [
      '## Правила без изменения',
      report.matches.filter(match => match.effect !== 'OVERRIDE'),
      matchLines,
    ],
    [
      '## Конфликты',
      report.conflicts,
      conflict => [
        `### ${conflict.name}`,
        '',
        `- stableItemKey: ${conflict.stableItemKey}`,
        `- Решения: ${conflict.approvedDecisions.join(', ')}`,
        `- ruleId: ${conflict.ruleIds.join(', ')}`,
        `- Объяснение: ${conflict.reason}`,
        '',
      ],
    ],
    [
      '## Не найдено в текущем запуске',
      report.unmatchedRules,
      rule => [
        `### ${rule.name}`,
        '',
        `- Бренд: ${rule.brand || 'не указан'}`,
        `- Решение: ${DECISION_LABELS[rule.approvedDecision]} (${
          rule.approvedDecision
        })`,
        `- ruleId: ${rule.ruleId}`,
        `- Объяснение: ${rule.reason}`,
        '',
      ],
    ],
  ];
  for (const [title, items, renderer] of sections) {
    lines.push(title, '');
    if (items.length === 0) {
      lines.push('Нет.', '');
      continue;
    }
    items.forEach(item => lines.push(...renderer(item)));
  }
  return lines.join('\n');
}

function unavailableApprovedRulePreview(generatedAt, errorCode) {
  return {
    reportVersion: REPORT_VERSION,
    generatedAt: optionalString(generatedAt),
    approvedRulesSchemaVersion: APPROVED_RULES_SCHEMA_VERSION,
    status: 'unavailable',
    errorCode: optionalString(errorCode) || 'APPROVED_RULE_PREVIEW_UNAVAILABLE',
    activeRulesCount: null,
    matchedRulesCount: null,
    unmatchedRulesCount: null,
    conflictingRulesCount: null,
    wouldChangeDecisionCount: null,
    wouldKeepDecisionCount: null,
    ignoredInactiveRulesCount: null,
    ignoredInvalidRulesCount: null,
    matches: [],
    unmatchedRules: [],
    conflicts: [],
  };
}

function unavailableApprovedRulePreviewMarkdown() {
  return [
    '# Предварительный просмотр утверждённых правил',
    '',
    PREVIEW_WARNING,
    '',
    'Предварительный просмотр временно недоступен. Основной расчёт заказа ' +
      'завершён без применения правил.',
    '',
  ].join('\n');
}

module.exports = {
  APPROVED_RULES_SCHEMA_VERSION,
  PREVIEW_WARNING,
  REPORT_VERSION,
  buildApprovedRulePreview,
  buildApprovedRulePreviewMarkdown,
  unavailableApprovedRulePreview,
  unavailableApprovedRulePreviewMarkdown,
};
