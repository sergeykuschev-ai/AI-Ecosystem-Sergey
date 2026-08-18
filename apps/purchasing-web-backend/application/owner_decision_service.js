const {
  addDaysToIsoTimestamp,
  appendOwnerDecision,
  DEFAULT_RUN_DECISION_TTL_DAYS,
  latestActiveDecisions,
  loadOwnerDecisions,
} = require('../../../agents/purchasing/matrix_builder/owner_decisions');
const {
  ownerDecisionKeyCandidates,
  ownerDecisionKeyContext,
  uniqueOwnerDecisionKey,
} = require(
  '../../../agents/purchasing/services/owner_decision_identity'
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
  OWNER_REVIEW_REASON_CODES,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);
const {
  applyPackagingRules,
  classifyItem,
} = require('../../../agents/purchasing/services/final_order');
const WEB_OWNER_DECISIONS = Object.freeze([
  'BUY',
  'SKIP',
  'DEFER',
  'BUY_NOW',
  'POSTPONE',
  'REMOVE_FROM_MATRIX',
]);
const MAX_OWNER_ORDER_QUANTITY = 10000;
const MAX_OWNER_COMMENT_LENGTH = 1000;
const OWNER_DECISION_ACTOR = 'owner-web-ui';

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}
const OWNER_REVIEW_REASON_LABELS = Object.freeze({
  HIGH_STOCK: 'Высокий остаток',
  LOW_DEMAND: 'Низкий спрос',
  SEASONAL: 'Сезонный фактор',
  MANDATORY: 'Обязательный товар',
  NEW_PRODUCT: 'Новый товар',
  CUSTOMER_REQUEST: 'Запрос клиента',
  MINMAX_ERROR: 'Ошибка Min/Max',
  POLICY_ERROR: 'Ошибка политики',
  ALREADY_ORDERED: 'Уже заказано',
  WAIT_NEXT_DELIVERY: 'Ожидание следующей поставки',
  TEST_PRODUCT: 'Тестовый товар',
  SUPPLIER_LIMITATION: 'Ограничение поставщика',
  PRICE_TOO_HIGH: 'Слишком высокая цена',
  LOW_MARGIN: 'Низкая маржа',
  MANUAL_EXPERIENCE: 'Ручной опыт владельца',
  OTHER: 'Другая причина',
});
const LEGACY_DECISION_REASONS = Object.freeze({
  BUY: 'Владелец подтвердил заказ вручную.',
  SKIP: 'Владелец исключил товар из текущей закупки.',
  DEFER: 'Владелец отложил решение по текущей закупке.',
});

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
  if (decision === 'SKIP' || decision === 'REMOVE_FROM_MATRIX') quantity = 0;
  if (decision === 'DEFER' || decision === 'POSTPONE') quantity = null;
  if (
    (decision === 'BUY' || decision === 'BUY_NOW') &&
    (!Number.isInteger(quantity) ||
      quantity < 0 ||
      quantity > MAX_OWNER_ORDER_QUANTITY)
  ) {
    throw new OwnerDecisionServiceError(
      'INVALID_OWNER_DECISION',
      `Количество должно быть целым числом от 0 до ${MAX_OWNER_ORDER_QUANTITY}.`
    );
  }
  const hasReasonCode = Object.hasOwn(input, 'reasonCode');
  const reasonCode = hasReasonCode && typeof input.reasonCode === 'string'
    ? input.reasonCode.trim().toUpperCase()
    : null;
  if (
    hasReasonCode &&
    !OWNER_REVIEW_REASON_CODES.includes(reasonCode)
  ) {
    throw new OwnerDecisionServiceError(
      'INVALID_OWNER_DECISION',
      'Укажите поддерживаемую причину решения.'
    );
  }
  if (
    input.comment !== null &&
    input.comment !== undefined &&
    typeof input.comment !== 'string'
  ) {
    throw new OwnerDecisionServiceError(
      'INVALID_OWNER_DECISION',
      'Комментарий должен быть строкой.'
    );
  }
  const comment = typeof input.comment === 'string'
    ? input.comment.trim()
    : '';
  if (comment.length > MAX_OWNER_COMMENT_LENGTH) {
    throw new OwnerDecisionServiceError(
      'INVALID_OWNER_DECISION',
      `Комментарий не должен превышать ${MAX_OWNER_COMMENT_LENGTH} символов.`
    );
  }
  if (reasonCode === 'OTHER' && comment === '') {
    throw new OwnerDecisionServiceError(
      'INVALID_OWNER_DECISION',
      'Для причины OTHER укажите комментарий.'
    );
  }
  return {
    decision,
    quantity,
    reasonCode,
    comment: comment || null,
    permanent: input.permanent === true,
  };
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
      reason_code: null,
      comment: null,
    };
  }
  const webDecision = WEB_OWNER_DECISIONS.includes(decision.owner_decision)
    ? decision.owner_decision
    : null;
  return {
    status: decision.status,
    decision: webDecision,
    original_decision: decision.original_decision || null,
    review_date: decision.original_decision_review_date || null,
    quantity: webDecision
      ? decision.owner_order_quantity ?? null
      : null,
    decided_at: decision.decided_at,
    decided_by: decision.decided_by,
    reason: decision.reason,
    reason_code: decision.reason_code ?? null,
    comment: decision.comment ?? null,
  };
}

