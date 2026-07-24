const {
  appendOwnerDecision,
  latestActiveDecisions,
  loadOwnerDecisions,
  normalizeSku,
} = require('../../../agents/purchasing/matrix_builder/owner_decisions');
const {
  buildStableItemKey,
  stableKeyContext,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_history'
);
const {
  normalizeAgentRecommendation,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_report'
);
const {
  recordOwnerDecisionHistory,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history_recorder'
);
const {
  APPLICATION_MODES,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);
const WEB_OWNER_DECISIONS = Object.freeze(['BUY', 'SKIP', 'DEFER']);
const MAX_OWNER_ORDER_QUANTITY = 10000;

class OwnerDecisionServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerDecisionServiceError';
    this.code = code;
  }
}

function validateItemId(itemId) {
  if (
    typeof itemId !== 'string' ||
    itemId.length < 1 ||
    itemId.length > 512 ||
    itemId.includes('\0') ||
    itemId.includes('/') ||
    itemId.includes('\\') ||
    /%(?:00|2e|2f|5c)/i.test(itemId) ||
    itemId === '..'
  ) {
    throw new OwnerDecisionServiceError(
      'INVALID_ITEM_ID',
      'Item ID имеет недопустимое значение.'
    );
  }
  return itemId;
}

function validateWebDecision(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new OwnerDecisionServiceError(
      'INVALID_OWNER_DECISION',
      'Решение владельца имеет недопустимый формат.'
    );
  }
  const decision = typeof input.decision === 'string'
    ? input.decision.trim().toUpperCase()
    : '';
  if (!WEB_OWNER_DECISIONS.includes(decision)) {
    throw new OwnerDecisionServiceError(
      'INVALID_OWNER_DECISION',
      'Решение должно быть BUY, SKIP или DEFER.'
    );
  }
  let quantity = input.quantity;
  if (decision === 'SKIP') quantity = 0;
  if (decision === 'DEFER') quantity = null;
  if (
    decision === 'BUY' &&
    (!Number.isInteger(quantity) ||
      quantity < 0 ||
      quantity > MAX_OWNER_ORDER_QUANTITY)
  ) {
    throw new OwnerDecisionServiceError(
      'INVALID_OWNER_DECISION',
      `Количество должно быть целым числом от 0 до ${MAX_OWNER_ORDER_QUANTITY}.`
    );
  }
  return { decision, quantity };
}

function decisionView(decision) {
  if (!decision) {
    return {
      status: 'none',
      decision: null,
      quantity: null,
      decided_at: null,
      decided_by: null,
      reason: null,
    };
  }
  const webDecision = WEB_OWNER_DECISIONS.includes(decision.owner_decision)
    ? decision.owner_decision
    : null;
  return {
    status: decision.status,
    decision: webDecision,
    quantity: webDecision
      ? decision.owner_order_quantity ?? null
      : null,
    decided_at: decision.decided_at,
    decided_by: decision.decided_by,
    reason: decision.reason,
  };
}

function ownerDecisionSummary(items) {
  const summary = {
    needs_decision: 0,
    confirmed_buy: 0,
    excluded: 0,
    deferred: 0,
  };
  for (const item of items) {
    const decision = item.owner_decision?.decision;
    if (decision === 'BUY') summary.confirmed_buy += 1;
    else if (decision === 'SKIP') summary.excluded += 1;
    else if (decision === 'DEFER') summary.deferred += 1;
    if (
      item.matrix?.owner_review_required === true &&
      (decision === null || decision === undefined || decision === 'DEFER')
    ) {
      summary.needs_decision += 1;
    }
  }
  return summary;
}

function decisionCandidates(item) {
  const candidates = [];
  for (const value of [item?.sku, item?.barcode, item?.row_id]) {
    try {
      const normalized = normalizeSku(value);
      if (!candidates.includes(normalized)) candidates.push(normalized);
    } catch {}
  }
  return candidates;
}

