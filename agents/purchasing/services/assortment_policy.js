'use strict';

const ASSORTMENT_STATUSES = Object.freeze([
  'CORE',
  'OPTIONAL',
  'TEST',
  'EXIT',
]);
const ORDER_MODES = Object.freeze(['PIECE', 'BOX']);
const POLICY_RULES = Object.freeze({
  NONE: 'NONE',
  EXIT: 'EXIT',
  PURCHASE_HOLD: 'PURCHASE_HOLD',
  MAX_STOCK: 'MAX_STOCK',
  MANDATORY_ASSORTMENT: 'MANDATORY_ASSORTMENT',
});

class AssortmentPolicyError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AssortmentPolicyError';
    this.code = code;
  }
}

function invalid(message) {
  throw new AssortmentPolicyError('INVALID_ASSORTMENT_POLICY', message);
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function nullableNumber(value, field, options = {}) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (options.integer && !Number.isInteger(value))
  ) {
    invalid(`${field} должен быть неотрицательным${options.integer ? ' целым' : ''} числом или null.`);
  }
  return value;
}

function requiredBoolean(value, field) {
  if (typeof value !== 'boolean') invalid(`${field} должен быть boolean.`);
  return value;
}

function optionalString(value, field, options = {}) {
  if (value === null || value === undefined) return options.nullable ? null : '';
  if (typeof value !== 'string') invalid(`${field} должен быть строкой.`);
  const normalized = value.trim();
  if (options.required && normalized === '') invalid(`${field} не должен быть пустым.`);
  return normalized;
}

function validateTimestamp(value, field) {
  const normalized = optionalString(value, field, { required: true });
  if (!Number.isFinite(Date.parse(normalized))) {
    invalid(`${field} должен содержать ISO timestamp.`);
  }
  return normalized;
}

function validateAssortmentPolicyRule(value) {
  if (!plainObject(value)) invalid('Правило должно быть объектом.');
  const sku = optionalString(value.sku, 'sku', { required: true });
  const status = optionalString(
    value.assortment_status,
    `assortment_status для ${sku}`,
    { required: true }
  ).toUpperCase();
  if (!ASSORTMENT_STATUSES.includes(status)) {
    invalid(`Неизвестный assortment_status для ${sku}: ${status}.`);
  }
  const orderMode = optionalString(
    value.order_mode,
    `order_mode для ${sku}`,
    { required: true }
  ).toUpperCase();
  if (!ORDER_MODES.includes(orderMode)) {
    invalid(`Неизвестный order_mode для ${sku}: ${orderMode}.`);
  }
  const minStock = nullableNumber(value.min_stock, `min_stock для ${sku}`);
  const maxStock = nullableNumber(value.max_stock, `max_stock для ${sku}`);
  const targetStock = nullableNumber(value.target_stock, `target_stock для ${sku}`);
  const boxQty = nullableNumber(value.box_qty, `box_qty для ${sku}`, {
    integer: true,
  });
  const displayMinQty = nullableNumber(
    value.display_min_qty,
    `display_min_qty для ${sku}`
  );
  const holdUntil = nullableNumber(
    value.purchase_hold_until_stock,
    `purchase_hold_until_stock для ${sku}`
  );
  if (minStock !== null && maxStock !== null && minStock > maxStock) {
    invalid(`min_stock не может превышать max_stock для ${sku}.`);
  }
  if (
    targetStock !== null &&
    ((minStock !== null && targetStock < minStock) ||
      (maxStock !== null && targetStock > maxStock))
  ) {
    invalid(`target_stock должен находиться между min_stock и max_stock для ${sku}.`);
  }
  if (orderMode === 'BOX' && (boxQty === null || boxQty < 1)) {
    invalid(`order_mode=BOX требует положительный box_qty для ${sku}.`);
  }
  return {
    sku,
    assortment_status: status,
    min_stock: minStock,
    max_stock: maxStock,
    target_stock: targetStock,
    order_mode: orderMode,
    box_qty: boxQty,
    display_stock: requiredBoolean(value.display_stock, `display_stock для ${sku}`),
    display_min_qty: displayMinQty,
    purchase_hold: requiredBoolean(value.purchase_hold, `purchase_hold для ${sku}`),
    purchase_hold_until_stock: holdUntil,
    mandatory_assortment: requiredBoolean(
      value.mandatory_assortment,
      `mandatory_assortment для ${sku}`
    ),
    owner_comment: optionalString(value.owner_comment, `owner_comment для ${sku}`),
    rule_source: optionalString(value.rule_source, `rule_source для ${sku}`, {
      required: true,
    }),
    updated_at: validateTimestamp(value.updated_at, `updated_at для ${sku}`),
    canonical: value.canonical || null,
  };
}

