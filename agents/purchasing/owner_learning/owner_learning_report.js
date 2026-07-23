const AGENT_RECOMMENDATION_MAP = Object.freeze({
  BUY: 'BUY',
  MUST_BUY: 'BUY',
  RECOMMENDED: 'BUY',
  AUTO_APPROVED: 'BUY',
  SKIP: 'SKIP',
  DO_NOT_BUY: 'SKIP',
  CONFIDENTLY_EXCLUDED: 'SKIP',
  NO_ORDER_ACTION: 'SKIP',
  DEFER: 'DEFER',
  POSTPONE: 'DEFER',
  POSTPONED: 'DEFER',
});
const OWNER_DECISIONS = new Set(['BUY', 'SKIP', 'DEFER']);

function normalizedStatus(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim().toUpperCase();
}

function normalizeAgentRecommendation(value) {
  const status = normalizedStatus(value);
  return status ? AGENT_RECOMMENDATION_MAP[status] || null : null;
}

function normalizeOwnerDecision(value) {
  const status = normalizedStatus(value);
  return status && OWNER_DECISIONS.has(status) ? status : null;
}

function itemId(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Owner Learning itemId должен быть непустой строкой.');
  }
  return value;
}

function indexByItemId(values, valueField) {
  if (!Array.isArray(values)) {
    throw new TypeError('Owner Learning ожидает массив входных данных.');
  }
  const result = new Map();
  for (const value of values) {
    const id = itemId(value?.itemId);
    if (result.has(id)) {
      throw new TypeError(`Owner Learning получил повторный itemId: ${id}.`);
    }
    result.set(id, value?.[valueField] ?? null);
  }
  return result;
}

function percentage(matches, comparable) {
  if (comparable === 0) return null;
  return Math.round((matches / comparable) * 10000) / 100;
}

function buildOwnerLearningReport(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const recommendations = indexByItemId(
    input.recommendations || [],
    'status'
  );
  const ownerDecisions = indexByItemId(
    input.ownerDecisions || [],
    'decision'
  );
  const summary = {
    reportVersion: 'owner-learning-v0.1',
    generatedAt: input.generatedAt || null,
    totalItems: items.length,
    automaticItems: 0,
    reviewRequiredItems: 0,
    ownerDecisionsTotal: 0,
    buyCount: 0,
    skipCount: 0,
    deferCount: 0,
    unresolvedCount: 0,
    matchesAgentRecommendation: 0,
    overridesAgentRecommendation: 0,
    agreementRate: null,
  };

  for (const item of items) {
    const id = itemId(item?.itemId);
    const reviewRequired = item.owner_review_required === true;
    if (reviewRequired) summary.reviewRequiredItems += 1;
    else summary.automaticItems += 1;

    const ownerDecision = normalizeOwnerDecision(ownerDecisions.get(id));
    if (!ownerDecision) {
      if (reviewRequired) summary.unresolvedCount += 1;
      continue;
    }

    summary.ownerDecisionsTotal += 1;
    if (ownerDecision === 'BUY') summary.buyCount += 1;
    else if (ownerDecision === 'SKIP') summary.skipCount += 1;
    else summary.deferCount += 1;

    const agentRecommendation = normalizeAgentRecommendation(
      recommendations.get(id)
    );
    if (!agentRecommendation) continue;
    if (agentRecommendation === ownerDecision) {
      summary.matchesAgentRecommendation += 1;
    } else {
      summary.overridesAgentRecommendation += 1;
    }
  }

  const comparable = summary.matchesAgentRecommendation +
    summary.overridesAgentRecommendation;
  summary.agreementRate = percentage(
    summary.matchesAgentRecommendation,
    comparable
  );
  return summary;
}

function buildOwnerLearningMarkdown(report) {
  const agreement = report.agreementRate === null
    ? 'Недостаточно данных для расчёта'
    : `${report.agreementRate.toFixed(2)}%`;
  return [
    '# Отчёт обучения закупщика',
    '',
    `- Всего товаров: ${report.totalItems}`,
    `- Автоматически обработано: ${report.automaticItems}`,
    `- Требовало проверки: ${report.reviewRequiredItems}`,
    `- Решений принято: ${report.ownerDecisionsTotal}`,
    `- Осталось без решения: ${report.unresolvedCount}`,
    '',
    '## Решения владельца',
    '',
    `- Заказать: ${report.buyCount}`,
    `- Не заказывать: ${report.skipCount}`,
    `- Отложить: ${report.deferCount}`,
    '',
    '## Сравнение с агентом',
    '',
    `- Совпало: ${report.matchesAgentRecommendation}`,
    `- Изменено: ${report.overridesAgentRecommendation}`,
    `- Процент совпадений: ${agreement}`,
    '',
  ].join('\n');
}

function buildOwnerLearningInput(agentJson, ownerReview, matrixDraft) {
  const products = agentJson?.workingOrderProducts ||
    agentJson?.demandProducts ||
    [];
  const reviews = new Map((ownerReview?.items || []).map(item => [
    item.rowIdentity,
    item,
  ]));
  const matrixItems = new Map((matrixDraft?.items || []).map(item => [
    item.rowIdentity,
    item,
  ]));
  return {
    items: products.map(product => {
      const matrixItem = matrixItems.get(product.rowIdentity);
      return {
        itemId: product.rowIdentity,
        sku: matrixItem?.article || product.article || null,
        barcode: matrixItem?.barcode || product.barcode || null,
        rowId: product.rowIdentity,
        name: matrixItem?.name || product.name || null,
        brand: matrixItem?.brand || null,
        owner_review_required:
          reviews.get(product.rowIdentity)?.owner_action_required === true,
      };
    }),
    recommendations: (agentJson?.decisions || []).map(recommendation => ({
      itemId: recommendation.rowIdentity,
      status: recommendation.decision,
    })),
    ownerDecisions: (matrixDraft?.items || []).map(item => ({
      itemId: item.rowIdentity,
      decision: item.owner_order_decision,
    })),
  };
}

module.exports = {
  AGENT_RECOMMENDATION_MAP,
  buildOwnerLearningInput,
  buildOwnerLearningMarkdown,
  buildOwnerLearningReport,
  normalizeAgentRecommendation,
  normalizeOwnerDecision,
};
