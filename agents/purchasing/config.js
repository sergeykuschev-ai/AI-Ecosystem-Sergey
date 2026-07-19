const { DELIVERY_THRESHOLD } = require('./rules/supplier_rules');

const EXPENSIVE_ROWS_LIMIT = 15;

const DECISION_ENGINE_CONFIG = Object.freeze({
  version: 'v2-phase-1',
  score: Object.freeze({
    base: 40,
    positiveCalculatedOrder: 20,
    nonPositiveCalculatedOrder: 45,
    knownFreeStock: 15,
    unknownFreeStock: -35,
    confirmedZeroStock: 10,
    negativeFreeStock: -20,
    priorityAX: 25,
    priorityAY: 18,
    strategicProduct: 10,
    riskAZ: -25,
    riskBZ: -20,
    riskCY: -15,
    riskCZ: -30,
    missingCriticalField: -20,
    missingArticle: 0,
    duplicateArticle: 0,
  }),
  confidenceThresholds: Object.freeze({
    high: 85,
    medium: 50,
  }),
  scoreBounds: Object.freeze({
    minimum: 0,
    maximum: 100,
  }),
});

const DEMAND_ENGINE_CONFIG = Object.freeze({
  version: 'v2-phase-2',
  assortmentMatrixMode: 'optional',
  salesInputMode: 'auto',
  defaultPurchasingProfile: 'generic',
  inTransitMode: 'required',
  purchasingProfiles: Object.freeze({
    generic: Object.freeze({ inTransitMode: 'required' }),
    miska: Object.freeze({ inTransitMode: 'included_in_source_stock' }),
  }),
  salesWeights: Object.freeze({
    sales7: Object.freeze({ days: 7, weight: 0.5 }),
    sales14: Object.freeze({ days: 14, weight: 0.3 }),
    sales30: Object.freeze({ days: 30, weight: 0.2 }),
  }),
  smartZapasWeeklySalesWeights: Object.freeze({
    sales7: Object.freeze({ days: 7, weight: 0.5 }),
    sales14: Object.freeze({ days: 14, weight: 0.3 }),
    sales28: Object.freeze({ days: 28, weight: 0.2 }),
  }),
  supplierDeliveryCycleDays: Object.freeze({
    default: null,
    bySupplier: Object.freeze({
      'ао "валта пет продактс"': 14,
    }),
  }),
  safetyStockDays: Object.freeze({
    'A/X': 21,
    'A/Y': 14,
    'A/Z': 7,
    'B/X': 14,
    'B/Y': 7,
    'B/Z': 0,
    'C/X': 7,
    'C/Y': 0,
    'C/Z': 0,
    'D/ZZ': 0,
  }),
  trendThresholds: Object.freeze({
    spikeMultiplier: 2,
    declineRatio: 0.5,
    spikeReviewQuantity: 20,
    spikeReviewOrderValue: 5000,
  }),
  decisionScore: Object.freeze({
    base: 40,
    knownFinalQuantity: 20,
    knownStock: 15,
    validSales: 15,
    completeSales: 10,
    mandatoryCritical: 20,
    priorityAX: 15,
    priorityAY: 10,
    priorityBX: 5,
    missingCriticalField: -15,
    shortTermSalesSpike: -15,
    decliningSales: -10,
    missingSalesPeriod: -5,
  }),
  confidenceThresholds: Object.freeze({
    high: 85,
    medium: 50,
  }),
  scoreBounds: Object.freeze({
    minimum: 0,
    maximum: 100,
  }),
});

const MISKA_FINANCIAL_CONTROLLER_CONFIG = Object.freeze({
  version: 'financial-controller-v1',
  store_profile: 'miska',
  currency: 'RUB',
  warning_reserve_surplus: 30000,
  defaults: Object.freeze({
    cash_balance: 118000,
    bank_balance: 300000,
    expected_revenue: 685899,
    fixed_expenses: Object.freeze({
      rent: 60000,
      payroll: 75000,
      taxes: 39750,
    }),
    acquiring_rate: 0.025,
    supplier_debt: 0,
    committed_supplier_payments: 0,
    minimum_reserve: 100000,
  }),
  historical_reference: Object.freeze({
    period: '2026-01_to_2026-06',
    average_revenue: 685899,
    median_revenue: 675759,
    average_purchasing_spend: 347444,
    median_purchasing_spend: 362179,
    working_purchasing_range: Object.freeze({
      minimum: 362000,
      maximum: 379000,
    }),
  }),
});

module.exports = {
  DELIVERY_THRESHOLD,
  EXPENSIVE_ROWS_LIMIT,
  DECISION_ENGINE_CONFIG,
  DEMAND_ENGINE_CONFIG,
  MISKA_FINANCIAL_CONTROLLER_CONFIG,
};
