const {
  loadDecisionHistory,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);
const {
  analyzeOwnerDecisionHistory,
  getBrandDecisionAnalytics,
  getDecisionReasonAnalytics,
  getItemDecisionAnalytics,
  getSupplierDecisionAnalytics,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history_analytics'
);

const UNAVAILABLE_WARNING = 'OWNER_DECISION_ANALYTICS_UNAVAILABLE';

function generatedAt(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('now должен возвращать допустимую дату.');
  }
  return date.toISOString();
}

class OwnerDecisionAnalyticsService {
  constructor(options = {}) {
    if (!options.historyFilePath) {
      throw new TypeError('Путь к Owner Decision History обязателен.');
    }
    this.historyFilePath = options.historyFilePath;
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date());
    this.loadHistory = options.loadHistory || loadDecisionHistory;
  }

  read(operation) {
    try {
      const history = this.loadHistory({
        filePath: this.historyFilePath,
        logger: { error() {} },
      });
      return {
        status: 'AVAILABLE',
        analytics: operation(history),
        warning: null,
      };
    } catch (error) {
      if (error?.code === 'OWNER_DECISION_ANALYTICS_INVALID_INPUT') {
        throw error;
      }
      if (typeof this.logger?.warn === 'function') {
        this.logger.warn(
          '[OWNER_DECISION_ANALYTICS_UNAVAILABLE] ' +
          'Owner Decision History Analytics недоступна.'
        );
      }
      return {
        status: 'UNAVAILABLE',
        analytics: null,
        warning: UNAVAILABLE_WARNING,
      };
    }
  }

  getAnalytics({ filters = {}, options = {} } = {}) {
    return this.read(history => analyzeOwnerDecisionHistory({
      history,
      filters,
      options: {
        ...options,
        generatedAt: options.generatedAt || generatedAt(this.now),
      },
    }));
  }

  getItemAnalytics({ stableItemKey } = {}) {
    return this.read(history => getItemDecisionAnalytics({
      history,
      stableItemKey,
    }));
  }

  getBrandAnalytics({ brand } = {}) {
    return this.read(history => getBrandDecisionAnalytics({
      history,
      brand,
    }));
  }

  getSupplierAnalytics({ supplier } = {}) {
    return this.read(history => getSupplierDecisionAnalytics({
      history,
      supplier,
    }));
  }

  getReasonAnalytics() {
    return this.read(history => getDecisionReasonAnalytics({ history }));
  }
}

module.exports = {
  UNAVAILABLE_WARNING,
  OwnerDecisionAnalyticsService,
};