function decisionIdentifierCounts(items) {
  const counts = new Map();
  for (const item of items || []) {
    for (const candidate of decisionCandidates(item)) {
      counts.set(candidate, (counts.get(candidate) || 0) + 1);
    }
  }
  return counts;
}

function uniqueDecisionKey(item, identifierCounts) {
  return decisionCandidates(item).find(
    candidate => identifierCounts.get(candidate) === 1
  ) || null;
}

function stableItemKey(item, items) {
  const identities = (items || []).map(candidate => ({
    sku: candidate.sku,
    barcode: candidate.barcode,
    rowId: candidate.row_id,
    name: candidate.name,
    brand: candidate.brand,
  }));
  const index = (items || []).findIndex(
    candidate => candidate.row_id === item.row_id
  );
  return buildStableItemKey(
    identities[index],
    stableKeyContext(identities)
  );
}

function firstNonNegativeNumber(...values) {
  return values.find(
    value =>
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0
  ) ?? null;
}

function historyFinancialContext(summary = {}) {
  return {
    analyzerOrderAmount:
      summary.amounts?.analyzer_order_sum ?? null,
    workingOrderAmount:
      summary.amounts?.auto_approved_sum ?? null,
    appliedWorkingOrderAmount:
      summary.applied_working_order_financial?.amount_after ?? null,
    financialStatus:
      summary.applied_working_order_financial?.financial_status ??
      summary.financial?.status ??
      null,
    currency: summary.currency ?? null,
  };
}

function skippedHistoryResult() {
  return {
    status: 'SKIPPED',
    decisionId: null,
    added: false,
    warning: {
      code: 'DECISION_HISTORY_CONTEXT_INCOMPLETE',
      message:
        'Недостаточно подтверждённого контекста для записи истории.',
    },
  };
}

function unavailableHistoryResult(logger) {
  if (typeof logger?.warn === 'function') {
    logger.warn(
      '[DECISION_HISTORY_UNAVAILABLE] ' +
      'Owner Decision History недоступен.'
    );
  }
  return {
    status: 'UNAVAILABLE',
    decisionId: null,
    added: false,
    warning: {
      code: 'DECISION_HISTORY_UNAVAILABLE',
      message: 'Историю решения временно не удалось сохранить.',
    },
  };
}

