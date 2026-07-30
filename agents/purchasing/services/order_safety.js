const ORDER_SAFETY_CODES = Object.freeze({
  MANDATORY_ASSORTMENT_BELOW_FLOOR: 'MANDATORY_ASSORTMENT_BELOW_FLOOR',
  HIGH_STOCK_ORDER_WARNING: 'HIGH_STOCK_ORDER_WARNING',
  FREE_STOCK_NOT_BELOW_MIN: 'FREE_STOCK_NOT_BELOW_MIN',
  ARTICLE_REQUIRED: 'ARTICLE_REQUIRED',
  ARTICLE_NOT_FOUND: 'ARTICLE_NOT_FOUND',
  AMBIGUOUS_ARTICLE_MATCH: 'AMBIGUOUS_ARTICLE_MATCH',
  DUPLICATE_ARTICLE: 'DUPLICATE_ARTICLE',
  PACKAGING_MISMATCH: 'PACKAGING_MISMATCH',
});

const BLOCKING_ORDER_SAFETY_CODES = Object.freeze([
  ORDER_SAFETY_CODES.HIGH_STOCK_ORDER_WARNING,
  ORDER_SAFETY_CODES.FREE_STOCK_NOT_BELOW_MIN,
  ORDER_SAFETY_CODES.ARTICLE_REQUIRED,
  ORDER_SAFETY_CODES.ARTICLE_NOT_FOUND,
  ORDER_SAFETY_CODES.AMBIGUOUS_ARTICLE_MATCH,
  ORDER_SAFETY_CODES.DUPLICATE_ARTICLE,
  ORDER_SAFETY_CODES.PACKAGING_MISMATCH,
]);

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function effectiveStockBoundary(manualValue, automaticValue) {
  if (finiteNonNegative(manualValue)) {
    return { value: manualValue, source: 'manual' };
  }
  if (finiteNonNegative(automaticValue)) {
    return { value: automaticValue, source: 'automatic' };
  }
  return { value: null, source: null };
}

function effectiveMin(row = {}) {
  const resolved = effectiveStockBoundary(row.manualMin, row.autoMin);
  if (resolved.value !== null) return resolved;
  return finiteNonNegative(row.min)
    ? { value: row.min, source: 'legacy_min' }
    : resolved;
}

function effectiveMax(row = {}) {
  const resolved = effectiveStockBoundary(row.manualMax, row.autoMax);
  if (resolved.value !== null) return resolved;
  return finiteNonNegative(row.max)
    ? { value: row.max, source: 'legacy_max' }
    : resolved;
}

function normalizeArticle(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, '').toUpperCase();
}

function roundPackageValue(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function extractPackaging(value) {
  const text = String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/,/g, '.');
  const matches = text.matchAll(
    /(\d+(?:\.\d+)?)\s*(кг|г|мл|л|шт)\.?/gu
  );
  const values = [];

  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount)) continue;
    if (unit === 'кг') {
      values.push({ dimension: 'mass', value: roundPackageValue(amount * 1000), unit: 'g' });
    } else if (unit === 'г') {
      values.push({ dimension: 'mass', value: roundPackageValue(amount), unit: 'g' });
    } else if (unit === 'л') {
      values.push({ dimension: 'volume', value: roundPackageValue(amount * 1000), unit: 'ml' });
    } else if (unit === 'мл') {
      values.push({ dimension: 'volume', value: roundPackageValue(amount), unit: 'ml' });
    } else {
      values.push({ dimension: 'count', value: roundPackageValue(amount), unit: 'unit' });
    }
  }

  return values
    .filter((item, index, items) =>
      items.findIndex(candidate =>
        candidate.dimension === item.dimension &&
        candidate.value === item.value &&
        candidate.unit === item.unit
      ) === index
    )
    .sort((left, right) =>
      left.dimension.localeCompare(right.dimension) ||
      left.value - right.value
    );
}

function packagingMismatch(leftName, rightName) {
  const left = extractPackaging(leftName);
  const right = extractPackaging(rightName);
  if (left.length === 0 || right.length === 0) return false;
  return JSON.stringify(left) !== JSON.stringify(right);
}

function isAutomaticallyApproved(decision) {
  return (
    ['must_buy', 'recommended'].includes(decision?.decision) &&
    typeof decision.approvedOrderQuantity === 'number' &&
    decision.approvedOrderQuantity > 0
  );
}

