'use strict';

/**
 * Оптимизация заказа под целевой бюджет.
 *
 * Основной вход — каноническое финальное состояние заказа
 * (`input.finalOrder`, результат buildFinalOrderState): оптимизируется
 * утверждённый владельцем заказ, а не исходная рекомендация агента.
 * Вход `input.agentResult` (workingOrderProducts) сохранён для
 * обратной совместимости существующих сценариев и тестов.
 *
 * Все денежные вычисления ведутся в целых копейках, поэтому повторные
 * запуски не накапливают ошибки округления.
 */

const DECISION_REDUCTION_ORDER = Object.freeze({
  postpone: 0,
  manual_review: 1,
  recommended: 2,
  do_not_buy: 3,
});

/**
 * Порядок сокращения для позиций финального заказа (FinalOrderState):
 * сначала автоматически одобренные, явные решения владельца (BUY)
 * сокращаются в последнюю очередь.
 */
const FINAL_ORDER_SOURCE_REDUCTION_ORDER = Object.freeze({
  auto: 0,
  manual: 1,
});

const MATRIX_PRIORITY_ORDER = Object.freeze({
  standard: 0,
  important: 1,
  critical: 2,
});

const ABC_PRIORITY_ORDER = Object.freeze({
  C: 0,
  B: 1,
  A: 2,
});

const XYZ_PRIORITY_ORDER = Object.freeze({
  Z: 0,
  Y: 1,
  X: 2,
});

class BudgetOptimizerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BudgetOptimizerError';
    this.code = code;
  }
}

function toCents(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new BudgetOptimizerError(
      'BUDGET_OPTIMIZER_INVALID_INPUT',
      `Поле ${fieldName} должно быть неотрицательным числом.`
    );
  }
  return Math.round(value * 100);
}

function fromCents(value) {
  return Math.round(value) / 100;
}

function nonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new BudgetOptimizerError(
      'BUDGET_OPTIMIZER_INVALID_INPUT',
      `Поле ${fieldName} должно быть неотрицательным целым числом.`
    );
  }
  return value;
}

function agentJson(agentResult) {
  if (Array.isArray(agentResult)) {
    return agentResult[0]?.json || null;
  }
  if (agentResult?.json && typeof agentResult.json === 'object') {
    return agentResult.json;
  }
  return agentResult && typeof agentResult === 'object'
    ? agentResult
    : null;
}

function indexByIdentity(items) {
  return new Map((items || [])
    .filter(item => typeof item?.rowIdentity === 'string')
    .map(item => [item.rowIdentity, item]));
}

function normalizedDecision(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase()
    : null;
}

function explicitMinimumQuantity(product) {
  for (const value of [
    product.minimumOrderQuantity,
    product.minOrderQuantity,
    product.minimum_order_quantity,
  ]) {
    if (Number.isInteger(value) && value >= 1) return value;
  }
  return 0;
}

function protectedQuantity(product, demandProduct, decision, quantity) {
  if (decision === 'must_buy') {
    return {
      quantity,
      reasons: ['MUST_BUY'],
    };
  }

  const reasons = [];
  let minimum = explicitMinimumQuantity(product);
  if (minimum > 0) reasons.push('MINIMUM_ORDER_QUANTITY');

  if (demandProduct?.mandatoryAssortment === true) {
    const mandatoryGap = Number.isInteger(
      demandProduct.mandatoryMinimumGap
    ) && demandProduct.mandatoryMinimumGap > 0
      ? demandProduct.mandatoryMinimumGap
      : 1;
    minimum = Math.max(minimum, mandatoryGap);
    reasons.push('MANDATORY_ASSORTMENT');
  }

  return {
    quantity: Math.min(quantity, minimum),
    reasons,
  };
}

function sourceItems(agent) {
  if (!agent || !Array.isArray(agent.workingOrderProducts)) {
    throw new BudgetOptimizerError(
      'BUDGET_OPTIMIZER_INVALID_INPUT',
      'Исходный результат не содержит workingOrderProducts.'
    );
  }

  const decisions = indexByIdentity(agent.decisions);
  const demandProducts = indexByIdentity(agent.demandProducts);

  return agent.workingOrderProducts.flatMap((product, index) => {
    const quantity = nonNegativeInteger(
      product?.analyzerCalculatedQuantity,
      `workingOrderProducts[${index}].analyzerCalculatedQuantity`
    );
    if (quantity === 0) return [];

    const priceCents = toCents(
      product?.priceNum,
      `workingOrderProducts[${index}].priceNum`
    );
    if (priceCents === 0) {
      throw new BudgetOptimizerError(
        'BUDGET_OPTIMIZER_INVALID_INPUT',
        `Цена workingOrderProducts[${index}] должна быть больше нуля.`
      );
    }

    const identity = product.rowIdentity;
    const decision = normalizedDecision(
      product.phase2Decision ||
      decisions.get(identity)?.decision
    );
    const protection = protectedQuantity(
      product,
      demandProducts.get(identity),
      decision,
      quantity
    );

    return [{
      rowIdentity: identity || null,
      sourceRow: Number.isInteger(product.rowNumber)
        ? product.rowNumber
        : null,
      sku: product.article ||
        product.barcode ||
        product.internalProductId ||
        null,
      name: product.name || null,
      supplier: product.supplier || null,
      decision,
      priceCents,
      originalQuantity: quantity,
      optimizedQuantity: quantity,
      minimumQuantity: protection.quantity,
      protectedReasons: protection.reasons,
      matrixPriority:
        product.assortment_matrix?.priority || null,
      abc: product.abc || null,
      xyz: product.xyz || null,
      decisionScore:
        typeof decisions.get(identity)?.decisionScore === 'number'
          ? decisions.get(identity).decisionScore
          : null,
      sourceIndex: index,
    }];
  });
}