class OwnerDecisionService {
  constructor(options = {}) {
    if (!options.registry) {
      throw new TypeError('Run registry обязателен.');
    }
    if (!options.ownerDecisionsPath) {
      throw new TypeError('Путь к Owner Decisions Memory обязателен.');
    }
    this.registry = options.registry;
    this.ownerDecisionsPath = options.ownerDecisionsPath;
    this.ownerDecisionHistoryPath =
      options.ownerDecisionHistoryPath || null;
    this.applicationMode = APPLICATION_MODES.includes(
      options.applicationMode
    )
      ? options.applicationMode
      : null;
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date().toISOString());
    this.appendDecision = options.appendDecision || appendOwnerDecision;
    this.loadDecisions = options.loadDecisions || loadOwnerDecisions;
    this.recordHistory = options.recordHistory ||
      recordOwnerDecisionHistory;
  }

  activeDecisions() {
    const loaded = this.loadDecisions(this.ownerDecisionsPath, {
      allowMissing: true,
    });
    return latestActiveDecisions(loaded.store.decisions);
  }

  decorateItems(items) {
    const active = this.activeDecisions();
    const identifierCounts = decisionIdentifierCounts(items);
    return (items || []).map(item => {
      const decisionKey = decisionCandidates(item).find(candidate =>
        identifierCounts.get(candidate) === 1 && active.has(candidate)
      );
      const decision = decisionKey
        ? active.get(decisionKey)
        : null;
      return {
        ...item,
        owner_decision: decisionView(decision),
      };
    });
  }

  saveDecision(runId, itemId, input) {
    const validatedItemId = validateItemId(itemId);
    const validated = validateWebDecision(input);
    const items = this.registry.getItems(runId);
    const item = items
      .find(candidate => candidate.row_id === validatedItemId);
    if (!item) {
      throw new OwnerDecisionServiceError(
        'ITEM_NOT_FOUND',
        'Товар в указанном run не найден.'
      );
    }
    const decisionKey = uniqueDecisionKey(
      item,
      decisionIdentifierCounts(items)
    );
    if (!decisionKey) {
      throw new OwnerDecisionServiceError(
        'ITEM_DECISION_UNAVAILABLE',
        'Для товара не удалось определить безопасный ключ решения.'
      );
    }
    const reason = {
      BUY: `Владелец подтвердил заказ: ${validated.quantity} шт.`,
      SKIP: 'Владелец исключил товар из текущей закупки.',
      DEFER: 'Владелец отложил решение по текущей закупке.',
    }[validated.decision];
    let saved;
    try {
      saved = this.appendDecision(this.ownerDecisionsPath, {
        sku: decisionKey,
        owner_decision: validated.decision,
        owner_role_override: null,
        owner_policy_override: null,
        owner_order_quantity: validated.quantity,
        reason,
        decided_at: this.now(),
        decided_by: 'owner-web-ui',
        status: 'active',
        source_version: 'purchasing-web-owner-decisions-v1',
      });
    } catch (error) {
      throw new OwnerDecisionServiceError(
        'OWNER_DECISION_STORAGE_ERROR',
        'Не удалось сохранить решение владельца.',
        { cause: error }
      );
    }
    const savedItem = {
      ...item,
      owner_decision: decisionView(saved.decision),
    };
    let itemStableKey;
    try {
      itemStableKey = stableItemKey(item, items);
    } catch {
      return {
        item: savedItem,
        decisionHistory: skippedHistoryResult(),
      };
    }
    let summary = {};
    try {
      if (typeof this.registry.getRunSummary === 'function') {
        summary = this.registry.getRunSummary(runId);
      }
    } catch {}
    let decisionHistory;
    try {
      decisionHistory = this.recordHistory({
        historyFilePath: this.ownerDecisionHistoryPath,
        source: 'OWNER_REVIEW',
        runContext: {
          runId,
          recordedAt: saved.decision.decided_at,
          applicationMode: this.applicationMode,
        },
        itemContext: {
          supplier: item.supplier ?? null,
          stableItemKey: itemStableKey,
          sku: item.sku ?? null,
          productName: item.name ?? null,
          brand: item.brand ?? null,
          category: item.category ?? null,
        },
        agentDecision: {
          recommendation:
            normalizeAgentRecommendation(item.decision),
          quantity: firstNonNegativeNumber(
            item.quantities?.approved_quantity,
            item.quantities?.provisional_quantity,
            item.quantities?.calculated_quantity,
            item.quantities?.analyzer_quantity
          ),
        },
        ownerDecision: {
          decision: validated.decision,
          quantity: validated.quantity,
          reasonCode: 'NOT_SPECIFIED',
          comment: null,
        },
        financialContext: historyFinancialContext(summary),
        inventoryContext: {
          freeStock: item.stock?.free_stock ?? null,
          reserve: null,
          incomingQuantity: null,
          daysOfStock: null,
        },
        salesContext: {
          sales7d: null,
          sales14d: null,
          sales30d: null,
          averageDailySales: null,
        },
        metadata: {
          itemId: item.row_id,
          workflowStatus: item.workflow_status ?? null,
          ownerReviewRequired:
            item.matrix?.owner_review_required === true,
        },
        logger: this.logger,
      });
    } catch {
      decisionHistory = unavailableHistoryResult(this.logger);
    }
    return {
      item: savedItem,
      decisionHistory,
    };
  }
}

module.exports = {
  MAX_OWNER_ORDER_QUANTITY,
  OwnerDecisionService,
  OwnerDecisionServiceError,
  WEB_OWNER_DECISIONS,
  decisionView,
  historyFinancialContext,
  ownerDecisionSummary,
  validateItemId,
  validateWebDecision,
};