function finalQuantityWithOwnerDecision(item) {
  const classification = classifyItem(item);
  if (classification.kind === 'included') {
    return applyPackagingRules(item, classification.quantity).quantity;
  }
  if (classification.kind === 'unresolved') {
    return null;
  }
  return classification.reason === 'deferred' ? null : 0;
}

function withFinalQuantity(item) {
  return {
    ...item,
    quantities: {
      ...(item.quantities || {}),
      final_quantity: finalQuantityWithOwnerDecision(item),
    },
  };
}

function pendingQuantity(item) {
  const ownerDecision = item?.owner_decision?.decision || null;
  if (ownerDecision === 'BUY') {
    return finiteNumber(item?.owner_decision?.quantity);
  }
  if (ownerDecision !== null) return 0;
  return finiteNumber(item?.quantities?.approved_quantity) ??
    finiteNumber(item?.quantities?.provisional_quantity) ??
    finiteNumber(item?.quantities?.calculated_quantity) ??
    finiteNumber(item?.quantities?.analyzer_quantity) ??
    null;
}

function ownerDecisionSummary(items) {
  // Semantics are aligned with the canonical FinalOrderState classifier:
  // - DEFER is a made decision (resolved): it leaves «Нужно решить» and the
  //   item stays visible in «Все товары» with the «Отложено» status.
  // - «Подтверждены» (confirmed) mirrors classifyItem(item).kind ===
  //   'included', i.e. owner BUY with quantity > 0 plus auto-approved
  //   positions — exactly the rows that enter the final/supplier order.
  // - The legacy needs_decision counter is preserved for backward
  //   compatibility and is split into pending_positive, pending_zero,
  //   postponed and do_not_buy so the UI can distinguish the mixed bucket.
  const summary = {
    needs_decision: 0,
    pending_positive: 0,
    pending_zero: 0,
    postponed: 0,
    do_not_buy: 0,
    warnings: 0,
    safe_no_order: 0,
    confirmed: 0,
    confirmed_buy: 0,
    excluded: 0,
    deferred: 0,
  };
  for (const item of items) {
    const decision = item.owner_decision?.decision;
    if (decision === 'BUY') summary.confirmed_buy += 1;
    else if (decision === 'SKIP') summary.excluded += 1;
    else if (decision === 'DEFER') summary.deferred += 1;
    if (classifyItem(item).kind === 'included') summary.confirmed += 1;

    const actionClass = item.matrix?.owner_action_class || null;
    const hasNoOwnerDecision = decision === null || decision === undefined;

    if (
      actionClass === 'OWNER_ACTION_REQUIRED' &&
      hasNoOwnerDecision
    ) {
      summary.needs_decision += 1;
      const quantity = pendingQuantity(item);
      if (quantity !== null && quantity > 0) {
        summary.pending_positive += 1;
      } else {
        summary.pending_zero += 1;
      }
    } else if (actionClass === 'POSTPONED' && hasNoOwnerDecision) {
      summary.postponed += 1;
    } else if (actionClass === 'SAFE_NO_ORDER' && hasNoOwnerDecision) {
      summary.do_not_buy += 1;
      summary.safe_no_order += 1;
    } else if (actionClass === 'WARNING_ONLY' && hasNoOwnerDecision) {
      summary.warnings += 1;
    } else if (
      // Backward compatibility for runs created before owner_action_class.
      actionClass === null &&
      item.matrix?.owner_review_required === true &&
      hasNoOwnerDecision
    ) {
      summary.needs_decision += 1;
      const agentDecision = item.decision || null;
      const workflowStatus = item.workflow_status || null;
      if (
        agentDecision === 'postpone' ||
        workflowStatus === 'postponed'
      ) {
        summary.postponed += 1;
      } else if (
        agentDecision === 'do_not_buy' ||
        workflowStatus === 'no_order_action' ||
        workflowStatus === 'confidently_excluded'
      ) {
        summary.do_not_buy += 1;
      } else {
        const quantity = pendingQuantity(item);
        if (quantity !== null && quantity > 0) {
          summary.pending_positive += 1;
        } else {
          summary.pending_zero += 1;
        }
      }
    }
  }
  return summary;
}

function decisionIdentifierCounts(items) {
  return ownerDecisionKeyContext(items);
}

function uniqueDecisionKey(item, identifierCounts) {
  return uniqueOwnerDecisionKey(item, identifierCounts);
}

