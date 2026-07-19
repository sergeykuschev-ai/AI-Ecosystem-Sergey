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

module.exports = {
  DELIVERY_THRESHOLD,
  EXPENSIVE_ROWS_LIMIT,
  DECISION_ENGINE_CONFIG,
};