function withReasons(decision, reasons, changes = {}) {
  return {
    ...decision,
    ...changes,
    reasons: Array.from(new Set([
      ...(decision.reasons || []),
      ...reasons,
      ...(changes.reasons || []),
    ])),
    warnings: Array.from(new Set([
      ...(decision.warnings || []),
      ...(changes.warnings || []),
    ])),
    requiredData: Array.from(new Set([
      ...(decision.requiredData || []),
      ...(changes.requiredData || []),
    ])),
    orderSafetyReasons: Array.from(new Set([
      ...(decision.orderSafetyReasons || []),
      ...reasons,
    ])),
  };
}

function applyOrderSafety(product, decision, options = {}) {
  const article = normalizeArticle(product?.article);
  const identificationReasons = [];
  if (!article) identificationReasons.push(ORDER_SAFETY_CODES.ARTICLE_REQUIRED);
  if (options.duplicateArticle === true) {
    identificationReasons.push(ORDER_SAFETY_CODES.DUPLICATE_ARTICLE);
  }
  if (options.identificationReason) {
    identificationReasons.push(options.identificationReason);
  }

  if (identificationReasons.length > 0) {
    return withReasons(decision, identificationReasons, {
      decision: 'manual_review',
      decisionBasis: 'order_safety_identification',
      approvedOrderQuantity: null,
    });
  }

  const mandatoryGap = typeof product?.mandatoryMinimumGap === 'number'
    ? product.mandatoryMinimumGap
    : 0;
  const mandatoryException =
    mandatoryGap > 0 &&
    product?.mandatoryAssortment === true &&
    isAutomaticallyApproved(decision);
  if (mandatoryException) {
    return withReasons(
      decision,
      [ORDER_SAFETY_CODES.MANDATORY_ASSORTMENT_BELOW_FLOOR]
    );
  }

  if (!isAutomaticallyApproved(decision)) return decision;

  const safetyReasons = [];
  if (
    finiteNonNegative(product.freeStock) &&
    finiteNonNegative(product.effectiveMin) &&
    product.freeStock >= product.effectiveMin
  ) {
    safetyReasons.push(ORDER_SAFETY_CODES.FREE_STOCK_NOT_BELOW_MIN);
  }
  if (
    finiteNonNegative(product.freeStock) &&
    finiteNonNegative(options.highStockWarningThreshold) &&
    product.freeStock >= options.highStockWarningThreshold
  ) {
    safetyReasons.push(ORDER_SAFETY_CODES.HIGH_STOCK_ORDER_WARNING);
  }

  if (safetyReasons.length === 0) return decision;
  return withReasons(decision, safetyReasons, {
    decision: 'manual_review',
    decisionBasis: 'order_safety_stock_review',
    approvedOrderQuantity: null,
  });
}

function buildOrderSafetyReview(products, options = {}) {
  const items = (products || [])
    .filter(product =>
      Array.isArray(product.orderSafetyReasons) &&
      product.orderSafetyReasons.length > 0
    )
    .map(product => ({
      rowIdentity: product.rowIdentity,
      sourceRowNumber: product.rowNumber,
      article: product.article || null,
      name: product.name || null,
      supplier: product.supplier || null,
      packaging:
        product.packaging ||
        product.matchingHints?.packageAttributes ||
        null,
      freeStock: product.freeStock ?? null,
      effectiveMin: product.effectiveMin ?? null,
      effectiveMinSource: product.effectiveMinSource ?? null,
      effectiveMax: product.effectiveMax ?? null,
      effectiveMaxSource: product.effectiveMaxSource ?? null,
      proposedOrderQuantity:
        product.approvedOrderQuantity ??
        product.provisionalOrderQuantity ??
        product.finalRecommendedQuantity ??
        product.analyzerCalculatedQuantity ??
        null,
      workflowStatus: product.workflowStatus || null,
      reasons: [...product.orderSafetyReasons],
      ownerDecisionRequired: product.orderSafetyReviewRequired === true,
    }));

  return {
    version: 'order-safety-v1',
    highStockWarningThreshold:
      options.highStockWarningThreshold ?? null,
    itemCount: items.length,
    ownerReviewRequiredCount: items.filter(
      item => item.ownerDecisionRequired
    ).length,
    items,
  };
}

module.exports = {
  ORDER_SAFETY_CODES,
  BLOCKING_ORDER_SAFETY_CODES,
  finiteNonNegative,
  effectiveStockBoundary,
  effectiveMin,
  effectiveMax,
  normalizeArticle,
  extractPackaging,
  packagingMismatch,
  isAutomaticallyApproved,
  withReasons,
  applyOrderSafety,
  buildOrderSafetyReview,
};
