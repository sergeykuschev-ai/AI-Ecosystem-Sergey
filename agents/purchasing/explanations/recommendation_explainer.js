const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RECOMMENDATION_EXPLAINER_CONFIG_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/miska-recommendation-explainer-config.json'
);

const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);
const FACT_FIELDS = Object.freeze([
  'free_stock',
  'reserve',
  'in_transit',
  'sales_period',
  'calculated_need',
  'minimum',
  'target',
  'maximum',
  'safety',
  'preliminary_quantity',
  'approved_quantity',
  'working_maximum_quantity',
  'unit_price',
  'line_sum',
  'matrix_role',
  'inventory_review_level',
]);

const REASON_DESCRIPTIONS = Object.freeze({
  STOCK_BELOW_MINIMUM: 'Доступный остаток ниже установленного minimum.',
  STOCK_BELOW_TARGET: 'Доступный остаток ниже целевого запаса.',
  NO_FREE_STOCK: 'Свободный остаток подтверждён и равен нулю.',
  IN_TRANSIT_COVERS_NEED: 'Подтверждённый товар в пути покрывает рассчитанную потребность.',
  SUFFICIENT_FREE_STOCK: 'Свободного остатка достаточно относительно целевого запаса.',
  STRONG_DEMAND: 'Готовое решение содержит подтверждённый сигнал устойчивого спроса.',
  WEAK_DEMAND: 'В готовом результате подтверждён нулевой или слабый спрос.',
  SALES_SPIKE: 'Готовый demand result зафиксировал краткосрочный всплеск продаж.',
  UNKNOWN_STOCK: 'Надёжное значение свободного остатка отсутствует.',
  UNKNOWN_PRICE: 'Закупочная цена отсутствует.',
  MATRIX_CORE: 'Matrix Builder относит товар к роли CORE.',
  MATRIX_OPTIONAL: 'Matrix Builder относит товар к роли OPTIONAL.',
  MATRIX_EXIT: 'Matrix Builder относит товар к кандидатам EXIT.',
  APPROVED_POLICY: 'Для товара действует подтверждённая владельцем policy.',
  PLACEHOLDER_POLICY: 'Текущая policy имеет статус placeholder.',
  OWNER_DECISION_APPLIED: 'Активное решение владельца применено к Owner Review.',
  OWNER_DECISION_CONFLICT: 'Новая рекомендация конфликтует с активным решением владельца.',
  FINANCIAL_LIMIT_APPLIED: 'Финансовая проверка требует ограничения или отдельного согласования.',
  FINANCIAL_APPROVED: 'Финансовый контроллер подтвердил допустимость заказа.',
  MANUAL_REVIEW_REQUIRED: 'Готовое решение требует ручной проверки.',
  ZERO_ORDER_RECOMMENDED: 'Утверждённое количество заказа равно нулю.',
  POSITIVE_ORDER_RECOMMENDED: 'Утверждено положительное количество заказа.',
});

class RecommendationExplainerError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RecommendationExplainerError';
    this.code = code;
  }
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RecommendationExplainerError(
      `${field} должен быть непустой строкой.`,
      'INVALID_EXPLAINER_CONFIG'
    );
  }
  return value.trim();
}

function validateStringArray(value, field) {
  if (!Array.isArray(value) || value.some(item =>
    typeof item !== 'string' || !FACT_FIELDS.includes(item)
  )) {
    throw new RecommendationExplainerError(
      `${field} должен быть массивом поддерживаемых calculation_facts.`,
      'INVALID_EXPLAINER_CONFIG'
    );
  }
  return Array.from(new Set(value));
}

function validateRecommendationExplainerConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RecommendationExplainerError(
      'Конфигурация Recommendation Explainer должна быть объектом.',
      'INVALID_EXPLAINER_CONFIG'
    );
  }
  const confidence = value.confidence_policy;
  if (!confidence || typeof confidence !== 'object' || Array.isArray(confidence)) {
    throw new RecommendationExplainerError(
      'confidence_policy должен быть объектом.',
      'INVALID_EXPLAINER_CONFIG'
    );
  }
  if (typeof confidence.use_decision_confidence_as_ceiling !== 'boolean') {
    throw new RecommendationExplainerError(
      'use_decision_confidence_as_ceiling должен быть boolean.',
      'INVALID_EXPLAINER_CONFIG'
    );
  }
  const lowFields = validateStringArray(
    confidence.low_if_missing_any,
    'confidence_policy.low_if_missing_any'
  );
  const mediumFields = validateStringArray(
    confidence.medium_if_missing_any,
    'confidence_policy.medium_if_missing_any'
  );
  if (mediumFields.some(field => lowFields.includes(field))) {
    throw new RecommendationExplainerError(
      'Поля low_if_missing_any и medium_if_missing_any не должны пересекаться.',
      'INVALID_EXPLAINER_CONFIG'
    );
  }
  return {
    version: nonEmptyString(value.version, 'version'),
    store: nonEmptyString(value.store, 'store'),
    confidence_policy: {
      low_if_missing_any: lowFields,
      medium_if_missing_any: mediumFields,
      use_decision_confidence_as_ceiling:
        confidence.use_decision_confidence_as_ceiling,
    },
  };
}

