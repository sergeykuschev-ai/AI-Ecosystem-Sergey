'use strict';

/**
 * Каноническая модель финального заказа «Миска».
 *
 * Единственный источник правды о финальном состоянии заказа после
 * Owner Review. Все потребители (UI summary, supplier-order API,
 * Excel, бюджет) обязаны использовать этот расчёт и не пересчитывать
 * заказ самостоятельно.
 *
 * Правила классификации позиций (явно зафиксированы):
 * - BUY с ручным количеством > 0 — включается (источник 'manual');
 * - BUY с количеством <= 0 — исключается ('zero_quantity');
 * - SKIP — исключается ('skipped');
 * - DEFER — исключается из текущего заказа ('deferred');
 * - без решения, owner_review_required — unresolved (блокирует заказ);
 * - auto_approved с approved_quantity > 0 — включается ('auto');
 * - всё остальное (no_order_action, confidently_excluded, postponed,
 *   pending_manual_review без owner_review_required, неопределённый
 *   статус, нулевое/отрицательное количество) — исключается
 *   ('no_order').
 *
 * Единственный источник истины о завершении ручной проверки:
 * unresolved ≡ owner_review_required === true && решение отсутствует.
 * Это тот же предикат, что у ownerDecisionSummary.needs_decision и у
 * вкладки «Нужно решить», поэтому needs_decision == 0 ⇔
 * reviewComplete == true ⇔ оптимизация и экспорт разрешены. Статус
 * workflow pending_manual_review сам по себе проверку не блокирует:
 * решение о том, какие позиции требуют внимания владельца, принимает
 * owner review (owner_review_required), а не конвейер workflowStatus.
 *
 * Правило дублей: идентичность позиции — rowIdentity строки, а не
 * артикул. Строки с одинаковым SKU — отдельные позиции заказа и
 * суммируются как отдельные строки. Одинаковый SKU у разных
 * поставщиков не смешивается: в рамках одного run все позиции
 * принадлежат одному расчёту.
 *
 * Округление единое: сумма строки = roundMoney(quantity × price),
 * итог = roundMoney(сумма округлённых строк).
 */

const FINAL_ORDER_STATUSES = Object.freeze([
  'ready',
  'review_incomplete',
  'empty',
]);

const EXCLUSION_REASONS = Object.freeze([
  'skipped',
  'deferred',
  'zero_quantity',
  'no_order',
]);

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function ownerDecisionOf(item) {
  const decision = item?.owner_decision?.decision;
  return typeof decision === 'string' ? decision : null;
}

/**
 * Обязательный ассортимент: позиция помечена как mandatory в политике
 * ассортимента. Поддерживаются как канонический путь из purchasing item
 * mapper (`assortment_policy.mandatory_assortment`), так и возможный
 * альтернативный путь (`assortment.mandatory`).
 */
function isMandatoryItem(item) {
  return item?.assortment_policy?.mandatory_assortment === true ||
    item?.assortment?.mandatory === true;
}

function roundUpToMultiple(value, multiple) {
  return Math.ceil(value / multiple) * multiple;
}

/**
 * Применяет правила упаковки (кратность короба / целое число штук)
 * к количеству включённой позиции. Возвращает скорректированное
 * количество и диагностики.
 */
function applyPackagingRules(item, quantity) {
  const quantityDiagnostics = [];
  const orderMode = item?.assortment_policy?.order_mode || null;
  const boxQty = finiteNumber(item?.assortment_policy?.box_qty);
  const maxStock = finiteNumber(item?.assortment_policy?.max_stock);

  if (orderMode === 'BOX' && boxQty !== null && boxQty > 1) {
    const rounded = roundUpToMultiple(quantity, boxQty);
    if (maxStock !== null && maxStock > 0 && rounded > maxStock) {
      quantityDiagnostics.push({
        code: 'BOX_MULTIPLICITY_MAX_CONFLICT',
        severity: 'warning',
        details: {
          original_quantity: quantity,
          box_qty: boxQty,
          rounded_quantity: rounded,
          max_stock: maxStock,
        },
      });
      return { quantity: maxStock, quantityDiagnostics, orderMode };
    }
    return { quantity: rounded, quantityDiagnostics, orderMode };
  }

  if (orderMode === 'PIECE' && !Number.isInteger(quantity)) {
    const rounded = Math.round(quantity);
    quantityDiagnostics.push({
      code: 'PIECE_QUANTITY_FRACTIONAL',
      severity: 'warning',
      details: {
        original_quantity: quantity,
        rounded_quantity: rounded,
      },
    });
    return { quantity: rounded, quantityDiagnostics, orderMode };
  }

  return { quantity, quantityDiagnostics, orderMode };
}

/**
 * Рекомендованное количество позиции для справочных сумм исключённых
 * позиций: ручное количество BUY, затем approved, provisional,
 * calculated, analyzer. Не влияет на включённые позиции.
 */
function referenceQuantity(item) {
  return finiteNumber(item?.owner_decision?.decision === 'BUY'
    ? item?.owner_decision?.quantity
    : null) ??
    finiteNumber(item?.quantities?.approved_quantity) ??
    finiteNumber(item?.quantities?.provisional_quantity) ??
    finiteNumber(item?.quantities?.calculated_quantity) ??
    finiteNumber(item?.quantities?.analyzer_quantity) ??
    0;
}

