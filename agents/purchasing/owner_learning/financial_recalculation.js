const {
  normalizeAgentRecommendation,
} = require('./owner_learning_report');
const {
  roundMoney,
} = require('../services/financial_controller');

const RECALCULATION_VERSION = 'safe-financial-recalculation-v0.6.2';
const RECALCULATION_STATUS = Object.freeze({
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL_RECALCULATION',
  BLOCKED_INVALID_ORDER: 'BLOCKED_INVALID_ORDER',
});

function optionalString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function missing(value) {
  return value === null || value === undefined;
}

function validNonNegativeNumber(value) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0;
}

function validFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function emptyResult(status, reason) {
  return {
    recalculationVersion: RECALCULATION_VERSION,
    recalculationStatus: status,
    reason,
    currency: null,
    totalOrderAmount: null,
    orderedSkuCount: null,
    orderedUnits: null,
    costAfterRules: null,
    financialStatus: null,
    financiallyPermitted: null,
    availableAfterOrder: null,
    reserveSurplus: null,
    maximumSafeOrderAmount: null,
    missingFields: [],
    invalidFields: [],
    invalidLines: [],
    diagnostics: {
      processedLines: 0,
      ignoredZeroQuantityLines: 0,
      financialStatusRecalculated: false,
    },
  };
}

function lineIssue(index, field, reason) {
  return { index, field, reason };
}

function aggregateOrderLines(orderLines) {
  const result = {
    totalOrderAmount: 0,
    orderedSkuCount: 0,
    orderedUnits: 0,
    missingFields: [],
    invalidLines: [],
    ignoredZeroQuantityLines: 0,
    quantityMissing: false,
  };

  orderLines.forEach((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      result.invalidLines.push(
        lineIssue(index, 'line', 'INVALID_ORDER_LINE')
      );
      return;
    }

    if (missing(line.finalQuantity)) {
      result.missingFields.push(`orderLines[${index}].finalQuantity`);
      result.quantityMissing = true;
      return;
    }
    if (!validNonNegativeNumber(line.finalQuantity)) {
      result.invalidLines.push(
        lineIssue(index, 'finalQuantity', 'INVALID_FINAL_QUANTITY')
      );
      return;
    }
    if (line.finalQuantity === 0) {
      result.ignoredZeroQuantityLines += 1;
      return;
    }

    const recommendation = normalizeAgentRecommendation(
      line.finalRecommendation
    );
    if (recommendation !== 'BUY') {
      result.invalidLines.push(
        lineIssue(
          index,
          'finalRecommendation',
          'POSITIVE_QUANTITY_REQUIRES_BUY'
        )
      );
      return;
    }

    if (missing(line.unitPrice)) {
      result.missingFields.push(`orderLines[${index}].unitPrice`);
      result.orderedSkuCount += 1;
      result.orderedUnits += line.finalQuantity;
      result.totalOrderAmount = null;
      return;
    }
    if (!validNonNegativeNumber(line.unitPrice)) {
      result.invalidLines.push(
        lineIssue(index, 'unitPrice', 'INVALID_UNIT_PRICE')
      );
      return;
    }

    result.orderedSkuCount += 1;
    result.orderedUnits += line.finalQuantity;
    if (result.totalOrderAmount !== null) {
      result.totalOrderAmount = roundMoney(
        result.totalOrderAmount +
        roundMoney(line.finalQuantity * line.unitPrice)
      );
    }
  });

  if (result.quantityMissing) {
    result.totalOrderAmount = null;
    result.orderedSkuCount = null;
    result.orderedUnits = null;
  }
  delete result.quantityMissing;
  return result;
}

function summaryNumber(previousSummary, field, {
  nonNegative = false,
} = {}) {
  const value = previousSummary?.[field];
  if (missing(value)) return { value: null, issue: 'missing' };
  const valid = nonNegative
    ? validNonNegativeNumber(value)
    : validFiniteNumber(value);
  return valid
    ? { value, issue: null }
    : { value: null, issue: 'invalid' };
}

function financialStatusFrom({
  availableAfterOrder,
  reserveSurplus,
  warningThreshold,
}) {
  if (availableAfterOrder < 0) return 'REJECTED';
  if (reserveSurplus < 0) return 'MANUAL_APPROVAL_REQUIRED';
  if (warningThreshold === null) return null;
  return reserveSurplus < warningThreshold
    ? 'APPROVED_WITH_WARNING'
    : 'APPROVED';
}