function priorityValue(order, value, fallback) {
  return Object.hasOwn(order, value) ? order[value] : fallback;
}

function reductionRank(decision) {
  if (Object.hasOwn(DECISION_REDUCTION_ORDER, decision)) {
    return DECISION_REDUCTION_ORDER[decision];
  }
  if (Object.hasOwn(FINAL_ORDER_SOURCE_REDUCTION_ORDER, decision)) {
    return FINAL_ORDER_SOURCE_REDUCTION_ORDER[decision];
  }
  return 4;
}

function compareReductionPriority(left, right) {
  const decisionDifference =
    reductionRank(left.decision) - reductionRank(right.decision);
  if (decisionDifference !== 0) return decisionDifference;

  const matrixDifference =
    priorityValue(
      MATRIX_PRIORITY_ORDER,
      left.matrixPriority,
      0
    ) -
    priorityValue(
      MATRIX_PRIORITY_ORDER,
      right.matrixPriority,
      0
    );
  if (matrixDifference !== 0) return matrixDifference;

  const abcDifference =
    priorityValue(ABC_PRIORITY_ORDER, left.abc, 0) -
    priorityValue(ABC_PRIORITY_ORDER, right.abc, 0);
  if (abcDifference !== 0) return abcDifference;

  const xyzDifference =
    priorityValue(XYZ_PRIORITY_ORDER, left.xyz, 0) -
    priorityValue(XYZ_PRIORITY_ORDER, right.xyz, 0);
  if (xyzDifference !== 0) return xyzDifference;

  const leftScore = left.decisionScore ?? 0;
  const rightScore = right.decisionScore ?? 0;
  if (leftScore !== rightScore) return leftScore - rightScore;

  const rowDifference =
    (right.sourceRow ?? -1) - (left.sourceRow ?? -1);
  if (rowDifference !== 0) return rowDifference;
  return left.sourceIndex - right.sourceIndex;
}

function lineView(item) {
  const optimizedAmount =
    item.optimizedQuantity * item.priceCents;
  const originalAmount =
    item.originalQuantity * item.priceCents;
  return {
    rowIdentity: item.rowIdentity,
    sourceRow: item.sourceRow,
    sku: item.sku,
    name: item.name,
    supplier: item.supplier,
    decision: item.decision,
    price: fromCents(item.priceCents),
    originalQuantity: item.originalQuantity,
    optimizedQuantity: item.optimizedQuantity,
    minimumQuantity: item.minimumQuantity,
    removedQuantity:
      item.originalQuantity - item.optimizedQuantity,
    originalAmount: fromCents(originalAmount),
    optimizedAmount: fromCents(optimizedAmount),
    removedAmount: fromCents(originalAmount - optimizedAmount),
    protectedReasons: [...item.protectedReasons],
  };
}

function reduceGroup(items, amountCents) {
  let remainingCents = amountCents;
  while (remainingCents > 0) {
    const reducible = items.filter(
      item => item.optimizedQuantity > item.minimumQuantity
    );
    if (reducible.length === 0) break;

    const affordable = reducible.filter(
      item => item.priceCents <= remainingCents
    );
    const selected = affordable.length > 0
      ? affordable.reduce((best, item) =>
        item.priceCents > best.priceCents ? item : best
      )
      : reducible.reduce((best, item) =>
        item.priceCents < best.priceCents ? item : best
      );
    const reducibleQuantity =
      selected.optimizedQuantity - selected.minimumQuantity;
    const quantityToRemove = selected.priceCents <= remainingCents
      ? Math.min(
        reducibleQuantity,
        Math.floor(remainingCents / selected.priceCents)
      )
      : 1;

    selected.optimizedQuantity -= quantityToRemove;
    remainingCents -= quantityToRemove * selected.priceCents;
  }
  return amountCents - remainingCents;
}

/**
 * Строит рабочие позиции оптимизации из канонического финального
 * состояния заказа (buildFinalOrderState). Оптимизируются только
 * включённые позиции с финальными количествами и ценами; нерешённая
 * ручная проверка блокирует оптимизацию.
 */