function loadRecommendationExplainerConfig(
  configPath = DEFAULT_RECOMMENDATION_EXPLAINER_CONFIG_PATH
) {
  const resolvedPath = path.resolve(configPath);
  let source;
  try {
    source = fs.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    throw new RecommendationExplainerError(
      `Не удалось прочитать конфигурацию объяснений «${resolvedPath}»: ${error.message}.`,
      'EXPLAINER_CONFIG_READ_ERROR',
      error
    );
  }
  try {
    return {
      config: validateRecommendationExplainerConfig(JSON.parse(source)),
      configPath: resolvedPath,
    };
  } catch (error) {
    if (error instanceof RecommendationExplainerError) throw error;
    throw new RecommendationExplainerError(
      `Конфигурация объяснений содержит некорректный JSON: ${error.message}.`,
      'EXPLAINER_CONFIG_READ_ERROR',
      error
    );
  }
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstFinite(...values) {
  return values.map(finiteOrNull).find(value => value !== null) ?? null;
}

function salesPeriodFact(product) {
  const sales7 = finiteOrNull(product.sales7);
  const sales14 = finiteOrNull(product.sales14);
  const sales28 = finiteOrNull(product.sales28);
  const dailyRate = finiteOrNull(product.salesDailyRate);
  const confirmed = product.salesStatus === 'confirmed_zero' ||
    [sales7, sales14, sales28, dailyRate].some(value => value !== null);
  if (!confirmed) return null;
  return {
    sales_7_days: sales7,
    sales_14_days: sales14,
    sales_28_days: sales28,
    daily_rate: dailyRate,
    source: product.salesRateSource || product.salesPeriodSource || null,
    status: product.salesStatus || null,
    trend: product.salesTrend || null,
  };
}

function normalizeAgentJson(agentResult) {
  if (Array.isArray(agentResult) && agentResult[0]?.json) return agentResult[0].json;
  if (agentResult?.json) return agentResult.json;
  if (agentResult && typeof agentResult === 'object') return agentResult;
  throw new RecommendationExplainerError(
    'Recommendation Explainer получил некорректный результат Purchasing Agent.',
    'INVALID_AGENT_RESULT'
  );
}

function indexByIdentity(items = []) {
  return new Map(items
    .filter(item => item?.rowIdentity)
    .map(item => [item.rowIdentity, item]));
}

function calculationFacts(product, decision, working, matrixItem) {
  const approvedQuantity = firstFinite(
    decision?.approvedOrderQuantity,
    working?.approvedOrderQuantity
  );
  const unitPrice = firstFinite(product.priceNum, working?.priceNum);
  return {
    free_stock: finiteOrNull(product.freeStock),
    reserve: finiteOrNull(product.reserve),
    in_transit: finiteOrNull(product.inTransitQuantity),
    sales_period: salesPeriodFact(product),
    calculated_need: finiteOrNull(product.demandCalculatedQuantity),
    minimum: finiteOrNull(product.minDisplayStock),
    target: finiteOrNull(product.targetStock),
    maximum: finiteOrNull(product.maximumStock),
    safety: finiteOrNull(product.safetyStock),
    preliminary_quantity: firstFinite(
      product.analyzerCalculatedQuantity,
      working?.analyzerCalculatedQuantity
    ),
    approved_quantity: approvedQuantity,
    working_maximum_quantity: finiteOrNull(working?.provisionalOrderQuantity),
    unit_price: unitPrice,
    line_sum: approvedQuantity === null || unitPrice === null
      ? null
      : finiteOrNull(working?.approvedLineSum),
    matrix_role: matrixItem?.suggested_role || null,
    inventory_review_level: matrixItem?.inventory_value_review_level || null,
  };
}

function sourceFieldLists(facts) {
  const available = [];
  const missing = [];
  FACT_FIELDS.forEach(field => {
    if (facts[field] === null || facts[field] === undefined) missing.push(field);
    else available.push(field);
  });
  return { available, missing };
}

function confidenceLevel(facts, decision, config) {
  const missing = new Set(sourceFieldLists(facts).missing);
  let level = config.confidence_policy.low_if_missing_any
    .some(field => missing.has(field))
    ? 'low'
    : config.confidence_policy.medium_if_missing_any
      .some(field => missing.has(field))
      ? 'medium'
      : 'high';
  if (
    config.confidence_policy.use_decision_confidence_as_ceiling &&
    CONFIDENCE_LEVELS.includes(decision?.confidence)
  ) {
    const currentRank = CONFIDENCE_LEVELS.indexOf(level);
    const decisionRank = CONFIDENCE_LEVELS.indexOf(decision.confidence);
    level = CONFIDENCE_LEVELS[Math.max(currentRank, decisionRank)];
  }
  return level;
}

function reasonCollector() {
  const reasons = new Map();
  return {
    add(code, condition, evidenceFields = []) {
      if (!condition || reasons.has(code)) return;
      reasons.set(code, {
        code,
        description: REASON_DESCRIPTIONS[code],
        evidence_fields: evidenceFields,
      });
    },
    values() {
      return Array.from(reasons.values());
    },
  };
}

function financialInfluence(assessment = {}) {
  return {
    status: assessment.status || null,
    advisory_only: assessment.advisory_only === true,
    financially_permitted: typeof assessment.financially_permitted === 'boolean'
      ? assessment.financially_permitted
      : null,
    order_composition_changed: assessment.order_composition_changed === true,
    safe_budget_excess: finiteOrNull(assessment.safe_budget_excess),
    recommendation: assessment.recommendation || null,
  };
}

function ownerInfluence(matrixItem) {
  return {
    status: matrixItem?.owner_decision_status || 'none',
    applied: matrixItem?.owner_decision_applied === true,
    conflict: matrixItem?.owner_decision_conflict === true,
    summary: matrixItem?.owner_decision_summary || null,
  };
}

function matrixInfluence(matrixItem) {
  if (!matrixItem) return null;
  return {
    role: matrixItem.suggested_role || null,
    priority: matrixItem.suggested_priority || null,
    policy_status: matrixItem.existing_policy?.policy_status || null,
    inventory_review_level: matrixItem.inventory_value_review_level || null,
    draft_policy: {
      minimum: finiteOrNull(matrixItem.suggested_minimum_shelf_stock),
      target: finiteOrNull(matrixItem.suggested_target_stock),
      maximum: finiteOrNull(matrixItem.suggested_maximum_stock),
      safety: finiteOrNull(matrixItem.suggested_safety_stock),
      allow_zero_stock: typeof matrixItem.suggested_allow_zero_stock === 'boolean'
        ? matrixItem.suggested_allow_zero_stock
        : null,
    },
  };
}

function financialLimitDetected(assessment = {}) {
  return assessment.financially_permitted === false ||
    (typeof assessment.safe_budget_excess === 'number' &&
      assessment.safe_budget_excess > 0) ||
    ['MANUAL_APPROVAL_REQUIRED', 'REJECTED'].includes(assessment.status);
}

function finalRecommendation(decision, quantity, matrixRole) {
  if (decision?.decision === 'manual_review') return 'MANUAL_REVIEW';
  if (quantity !== null && quantity > 0) return 'ORDER';
  if (matrixRole === 'EXIT') return 'EXIT';
  if (['CORE', 'OPTIONAL'].includes(matrixRole)) return 'KEEP_IN_MATRIX';
  return 'DO_NOT_ORDER';
}

function explanationSummary({
  finalRecommendationCode,
  quantity,
  facts,
  reasons,
  owner,
  financial,
}) {
  const codes = new Set(reasons.map(reason => reason.code));
  if (owner.conflict) {
    return 'Требуется пересмотреть решение владельца: новая рекомендация содержит сильный конфликт.';
  }
  if (finalRecommendationCode === 'MANUAL_REVIEW') {
    const missing = [];
    if (facts.free_stock === null) missing.push('остаток');
    if (facts.unit_price === null) missing.push('цена');
    if (facts.sales_period === null) missing.push('история продаж');
    return missing.length > 0
      ? `Требуется ручная проверка: отсутствуют надёжные данные — ${missing.join(', ')}.`
      : 'Требуется ручная проверка согласно готовому решению Purchasing Agent.';
  }
  if (finalRecommendationCode === 'ORDER') {
    const details = [];
    if (
      facts.free_stock !== null &&
      facts.minimum !== null &&
      facts.free_stock < facts.minimum
    ) {
      details.push(
        `свободный остаток ${facts.free_stock} шт. ниже minimum ${facts.minimum} шт.`
      );
    } else if (
      facts.free_stock !== null &&
      facts.target !== null &&
      facts.free_stock < facts.target
    ) {
      details.push(
        `свободный остаток ${facts.free_stock} шт. ниже target ${facts.target} шт.`
      );
    } else if (facts.preliminary_quantity !== null) {
      details.push(`готовый предварительный расчёт ${facts.preliminary_quantity} шт.`);
    }
    if (facts.in_transit !== null) details.push(`в пути ${facts.in_transit} шт.`);
    const financeText = financialLimitDetected(financial)
      ? ' Требуется отдельное финансовое согласование.'
      : '';
    return `Рекомендуется заказать ${quantity} шт.${details.length > 0
      ? `: ${details.join(', ')}`
      : ''}.${financeText}`.replace('..', '.');
  }
  if (finalRecommendationCode === 'EXIT') {
    return 'Товар предложен к EXIT готовым результатом Matrix Builder; положительный заказ не утверждён.';
  }
  if (codes.has('IN_TRANSIT_COVERS_NEED')) {
    return `Заказ не рекомендуется: товар в пути (${facts.in_transit} шт.) покрывает рассчитанную потребность.`;
  }
  if (codes.has('WEAK_DEMAND')) {
    return 'Заказ не рекомендуется: в готовом результате подтверждён нулевой или слабый спрос.';
  }
  if (codes.has('SUFFICIENT_FREE_STOCK')) {
    return `Заказ не рекомендуется: свободный остаток ${facts.free_stock} шт. не ниже целевого запаса ${facts.target} шт.`;
  }
  if (finalRecommendationCode === 'KEEP_IN_MATRIX') {
    return `Заказ не рекомендуется; товар остаётся в матрице с ролью ${facts.matrix_role}.`;
  }
  return 'Заказ не рекомендуется: утверждённое количество равно нулю.';
}

function explainItem({ product, decision, phase1Decision, working, matrixItem, assessment, config }) {
  const facts = calculationFacts(product, decision, working, matrixItem);
  const owner = ownerInfluence(matrixItem);
  const financial = financialInfluence(assessment);
  const quantity = facts.approved_quantity;
  const collector = reasonCollector();
  const existingPolicyStatus = matrixItem?.existing_policy?.policy_status;
  const decisionReasons = [
    ...(decision?.reasons || []),
    ...(phase1Decision?.reasons || []),
  ];
  const matrixRole = facts.matrix_role;
  const availableStock = finiteOrNull(product.availableStock);

  collector.add(
    'STOCK_BELOW_MINIMUM',
    availableStock !== null && facts.minimum !== null && availableStock < facts.minimum,
    ['free_stock', 'in_transit', 'minimum']
  );
  collector.add(
    'STOCK_BELOW_TARGET',
    availableStock !== null && facts.target !== null && availableStock < facts.target,
    ['free_stock', 'in_transit', 'target']
  );
  collector.add('NO_FREE_STOCK', facts.free_stock === 0, ['free_stock']);
  collector.add(
    'IN_TRANSIT_COVERS_NEED',
    facts.in_transit !== null && facts.in_transit > 0 &&
      finiteOrNull(product.analyzerCalculatedQuantity) > 0 &&
      finiteOrNull(product.finalRecommendedQuantity) === 0,
    ['in_transit', 'preliminary_quantity', 'calculated_need']
  );
  collector.add(
    'SUFFICIENT_FREE_STOCK',
    facts.free_stock !== null && facts.target !== null && facts.free_stock >= facts.target,
    ['free_stock', 'target']
  );
  collector.add(
    'STRONG_DEMAND',
    decisionReasons.some(reason =>
      reason.startsWith('valid_demand_with_abc_xyz_priority:') ||
      reason.startsWith('consistent_sales_with_abc_xyz:')
    ),
    ['sales_period']
  );
  collector.add(
    'WEAK_DEMAND',
    product.salesStatus === 'confirmed_zero' ||
      decisionReasons.includes('confirmed_zero_sales_without_mandatory_gap'),
    ['sales_period']
  );
  collector.add(
    'SALES_SPIKE',
    product.salesTrend === 'spike' ||
      (product.warnings || []).includes('short_term_sales_spike') ||
      (decision?.warnings || []).includes('short_term_sales_spike'),
    ['sales_period']
  );
  collector.add('UNKNOWN_STOCK', facts.free_stock === null, ['free_stock']);
  collector.add('UNKNOWN_PRICE', facts.unit_price === null, ['unit_price']);
  collector.add('MATRIX_CORE', matrixRole === 'CORE', ['matrix_role']);
  collector.add('MATRIX_OPTIONAL', matrixRole === 'OPTIONAL', ['matrix_role']);
  collector.add('MATRIX_EXIT', matrixRole === 'EXIT', ['matrix_role']);
  collector.add('APPROVED_POLICY', existingPolicyStatus === 'approved', ['matrix_role']);
  collector.add('PLACEHOLDER_POLICY', existingPolicyStatus === 'placeholder', ['matrix_role']);
  collector.add('OWNER_DECISION_APPLIED', owner.applied, ['matrix_role']);
  collector.add('OWNER_DECISION_CONFLICT', owner.conflict, ['matrix_role']);
  collector.add(
    'FINANCIAL_LIMIT_APPLIED',
    financialLimitDetected(assessment),
    ['approved_quantity', 'line_sum']
  );
  collector.add(
    'FINANCIAL_APPROVED',
    assessment?.status === 'APPROVED' && assessment.financially_permitted === true,
    ['approved_quantity', 'line_sum']
  );
  collector.add(
    'MANUAL_REVIEW_REQUIRED',
    decision?.decision === 'manual_review',
    ['approved_quantity']
  );
  collector.add('ZERO_ORDER_RECOMMENDED', quantity === 0, ['approved_quantity']);
  collector.add('POSITIVE_ORDER_RECOMMENDED', quantity !== null && quantity > 0, [
    'approved_quantity', 'line_sum',
  ]);

  const reasons = collector.values();
  const recommendation = finalRecommendation(decision, quantity, matrixRole);
  const fields = sourceFieldLists(facts);
  return {
    sku: product.article || product.barcode || product.internalProductId || product.rowIdentity,
    product_name: product.name || null,
    final_recommendation: recommendation,
    recommended_quantity: quantity,
    recommendation_status: decision?.decision || 'unavailable',
    explanation_summary: explanationSummary({
      finalRecommendationCode: recommendation,
      quantity,
      facts,
      reasons,
      owner,
      financial: assessment,
    }),
    explanation_reasons: reasons,
    calculation_facts: facts,
    risk_flags: reasons
      .map(reason => reason.code)
      .filter(code => [
        'SALES_SPIKE', 'UNKNOWN_STOCK', 'UNKNOWN_PRICE', 'MATRIX_EXIT',
        'OWNER_DECISION_CONFLICT', 'FINANCIAL_LIMIT_APPLIED',
        'MANUAL_REVIEW_REQUIRED',
      ].includes(code)),
    confidence_level: confidenceLevel(facts, decision, config),
    owner_decision_influence: owner,
    financial_controller_influence: financial,
    matrix_role_influence: matrixInfluence(matrixItem),
    source_fields_available: fields.available,
    source_fields_missing: fields.missing,
    explanation_version: config.version,
  };
}

function buildRecommendationExplanations(agentResult, options = {}) {
  const agentJson = normalizeAgentJson(agentResult);
  const loaded = options.config
    ? { config: validateRecommendationExplainerConfig(options.config), configPath: null }
    : loadRecommendationExplainerConfig(options.configPath);
  const products = Array.isArray(agentJson.demandProducts) && agentJson.demandProducts.length > 0
    ? agentJson.demandProducts
    : agentJson.workingOrderProducts || [];
  if (
    Number.isInteger(agentJson.product_rows_count) &&
    products.length !== agentJson.product_rows_count
  ) {
    throw new RecommendationExplainerError(
      `Количество объясняемых SKU (${products.length}) не совпадает с ` +
        `product_rows_count (${agentJson.product_rows_count}).`,
      'EXPLANATION_PRODUCT_COUNT_MISMATCH'
    );
  }
  const decisions = indexByIdentity(agentJson.decisions);
  const phase1Decisions = indexByIdentity(agentJson.phase1Decisions);
  const working = indexByIdentity(agentJson.workingOrderProducts);
  const matrixItems = indexByIdentity(options.matrixDraft?.items);
  const items = products.map(product => explainItem({
    product,
    decision: decisions.get(product.rowIdentity),
    phase1Decision: phase1Decisions.get(product.rowIdentity),
    working: working.get(product.rowIdentity),
    matrixItem: matrixItems.get(product.rowIdentity),
    assessment: agentJson.financial_assessment || {},
    config: loaded.config,
  }));
  const count = predicate => items.filter(predicate).length;
  return {
    version: 1,
    explanation_version: loaded.config.version,
    source_product_count: agentJson.product_rows_count ?? products.length,
    explained_sku_count: items.length,
    summary: {
      confidence: Object.fromEntries(CONFIDENCE_LEVELS.map(level => [
        level,
        count(item => item.confidence_level === level),
      ])),
      positive_order: count(item => item.recommended_quantity > 0),
      zero_order: count(item => item.recommended_quantity === 0),
      manual_review: count(item => item.recommendation_status === 'manual_review'),
      exit: count(item => item.calculation_facts.matrix_role === 'EXIT'),
      owner_decision_applied: count(item => item.owner_decision_influence.applied),
      owner_decision_conflicts: count(item => item.owner_decision_influence.conflict),
    },
    financial_controller: financialInfluence(agentJson.financial_assessment || {}),
    items,
  };
}

function markdown(value) {
  if (value === null || value === undefined || value === '') return 'нет данных';
  return String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function table(headers, rows) {
  const result = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];
  if (rows.length === 0) rows = [['—', ...headers.slice(1).map(() => '')]];
  rows.forEach(row => result.push(`| ${row.map(markdown).join(' | ')} |`));
  return result;
}

function factsText(facts) {
  const pairs = [
    ['остаток', facts.free_stock],
    ['в пути', facts.in_transit],
    ['need', facts.calculated_need],
    ['min', facts.minimum],
    ['target', facts.target],
    ['max', facts.maximum],
    ['цена', facts.unit_price],
    ['сумма', facts.line_sum],
    ['роль', facts.matrix_role],
  ].filter(([, value]) => value !== null && value !== undefined);
  return pairs.length > 0
    ? pairs.map(([label, value]) => `${label}: ${value}`).join('; ')
    : 'нет доступных расчётных фактов';
}

function reportRows(items) {
  return items.map(item => [
    item.sku,
    item.product_name,
    item.recommended_quantity,
    item.explanation_summary,
    factsText(item.calculation_facts),
    item.risk_flags.join(', ') || 'нет',
    item.confidence_level,
  ]);
}

function buildRecommendationExplanationsReport(explanations) {
  const sections = [
    ['## 2. ✅ Recommended to Order', explanations.items.filter(item =>
      item.final_recommendation === 'ORDER'
    )],
    ['## 3. ➖ Not Recommended to Order', explanations.items.filter(item =>
      ['DO_NOT_ORDER', 'KEEP_IN_MATRIX', 'EXIT'].includes(item.final_recommendation) &&
      item.recommendation_status !== 'manual_review'
    )],
    ['## 4. ⚠️ Manual Review Required', explanations.items.filter(item =>
      item.recommendation_status === 'manual_review'
    )],
    ['## 5. 🚪 EXIT Explanations', explanations.items.filter(item =>
      item.calculation_facts.matrix_role === 'EXIT'
    )],
    ['## 6. 🔎 Low Confidence Explanations', explanations.items.filter(item =>
      item.confidence_level === 'low'
    )],
    ['## 7. 🧠 Owner Decisions Influence', explanations.items.filter(item =>
      item.owner_decision_influence.applied || item.owner_decision_influence.conflict
    )],
    ['## 8. 💰 Financial Controller Influence', explanations.items.filter(item =>
      item.recommended_quantity > 0 ||
      item.risk_flags.includes('FINANCIAL_LIMIT_APPLIED')
    )],
  ];
  const lines = [
    '# Recommendation Explanations — Purchasing Agent v0.6',
    '',
    '> Presentation/audit layer: объясняет готовые решения и не меняет количество, роль или финансовый статус.',
    '',
    '## 1. 📊 Executive Summary',
    '',
    ...table(['Показатель', 'Количество'], [
      ['Объяснено SKU', explanations.explained_sku_count],
      ['Positive order', explanations.summary.positive_order],
      ['Zero order', explanations.summary.zero_order],
      ['Manual review', explanations.summary.manual_review],
      ['EXIT', explanations.summary.exit],
      ['High confidence', explanations.summary.confidence.high],
      ['Medium confidence', explanations.summary.confidence.medium],
      ['Low confidence', explanations.summary.confidence.low],
      ['Owner decisions applied', explanations.summary.owner_decision_applied],
      ['Owner decision conflicts', explanations.summary.owner_decision_conflicts],
    ]),
    '',
    `**Financial Controller:** ${markdown(explanations.financial_controller.status)} — ` +
      `${markdown(explanations.financial_controller.recommendation)}`,
    '',
  ];
  sections.forEach(([heading, items]) => {
    lines.push(
      '---',
      '',
      heading,
      '',
      `Позиций: **${items.length}**.`,
      '',
      ...table(
        ['SKU', 'Товар', 'Количество', 'Объяснение', 'Ключевые факты', 'Риски', 'Confidence'],
        reportRows(items)
      ),
      ''
    );
  });
  return `${lines.join('\n').trimEnd()}\n`;
}

module.exports = {
  DEFAULT_RECOMMENDATION_EXPLAINER_CONFIG_PATH,
  CONFIDENCE_LEVELS,
  FACT_FIELDS,
  REASON_DESCRIPTIONS,
  RecommendationExplainerError,
  validateRecommendationExplainerConfig,
  loadRecommendationExplainerConfig,
  buildRecommendationExplanations,
  buildRecommendationExplanationsReport,
};