function validateAssortmentPolicyStore(value) {
  if (!plainObject(value)) invalid('Файл assortment policy должен быть объектом.');
  if (value.version !== 1) invalid('Поддерживается только assortment policy version=1.');
  const updatedAt = validateTimestamp(value.updated_at, 'updated_at');
  if (!Array.isArray(value.rules)) invalid('rules должен быть массивом.');
  const rules = value.rules.map(validateAssortmentPolicyRule);
  const seen = new Set();
  for (const rule of rules) {
    const key = rule.sku.trim().toUpperCase();
    if (seen.has(key)) invalid(`Повторяющийся SKU в assortment policy: ${rule.sku}.`);
    seen.add(key);
  }
  return { version: 1, updated_at: updatedAt, rules };
}

function normalizeSku(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function policyIndex(store) {
  return new Map(
    validateAssortmentPolicyStore(store).rules.map(rule => [
      normalizeSku(rule.sku),
      rule,
    ])
  );
}

function buildRulesIndex(store) {
  if (store && store.schema_version === 'miska-canonical-assortment-matrix-v1') {
    return new Map(
      store.rules.map(rule => [normalizeSku(rule.sku), rule])
    );
  }
  return policyIndex(store);
}

function policyView(rule) {
  if (!rule) return null;
  const {
    sku,
    updated_at: updatedAt,
    ...view
  } = rule;
  return { ...view, sku, updated_at: updatedAt };
}

function collectProductCandidateIds(product) {
  if (!product || typeof product !== 'object') return [];
  const candidates = [];
  if (product.article) {
    candidates.push({ type: 'article', value: normalizeSku(product.article) });
  }
  if (product.matchingHints?.barcode) {
    candidates.push({ type: 'barcode', value: normalizeSku(product.matchingHints.barcode) });
  }
  if (product.matchingHints?.internalProductId) {
    candidates.push({ type: 'internalProductId', value: normalizeSku(product.matchingHints.internalProductId) });
  }
  if (product.sku) {
    candidates.push({ type: 'sku', value: normalizeSku(product.sku) });
  }
  if (product.supplierSku) {
    candidates.push({ type: 'supplierSku', value: normalizeSku(product.supplierSku) });
  }
  return candidates;
}

function findRuleByCandidateIds(product, rules) {
  for (const candidate of collectProductCandidateIds(product)) {
    if (!candidate.value) continue;
    const matchedRule = rules.get(candidate.value);
    if (matchedRule) return { rule: matchedRule, matchedBy: candidate.type };
  }
  return null;
}

function isActiveAssortmentRule(rule) {
  return rule && rule.assortment_status !== 'EXIT';
}

function buildUnmatchedActiveRuleDiagnostics(rules, matchedRuleSkus) {
  const diagnostics = [];
  for (const rule of rules.values()) {
    if (!isActiveAssortmentRule(rule)) continue;
    if (matchedRuleSkus.has(normalizeSku(rule.sku))) continue;
    diagnostics.push({
      code: 'UNMATCHED_ASSORTMENT_POLICY_RULE',
      sku: rule.sku,
      assortmentStatus: rule.assortment_status,
      severity: 'warning',
    });
    if (rule.mandatory_assortment) {
      diagnostics.push({
        code: 'MANDATORY_SKU_MISSING_FROM_SOURCE',
        sku: rule.sku,
        severity: 'warning',
      });
    }
  }
  return diagnostics;
}

function classifyAssortmentPolicyError(error, product) {
  const codes = [];
  const message = error?.message || '';
  const availableStock = product?.availableStock ?? product?.freeStock ?? null;
  if (typeof availableStock === 'number' && availableStock < 0) {
    codes.push('NEGATIVE_STOCK');
  }
  if (
    message.includes('current_stock') ||
    message.includes('minmax_qty') ||
    message.includes('не может превышать') ||
    message.includes('должен находиться между') ||
    message.includes('Неизвестный')
  ) {
    codes.push('DATA_INVALID');
  }
  if (
    message.includes('не должен быть пустым') ||
    message.includes('требует')
  ) {
    codes.push('MISSING_CRITICAL_FIELD');
  }
  if (codes.length === 0) {
    codes.push('DATA_INVALID');
  }
  return codes;
}

function isolatedRowDiagnostic(product, error, reasonCodes, index) {
  const sku =
    product?.article ||
    product?.sku ||
    product?.matchingHints?.barcode ||
    product?.matchingHints?.internalProductId ||
    product?.supplierSku ||
    null;
  return {
    code: 'ISOLATED_ROW_DATA_INVALID',
    sku,
    rowIdentity: product?.rowIdentity ?? null,
    rowNumber: product?.rowNumber ?? index + 1,
    reasonCodes,
    severity: 'warning',
    cause: error.message,
  };
}

function isolatedAssortmentPolicyProduct(product, error, reasonCodes) {
  return {
    ...product,
    workflow_status: 'manual_review',
    reason_codes: reasonCodes,
    approved_quantity: 0,
    finalRecommendedQuantity: 0,
    minmaxRecommendedQuantity: product?.finalRecommendedQuantity ?? null,
    assortmentPolicy: {
      matched: false,
      policy_rule: POLICY_RULES.NONE,
      policy_qty: 0,
      policy_adjusted: false,
      projected_stock: null,
      policy_warnings: [],
      error: error.message,
    },
  };
}

function noRuleResult(minmaxQty, currentStock, warnings = []) {
  return {
    minmax_qty: minmaxQty,
    policy_qty: minmaxQty,
    mandatory_minimum_gap: null,
    policy_rule: POLICY_RULES.NONE,
    applied_rules: [],
    explanation: 'Ассортиментное правило отсутствует: рекомендация Min/Max сохранена.',
    policy_adjusted: false,
    projected_stock: currentStock !== null && minmaxQty !== null
      ? currentStock + minmaxQty
      : null,
    policy_warnings: warnings,
    matched: false,
    rule: null,
    canonical: null,
  };
}

function applyAssortmentPolicy(input = {}) {
  const minmaxQty = input.minmax_qty;
  if (
    minmaxQty !== null &&
    minmaxQty !== undefined &&
    (typeof minmaxQty !== 'number' || !Number.isFinite(minmaxQty) || minmaxQty < 0)
  ) {
    invalid('minmax_qty должен быть неотрицательным числом или null.');
  }
  const normalizedMinmax = minmaxQty ?? null;
  const currentStock = input.current_stock;
  if (
    currentStock !== null &&
    currentStock !== undefined &&
    (typeof currentStock !== 'number' || !Number.isFinite(currentStock) || currentStock < 0)
  ) {
    invalid('current_stock должен быть неотрицательным числом или null.');
  }
  const stock = currentStock ?? null;
  if (!input.rule) return noRuleResult(normalizedMinmax, stock);
  const rule = validateAssortmentPolicyRule(input.rule);
  const warnings = [];
  const appliedRules = [];
  let quantity = normalizedMinmax;
  let mandatoryMinimumGap = null;
  let mainRule = POLICY_RULES.NONE;
  let explanation = `Min/Max предложил ${normalizedMinmax ?? 'неопределённое количество'} шт. Политика не изменила рекомендацию.`;

  if (rule.assortment_status === 'EXIT') {
    quantity = 0;
    mainRule = POLICY_RULES.EXIT;
    appliedRules.push(POLICY_RULES.EXIT);
    explanation = `Min/Max предложил ${normalizedMinmax ?? 0} шт. Заказ отменён: позиция имеет статус EXIT и не должна пополняться.`;
  } else {
    const holdActive = rule.purchase_hold && (
      rule.purchase_hold_until_stock === null ||
      (stock !== null && stock > rule.purchase_hold_until_stock)
    );
    if (rule.purchase_hold && stock === null && rule.purchase_hold_until_stock !== null) {
      warnings.push('CURRENT_STOCK_REQUIRED_FOR_PURCHASE_HOLD');
    }
    if (holdActive) {
      quantity = 0;
      mainRule = POLICY_RULES.PURCHASE_HOLD;
      appliedRules.push(POLICY_RULES.PURCHASE_HOLD);
      explanation = rule.purchase_hold_until_stock === null
        ? `Min/Max предложил ${normalizedMinmax ?? 0} шт. Заказ отменён: действует полный временный запрет закупки.`
        : `Min/Max предложил ${normalizedMinmax ?? 0} шт. Заказ отменён: текущий остаток ${stock} шт., действует запрет до снижения остатка до ${rule.purchase_hold_until_stock} шт.`;
    } else {
      if (quantity === null) warnings.push('MINMAX_QUANTITY_UNAVAILABLE');

      if (quantity !== null && stock !== null && rule.max_stock !== null) {
        const capped = Math.max(0, Math.min(quantity, rule.max_stock - stock));
        if (capped !== quantity) {
          quantity = capped;
          mainRule = POLICY_RULES.MAX_STOCK;
          appliedRules.push(POLICY_RULES.MAX_STOCK);
          explanation = `Min/Max предложил ${normalizedMinmax ?? 0} шт. Количество снижено до ${quantity} шт., чтобы итоговый остаток не превысил MAX ${rule.max_stock}.`;
        }
      } else if (rule.max_stock !== null && stock === null) {
        warnings.push('CURRENT_STOCK_REQUIRED_FOR_MAX');
      }

      if (
        rule.mandatory_assortment &&
        stock !== null &&
        rule.min_stock !== null
      ) {
        const replenishTo = rule.target_stock ?? rule.min_stock;
        mandatoryMinimumGap = stock < rule.min_stock
          ? Math.max(0, replenishTo - stock)
          : 0;
        const restored = Math.max(quantity ?? 0, mandatoryMinimumGap);
        if (mandatoryMinimumGap > 0 && restored !== quantity) {
          quantity = restored;
          mainRule = POLICY_RULES.MANDATORY_ASSORTMENT;
          appliedRules.push(POLICY_RULES.MANDATORY_ASSORTMENT);
          explanation = `Min/Max предложил ${normalizedMinmax ?? 0} шт. Добавлено ${quantity} шт.: обязательная ассортиментная позиция ниже MIN, целевой остаток ${replenishTo} шт.`;
        }
      } else if (rule.mandatory_assortment && stock === null) {
        warnings.push('CURRENT_STOCK_REQUIRED_FOR_MANDATORY_ASSORTMENT');
      }

      if (quantity !== null && stock !== null && rule.max_stock !== null) {
        const capped = Math.max(0, Math.min(quantity, rule.max_stock - stock));
        if (capped !== quantity) {
          quantity = capped;
          mainRule = POLICY_RULES.MAX_STOCK;
          if (!appliedRules.includes(POLICY_RULES.MAX_STOCK)) {
            appliedRules.push(POLICY_RULES.MAX_STOCK);
          }
          explanation = `Min/Max предложил ${normalizedMinmax ?? 0} шт. Итог ограничен ${quantity} шт., чтобы не превысить MAX ${rule.max_stock}.`;
        }
      }
    }
  }

  return {
    minmax_qty: normalizedMinmax,
    policy_qty: quantity,
    mandatory_minimum_gap: mandatoryMinimumGap,
    policy_rule: mainRule,
    applied_rules: appliedRules,
    explanation,
    policy_adjusted: quantity !== normalizedMinmax,
    projected_stock: stock !== null && quantity !== null
      ? stock + quantity
      : null,
    policy_warnings: warnings,
    matched: true,
    rule: policyView(rule),
    canonical: rule.canonical,
    ...policyView(rule),
  };
}

function applyAssortmentPolicyToProducts(products, store, runContext = {}) {
  if (!Array.isArray(products)) {
    throw new TypeError('Assortment Policy требует массив products.');
  }
  const rules = buildRulesIndex(store);
  const matchedRuleSkus = new Set();
  const isolatedRowDiagnostics = [];
  const resultProducts = products.map((product, index) => {
    const match = findRuleByCandidateIds(product, rules);
    const matchedRule = match ? match.rule : null;
    if (matchedRule) {
      matchedRuleSkus.add(normalizeSku(matchedRule.sku));
    }
    try {
      const sku = matchedRule
        ? matchedRule.sku
        : (product.article ||
            product.matchingHints?.barcode ||
            product.matchingHints?.internalProductId ||
            product.sku ||
            product.supplierSku ||
            null);
      const result = applyAssortmentPolicy({
        sku,
        current_stock: product.availableStock ?? null,
        minmax_qty: product.finalRecommendedQuantity,
        rule: matchedRule,
        run_context: runContext,
      });
      return {
        ...product,
        minmaxRecommendedQuantity: result.minmax_qty,
        finalRecommendedQuantity: result.policy_qty,
        mandatoryMinimumGap: result.mandatory_minimum_gap === null
          ? product.mandatoryMinimumGap
          : Math.max(product.mandatoryMinimumGap ?? 0, result.mandatory_minimum_gap),
        assortmentPolicy: result,
        mandatoryAssortment: result.matched && result.mandatory_assortment
          ? true
          : product.mandatoryAssortment,
      };
    } catch (error) {
      const reasonCodes = classifyAssortmentPolicyError(error, product);
      isolatedRowDiagnostics.push(
        isolatedRowDiagnostic(product, error, reasonCodes, index)
      );
      return isolatedAssortmentPolicyProduct(product, error, reasonCodes);
    }
  });
  resultProducts.unmatchedActiveRules = buildUnmatchedActiveRuleDiagnostics(
    rules,
    matchedRuleSkus
  );
  resultProducts.isolatedRowDiagnostics = isolatedRowDiagnostics;
  return resultProducts;
}

module.exports = {
  ASSORTMENT_STATUSES,
  AssortmentPolicyError,
  ORDER_MODES,
  POLICY_RULES,
  applyAssortmentPolicy,
  applyAssortmentPolicyToProducts,
  buildRulesIndex,
  normalizeSku,
  policyIndex,
  validateAssortmentPolicyRule,
  validateAssortmentPolicyStore,
};