function finalOrderItems(state) {
  if (!state || typeof state !== 'object') {
    throw new BudgetOptimizerError(
      'BUDGET_OPTIMIZER_INVALID_INPUT',
      'Финальное состояние заказа не передано.'
    );
  }
  if (state.reviewComplete !== true) {
    throw new BudgetOptimizerError(
      'OWNER_REVIEW_INCOMPLETE',
      'Завершите ручную проверку всех позиций перед оптимизацией ' +
      'под бюджет.'
    );
  }
  if (!Array.isArray(state.includedItems)) {
    throw new BudgetOptimizerError(
      'BUDGET_OPTIMIZER_INVALID_INPUT',
      'Финальное состояние заказа не содержит includedItems.'
    );
  }

  return state.includedItems.map((entry, index) => {
    const quantity = nonNegativeInteger(
      entry?.quantity,
      `includedItems[${index}].quantity`
    );
    if (entry?.price === null || entry?.price === undefined) {
      throw new BudgetOptimizerError(
        'BUDGET_OPTIMIZER_INVALID_INPUT',
        `Для позиции «${entry?.name || entry?.sku || entry?.rowId ||
          index}» отсутствует закупочная цена; оптимизация под бюджет ` +
        'невозможна.'
      );
    }
    const priceCents = toCents(
      entry.price,
      `includedItems[${index}].price`
    );
    if (priceCents === 0) {
      throw new BudgetOptimizerError(
        'BUDGET_OPTIMIZER_INVALID_INPUT',
        `Цена includedItems[${index}] должна быть больше нуля.`
      );
    }

    const source = entry.source === 'manual' ? 'manual' : 'auto';
    return {
      rowIdentity: entry.rowId || null,
      sourceRow: null,
      sku: entry.sku || null,
      name: entry.name || null,
      supplier: entry.supplier || null,
      decision: source,
      priceCents,
      originalQuantity: quantity,
      optimizedQuantity: quantity,
      minimumQuantity: 0,
      protectedReasons: source === 'manual' ? ['OWNER_BUY'] : [],
      matrixPriority: null,
      abc: null,
      xyz: null,
      decisionScore: null,
      sourceIndex: index,
    };
  });
}

function optimizePurchasingBudget(input) {
  const targetBudgetCents = toCents(
    input?.targetBudget,
    'targetBudget'
  );
  const items = input?.finalOrder
    ? finalOrderItems(input.finalOrder)
    : sourceItems(agentJson(input?.agentResult));

  const originalTotalCents = items.reduce(
    (sum, item) => sum + item.originalQuantity * item.priceCents,
    0
  );
  const minimumPossibleCents = items.reduce(
    (sum, item) => sum + item.minimumQuantity * item.priceCents,
    0
  );
  const reductionTargetCents = Math.max(
    targetBudgetCents,
    minimumPossibleCents
  );
  let optimizedTotalCents = originalTotalCents;

  if (targetBudgetCents < originalTotalCents) {
    const candidates = items.filter(
      item => item.optimizedQuantity > item.minimumQuantity
    );
    const groups = new Map();
    for (const item of candidates) {
      const rank = reductionRank(item.decision);
      if (!groups.has(rank)) groups.set(rank, []);
      groups.get(rank).push(item);
    }

    for (const rank of [0, 1, 2, 3, 4]) {
      if (optimizedTotalCents <= reductionTargetCents) break;
      const group = groups.get(rank);
      if (!group) continue;
      group.sort(compareReductionPriority);
      const requiredReduction =
        optimizedTotalCents - reductionTargetCents;
      const groupCapacity = group.reduce(
        (sum, item) =>
          sum +
          (item.optimizedQuantity - item.minimumQuantity) *
            item.priceCents,
        0
      );

      if (groupCapacity <= requiredReduction) {
        for (const item of group) {
          item.optimizedQuantity = item.minimumQuantity;
        }
        optimizedTotalCents -= groupCapacity;
        continue;
      }

      optimizedTotalCents -= reduceGroup(group, requiredReduction);
    }
  }

  const status = targetBudgetCents >= originalTotalCents
    ? 'UNCHANGED'
    : targetBudgetCents < minimumPossibleCents
      ? 'BUDGET_TOO_LOW'
      : 'OPTIMIZED';
  const allViews = items.map(lineView);
  const optimizedItems = allViews.filter(
    item => item.optimizedQuantity > 0
  );
  const removedItems = allViews.filter(
    item => item.optimizedQuantity === 0
  );
  const reducedItemsCount = allViews.filter(
    item =>
      item.optimizedQuantity > 0 &&
      item.optimizedQuantity < item.originalQuantity
  ).length;
  const removedAmountCents =
    originalTotalCents - optimizedTotalCents;
  const warnings = status === 'BUDGET_TOO_LOW'
    ? ['TARGET_BUDGET_BELOW_MANDATORY_MINIMUM']
    : [];

  return {
    targetBudget: fromCents(targetBudgetCents),
    originalTotal: fromCents(originalTotalCents),
    optimizedTotal: fromCents(optimizedTotalCents),
    minimumPossibleTotal: fromCents(minimumPossibleCents),
    removedAmount: fromCents(removedAmountCents),
    status,
    changedItemsCount: removedItems.length + reducedItemsCount,
    removedItemsCount: removedItems.length,
    reducedItemsCount,
    items: optimizedItems,
    removedItems,
    warnings,
  };
}

module.exports = {
  BudgetOptimizerError,
  compareReductionPriority,
  optimizePurchasingBudget,
};