function recalculateFinancialSummary({
  orderLines,
  previousSummary,
} = {}) {
  if (!Array.isArray(orderLines)) {
    const blocked = emptyResult(
      RECALCULATION_STATUS.BLOCKED_INVALID_ORDER,
      'ORDER_LINES_MUST_BE_ARRAY'
    );
    blocked.invalidFields.push('orderLines');
    return blocked;
  }

  const order = aggregateOrderLines(orderLines);
  if (order.invalidLines.length > 0) {
    const blocked = emptyResult(
      RECALCULATION_STATUS.BLOCKED_INVALID_ORDER,
      'INVALID_ORDER_LINE'
    );
    blocked.invalidLines = order.invalidLines;
    blocked.missingFields = order.missingFields;
    blocked.diagnostics.processedLines = orderLines.length;
    blocked.diagnostics.ignoredZeroQuantityLines =
      order.ignoredZeroQuantityLines;
    return blocked;
  }

  const result = emptyResult(
    RECALCULATION_STATUS.COMPLETE,
    'RECALCULATION_COMPLETE'
  );
  result.totalOrderAmount = order.totalOrderAmount;
  result.orderedSkuCount = order.orderedSkuCount;
  result.orderedUnits = order.orderedUnits;
  result.costAfterRules = order.totalOrderAmount;
  result.missingFields = [...order.missingFields];
  result.diagnostics.processedLines = orderLines.length;
  result.diagnostics.ignoredZeroQuantityLines =
    order.ignoredZeroQuantityLines;

  const currency = optionalString(previousSummary?.currency);
  if (currency) result.currency = currency;
  else result.missingFields.push('previousSummary.currency');

  if (order.totalOrderAmount === null) {
    result.recalculationStatus = RECALCULATION_STATUS.PARTIAL;
    result.reason = 'INSUFFICIENT_ORDER_DATA';
    return result;
  }

  const available = summaryNumber(
    previousSummary,
    'available_after_expenses'
  );
  const reserve = summaryNumber(
    previousSummary,
    'minimum_reserve',
    { nonNegative: true }
  );
  const threshold = summaryNumber(
    previousSummary,
    'warning_reserve_surplus_threshold',
    { nonNegative: true }
  );
  for (const [field, state] of [
    ['previousSummary.available_after_expenses', available],
    ['previousSummary.minimum_reserve', reserve],
  ]) {
    if (state.issue === 'missing') result.missingFields.push(field);
    else if (state.issue === 'invalid') result.invalidFields.push(field);
  }

  if (available.value === null || reserve.value === null) {
    result.recalculationStatus = RECALCULATION_STATUS.PARTIAL;
    result.reason = 'INSUFFICIENT_FINANCIAL_DATA';
    return result;
  }

  result.availableAfterOrder = roundMoney(
    available.value - order.totalOrderAmount
  );
  result.reserveSurplus = roundMoney(
    result.availableAfterOrder - reserve.value
  );
  result.maximumSafeOrderAmount = roundMoney(
    available.value - reserve.value
  );

  const thresholdRequired =
    result.availableAfterOrder >= 0 &&
    result.reserveSurplus >= 0;
  if (thresholdRequired && threshold.issue) {
    const field = 'previousSummary.warning_reserve_surplus_threshold';
    if (threshold.issue === 'missing') result.missingFields.push(field);
    else result.invalidFields.push(field);
  }

  result.financialStatus = financialStatusFrom({
    availableAfterOrder: result.availableAfterOrder,
    reserveSurplus: result.reserveSurplus,
    warningThreshold: threshold.value,
  });
  if (result.financialStatus === null || result.currency === null) {
    result.recalculationStatus = RECALCULATION_STATUS.PARTIAL;
    result.reason = 'INSUFFICIENT_FINANCIAL_DATA';
    return result;
  }

  result.financiallyPermitted = [
    'APPROVED',
    'APPROVED_WITH_WARNING',
  ].includes(result.financialStatus);
  result.diagnostics.financialStatusRecalculated = true;
  return result;
}

module.exports = {
  RECALCULATION_STATUS,
  RECALCULATION_VERSION,
  recalculateFinancialSummary,
};
