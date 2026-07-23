const {
  appendOwnerDecision,
  latestActiveDecisions,
  loadOwnerDecisions,
  normalizeSku,
} = require('../../../agents/purchasing/matrix_builder/owner_decisions');

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
    else summary.needs_decision += 1;
  }
  return summary;
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
    this.now = options.now || (() => new Date().toISOString());
    this.appendDecision = options.appendDecision || appendOwnerDecision;
    this.loadDecisions = options.loadDecisions || loadOwnerDecisions;
  }

  activeDecisions() {
    const loaded = this.loadDecisions(this.ownerDecisionsPath, {
      allowMissing: true,
    });
    return latestActiveDecisions(loaded.store.decisions);
  }

  decorateItems(items) {
    const active = this.activeDecisions();
    const skuCounts = new Map();
    for (const item of items || []) {
      try {
        if (!item.sku) continue;
        const sku = normalizeSku(item.sku);
        skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
      } catch {}
    }
    return (items || []).map(item => {
      let decision = null;
      try {
        if (item.sku) {
          const sku = normalizeSku(item.sku);
          if (skuCounts.get(sku) === 1) {
            decision = active.get(sku) || null;
          }
        }
      } catch {}
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
    if (!item.sku) {
      throw new OwnerDecisionServiceError(
        'ITEM_DECISION_UNAVAILABLE',
        'Для товара без однозначного SKU нельзя сохранить решение.'
      );
    }
    const normalizedSku = normalizeSku(item.sku);
    const matchingSkuCount = items.filter(candidate => {
      try {
        return candidate.sku &&
          normalizeSku(candidate.sku) === normalizedSku;
      } catch {
        return false;
      }
    }).length;
    if (matchingSkuCount !== 1) {
      throw new OwnerDecisionServiceError(
        'ITEM_DECISION_UNAVAILABLE',
        'Для неоднозначного SKU нельзя сохранить решение.'
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
        sku: item.sku,
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
    return {
      ...item,
      owner_decision: decisionView(saved.decision),
    };
  }
}

module.exports = {
  MAX_OWNER_ORDER_QUANTITY,
  OwnerDecisionService,
  OwnerDecisionServiceError,
  WEB_OWNER_DECISIONS,
  decisionView,
  ownerDecisionSummary,
  validateItemId,
  validateWebDecision,
};