function classifyItem(item) {
  const decision = ownerDecisionOf(item);
  if (decision === 'BUY') {
    const quantity = finiteNumber(item?.owner_decision?.quantity);
    return quantity !== null && quantity > 0
      ? { kind: 'included', source: 'manual', quantity }
      : { kind: 'excluded', reason: 'zero_quantity' };
  }
  if (decision === 'SKIP') return { kind: 'excluded', reason: 'skipped' };
  if (decision === 'DEFER') {
    return { kind: 'excluded', reason: 'deferred' };
  }
  if (item?.matrix?.owner_review_required === true) {
    return { kind: 'unresolved', reason: 'review_required' };
  }
  if (item?.workflow_status === 'auto_approved') {
    const quantity = finiteNumber(item?.quantities?.approved_quantity);
    if (quantity !== null && quantity > 0) {
      return { kind: 'included', source: 'auto', quantity };
    }
  }
  return { kind: 'excluded', reason: 'no_order' };
}

function includedEntry(item, classification, packaging) {
  const protectedReasons = [];
  if (classification.source === 'manual') {
    protectedReasons.push('OWNER_BUY');
  }
  if (isMandatoryItem(item)) {
    protectedReasons.push('MANDATORY_ASSORTMENT');
  }
  return {
    rowId: item?.row_id ?? null,
    sku: item?.sku ?? '',
    name: item?.name ?? '',
    barcode: item?.barcode || null,
    brand: item?.brand || null,
    supplier: item?.supplier || null,
    quantity: classification.quantity,
    orderMode: packaging.orderMode,
    price: finiteNumber(item?.amounts?.unit_price),
    source: classification.source,
    protected: protectedReasons.length > 0,
    protectedReasons,
    quantityDiagnostics: packaging.quantityDiagnostics,
  };
}

function excludedEntry(item, classification) {
  const price = finiteNumber(item?.amounts?.unit_price);
  const quantity = referenceQuantity(item);
  return {
    rowId: item?.row_id ?? null,
    sku: item?.sku ?? '',
    name: item?.name ?? '',
    reason: classification.reason,
    referenceQuantity: quantity,
    price,
    referenceAmount:
      price !== null && quantity > 0 ? roundMoney(quantity * price) : 0,
  };
}

function unresolvedEntry(item, classification) {
  return {
    rowId: item?.row_id ?? null,
    sku: item?.sku ?? '',
    name: item?.name ?? '',
    reason: classification.reason,
    referenceAmount: excludedEntry(item, {
      reason: classification.reason,
    }).referenceAmount,
  };
}

/**
 * Строит каноническое финальное состояние заказа.
 *
 * @param {object} input
 * @param {Array} input.items — decorated позиции run
 *   (RunQueryService.getDecoratedItems).
 * @param {number|null} [input.maximumSafeOrderAmount] — безопасный
 *   бюджет из финансового снимка run; null, если неизвестен.
 * @param {object|null} [input.initialRecommendation] — исходная
 *   рекомендация агента (snapshot) для отображения рядом с итогом.
 */
function buildFinalOrderState(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const includedItems = [];
  const excludedItems = [];
  const unresolvedItems = [];

  for (const item of items) {
    const classification = classifyItem(item);
    if (classification.kind === 'included') {
      const packaging = applyPackagingRules(item, classification.quantity);
      const entry = includedEntry(
        item,
        { ...classification, quantity: packaging.quantity },
        packaging
      );
      entry.amount = entry.price !== null
        ? roundMoney(entry.quantity * entry.price)
        : null;
      includedItems.push(entry);
    } else if (classification.kind === 'unresolved') {
      unresolvedItems.push(unresolvedEntry(item, classification));
    } else {
      excludedItems.push(excludedEntry(item, classification));
    }
  }

  const sumIncluded = selector =>
    roundMoney(includedItems.reduce((sum, entry) =>
      sum + (selector(entry) ? entry.amount ?? 0 : 0), 0));
  const sumExcluded = reason =>
    roundMoney(excludedItems.reduce((sum, entry) =>
      sum + (entry.reason === reason ? entry.referenceAmount : 0), 0));

  const totalAmount = roundMoney(
    includedItems.reduce((sum, entry) => sum + (entry.amount ?? 0), 0)
  );
  const unresolvedCount = unresolvedItems.length;
  const reviewComplete = unresolvedCount === 0;
  const maximumSafe = finiteNumber(input.maximumSafeOrderAmount);
  const includedSkus = new Map();
  for (const entry of includedItems) {
    if (entry.sku) {
      includedSkus.set(entry.sku, (includedSkus.get(entry.sku) || 0) + 1);
    }
  }
  const duplicateIncludedSkus = Array.from(includedSkus.entries())
    .filter(([, count]) => count > 1)
    .map(([sku]) => sku);

  return {
    status: !reviewComplete
      ? 'review_incomplete'
      : includedItems.length === 0
        ? 'empty'
        : 'ready',
    reviewComplete,
    includedItems,
    excludedItems,
    unresolvedItems,
    itemCount: includedItems.length,
    totalQuantity: includedItems.reduce(
      (sum, entry) => sum + entry.quantity, 0
    ),
    totalAmount,
    autoApprovedAmount: sumIncluded(entry => entry.source === 'auto'),
    manuallyApprovedAmount: sumIncluded(entry =>
      entry.source === 'manual'
    ),
    skippedAmount: sumExcluded('skipped'),
    deferredAmount: sumExcluded('deferred'),
    unresolvedCount,
    unresolvedAmount: roundMoney(unresolvedItems.reduce(
      (sum, entry) => sum + entry.referenceAmount, 0
    )),
    missingPriceIncludedCount: includedItems.filter(
      entry => entry.price === null
    ).length,
    duplicateIncludedSkus,
    remainingBudget: maximumSafe !== null
      ? roundMoney(maximumSafe - totalAmount)
      : null,
    initialRecommendation: input.initialRecommendation || null,
  };
}

module.exports = {
  EXCLUSION_REASONS,
  FINAL_ORDER_STATUSES,
  applyPackagingRules,
  buildFinalOrderState,
  classifyItem,
  referenceQuantity,
  roundMoney,
};
