'use strict';

const {
  MONEY_DECIMAL_PLACES,
  ZERO_DIVISION_RESULT,
} = require('../rules/metric_contract');
const {
  MISKA_AUGUST_2026_SETTINGS,
} = require('../rules/reference_settings');

const MINOR_UNIT_FACTOR = 10 ** MONEY_DECIMAL_PLACES;

function requireNonNegativeNumber(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative finite number`);
  }
  return value;
}

function requireNonNegativeInteger(value, fieldName) {
  requireNonNegativeNumber(value, fieldName);
  if (!Number.isInteger(value)) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }
  return value;
}

function toMinorUnits(value, fieldName) {
  return Math.round(
    requireNonNegativeNumber(value, fieldName) * MINOR_UNIT_FACTOR
  );
}

function fromMinorUnits(value) {
  return value / MINOR_UNIT_FACTOR;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? ZERO_DIVISION_RESULT : numerator / denominator;
}

function boundedScore(actual, target, weight) {
  if (actual === null || target <= 0) return 0;
  return Math.min(weight, (actual / target) * weight);
}

function resolveKpiLevel(score, settings) {
  return settings.levels.find(level => score >= level.minimumScore) ||
    settings.levels[settings.levels.length - 1];
}

function resolveQrCoefficient(qrShare, settings) {
  if (qrShare === null) return 1;
  const tier = settings.qrCoefficientTiers.find(item =>
    item.upperExclusive === null || qrShare < item.upperExclusive
  );
  return tier.coefficient;
}

function optionalNonNegativeInteger(value, fieldName) {
  if (value === null || value === undefined) return null;
  return requireNonNegativeInteger(value, fieldName);
}

function optionalMoney(value, fieldName) {
  if (value === null || value === undefined) return null;
  return fromMinorUnits(toMinorUnits(value, fieldName));
}

function calculateKpiMetrics(input, settings) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('KPI metric input must be an object');
  }
  if (settings === undefined) settings = MISKA_AUGUST_2026_SETTINGS;
  const paymentBreakdownAvailable = input.paymentBreakdownAvailable !== false &&
    input.revenueSource !== 'historical_total';
  if (settings !== null && (!settings?.payment ||
      typeof settings.payment.qrIncludedInAcquiring !== 'boolean')) {
    throw new TypeError(
      'settings.payment.qrIncludedInAcquiring must be a boolean'
    );
  }

  let cash = null;
  let acquiring = null;
  let qr = null;
  let revenue;
  if (paymentBreakdownAvailable) {
    cash = fromMinorUnits(toMinorUnits(input.cash, 'cash'));
    acquiring = fromMinorUnits(toMinorUnits(input.acquiring, 'acquiring'));
    qr = fromMinorUnits(toMinorUnits(input.qr, 'qr'));
    if (settings?.payment.qrIncludedInAcquiring && qr > acquiring) {
      throw new TypeError('qr must be less than or equal to acquiring');
    }
    revenue = fromMinorUnits(
      toMinorUnits(cash, 'cash') + toMinorUnits(acquiring, 'acquiring') +
      (settings?.payment.qrIncludedInAcquiring === false ? toMinorUnits(qr, 'qr') : 0)
    );
  } else {
    revenue = fromMinorUnits(toMinorUnits(input.historicalRevenue, 'historicalRevenue'));
  }

  const receipts = requireNonNegativeInteger(input.receipts, 'receipts');
  const itemsSold = optionalNonNegativeInteger(input.itemsSold, 'itemsSold');
  const upsellReceipts = optionalNonNegativeInteger(
    input.upsellReceipts,
    'upsellReceipts'
  );
  const treatsReceipts = optionalNonNegativeInteger(
    input.treatsReceipts,
    'treatsReceipts'
  );
  const treatsRevenue = optionalMoney(input.treatsRevenue, 'treatsRevenue');
  if (upsellReceipts !== null && upsellReceipts > receipts) {
    throw new TypeError('upsellReceipts must not exceed receipts');
  }
  if (treatsReceipts !== null && treatsReceipts > receipts) {
    throw new TypeError('treatsReceipts must not exceed receipts');
  }

  const averageCheck = ratio(revenue, receipts);
  const itemsPerReceipt = itemsSold === null ? null : ratio(itemsSold, receipts);
  const upsellReceiptShare = upsellReceipts === null ? null : ratio(upsellReceipts, receipts);
  const treatsReceiptShare = treatsReceipts === null ? null : ratio(treatsReceipts, receipts);
  const qrShare = paymentBreakdownAvailable ? ratio(qr, revenue) : null;

  const completeKpiInput = settings !== null && itemsSold !== null &&
    upsellReceipts !== null && treatsRevenue !== null && treatsReceipts !== null;
  const scores = completeKpiInput ? Object.freeze({
    shiftPlan: boundedScore(
      revenue,
      settings.targets.shiftRevenue,
      settings.weights.shiftPlan
    ),
    averageCheck: boundedScore(
      averageCheck,
      settings.targets.averageCheck,
      settings.weights.averageCheck
    ),
    itemsPerReceipt: boundedScore(
      itemsPerReceipt,
      settings.targets.itemsPerReceipt,
      settings.weights.itemsPerReceipt
    ),
    upsell: boundedScore(
      upsellReceiptShare,
      settings.targets.upsellReceiptShare,
      settings.weights.upsell
    ),
    treats: boundedScore(
      (
        treatsRevenue / settings.targets.treatsRevenue +
        (treatsReceiptShare || 0) / settings.targets.treatsReceiptShare
      ) / 2,
      1,
      settings.weights.treats
    ),
  }) : null;
  const kpiScore = scores
    ? Object.values(scores).reduce((sum, value) => sum + value, 0)
    : null;
  const level = kpiScore === null ? null : resolveKpiLevel(kpiScore, settings);

  return Object.freeze({
    revenue,
    averageCheck,
    itemsPerReceipt,
    upsellReceiptShare,
    treatsReceiptShare,
    qrShare,
    receipts,
    itemsSold,
    upsellReceipts,
    treatsRevenue,
    treatsReceipts,
    kpiScore,
    kpiLevel: level?.name || null,
    kpiStatus: completeKpiInput ? 'COMPLETE' : 'UNRESOLVED',
    scores,
    revenueSource: paymentBreakdownAvailable ? 'payment_breakdown' : 'historical_total',
    paymentBreakdownAvailable,
    paymentBreakdown: paymentBreakdownAvailable ? Object.freeze({
      cash,
      acquiring,
      qr,
      qrIncludedInAcquiring: settings?.payment.qrIncludedInAcquiring ?? true,
    }) : null,
  });
}

module.exports = {
  boundedScore,
  calculateKpiMetrics,
  fromMinorUnits,
  ratio,
  requireNonNegativeInteger,
  requireNonNegativeNumber,
  resolveKpiLevel,
  resolveQrCoefficient,
  toMinorUnits,
};