function stableItemKey(item, items) {
  return uniqueOwnerDecisionKey(item, ownerDecisionKeyContext(items));
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
    return latestActiveDecisions(loaded.store.decisions, { now: this.now() });
  }

  decorateItems(items) {
    const active = this.activeDecisions();
    const identifierCounts = decisionIdentifierCounts(items);
    return (items || []).map(item => {
      const decisionKey = ownerDecisionKeyCandidates(item).find(candidate =>
        identifierCounts.get(candidate) === 1 && active.has(candidate)
      );
      const decision = decisionKey
        ? active.get(decisionKey)
        : null;
      const mappedDecision = decisionView(decision);
      const decorated = {
        ...item,
        owner_decision: mappedDecision,
      };
      if (mappedDecision.review_date) {
        decorated.test_review_date = mappedDecision.review_date;
      }
      return withFinalQuantity(decorated);
    });
  }

  saveDecision(runId, itemId, input) {
    const validatedItemId = validateItemId(itemId);
    const validated = validateWebDecision(input);
    const idempotencyKey = input?.idempotencyKey &&
      typeof input.idempotencyKey === 'string'
      ? input.idempotencyKey.trim() || null
      : null;
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
    const decidedAt = this.now();
    const isRolloutItem = item.first_rollout_test_awaiting === true ||
      item.assortment_policy?.rollout_status === 'FIRST_ROLLOUT';
    const reviewAfterDays = item.assortment_policy?.review_after_days ??
      item.review_after_days ??
      DEFAULT_RUN_DECISION_TTL_DAYS;

    const decisionMapping = {
      BUY_NOW: { internal: 'BUY', original: 'BUY_NOW', canBePermanent: true },
      POSTPONE: { internal: 'DEFER', original: 'POSTPONE', canBePermanent: false },
      REMOVE_FROM_MATRIX: { internal: 'SKIP', original: 'REMOVE_FROM_MATRIX', canBePermanent: true },
      BUY: { internal: 'BUY', original: null, canBePermanent: true },
      SKIP: { internal: 'SKIP', original: null, canBePermanent: true },
      DEFER: { internal: 'DEFER', original: null, canBePermanent: false },
    };
    const mapping = decisionMapping[validated.decision];
    const internalDecision = mapping.internal;
    const originalDecision = mapping.original;

    const legacyReason = LEGACY_DECISION_REASONS[internalDecision];
    const rolloutReason = originalDecision
      ? `Владелец выбрал «${originalDecision}» для TEST в FIRST_ROLLOUT.`
      : null;
    const reason = validated.reasonCode
      ? OWNER_REVIEW_REASON_LABELS[validated.reasonCode]
      : (isRolloutItem && rolloutReason ? rolloutReason : legacyReason);

    const canBePermanent = mapping.canBePermanent;
    const requestedPermanent = validated.permanent === true;
    const scope = canBePermanent && requestedPermanent ? 'permanent' : 'run';
    let expiresAt = null;
    let originalDecisionReviewDate = null;
    if (scope === 'run') {
      const ttlDays = originalDecision === 'POSTPONE' && isRolloutItem
        ? reviewAfterDays
        : DEFAULT_RUN_DECISION_TTL_DAYS;
      expiresAt = addDaysToIsoTimestamp(decidedAt, ttlDays);
    }
    if (originalDecision === 'POSTPONE' && isRolloutItem && expiresAt) {
      originalDecisionReviewDate = expiresAt.slice(0, 10);
    }

    let saved;
    try {
      saved = this.appendDecision(this.ownerDecisionsPath, {
        sku: decisionKey,
        owner_decision: internalDecision,
        owner_role_override: null,
        owner_policy_override: null,
        owner_order_quantity: validated.quantity,
        run_id: runId,
        reason_code: validated.reasonCode,
        comment: validated.comment,
        reason,
        decided_at: decidedAt,
        decided_by: OWNER_DECISION_ACTOR,
        status: 'active',
        source_version: 'purchasing-web-owner-decisions-v1',
        scope,
        expires_at: expiresAt,
        original_decision: originalDecision,
        original_decision_review_date: originalDecisionReviewDate,
      }, { idempotencyKey });
    } catch (error) {
      throw new OwnerDecisionServiceError(
        'OWNER_DECISION_STORAGE_ERROR',
        'Не удалось сохранить решение владельца.',
        { cause: error }
      );
    }
    const savedItemView = decisionView(saved.decision);
    const savedItem = withFinalQuantity({
      ...item,
      owner_decision: savedItemView,
    });
    if (savedItemView.review_date) {
      savedItem.test_review_date = savedItemView.review_date;
    }
    if (saved.duplicate) {
      return {
        item: savedItem,
        decisionHistory: {
          status: 'DUPLICATE',
          decisionId: null,
          added: false,
          warning: {
            code: 'OWNER_DECISION_IDEMPOTENT_DUPLICATE',
            message: 'Решение с указанным idempotencyKey уже сохранено.',
          },
        },
      };
    }
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
          decision: originalDecision || validated.decision,
          quantity: validated.quantity,
          decidedBy: saved.decision.decided_by,
          reasonCode: validated.reasonCode,
          comment: validated.comment,
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
  MAX_OWNER_COMMENT_LENGTH,
  LEGACY_DECISION_REASONS,
  OWNER_DECISION_ACTOR,
  OWNER_REVIEW_REASON_LABELS,
  OwnerDecisionService,
  OwnerDecisionServiceError,
  WEB_OWNER_DECISIONS,
  decisionView,
  finalQuantityWithOwnerDecision,
  historyFinancialContext,
  ownerDecisionSummary,
  validateItemId,
  validateWebDecision,
  withFinalQuantity,
};
