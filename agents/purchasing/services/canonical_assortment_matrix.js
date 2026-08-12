'use strict';

const ASSORTMENT_STATUSES = Object.freeze([
  'CORE',
  'OPTIONAL',
  'TEST',
  'EXIT',
]);

const ONE_C_STATUSES = Object.freeze([
  'CONFIRMED',
  'CHECK',
  'SEPARATE',
  'PENDING_1C',
]);

const SEASONALITY_TYPES = Object.freeze([
  'year_round',
  'periods',
]);

const ROLLOUT_STATUSES = Object.freeze([
  'NEW',
  'FIRST_ROLLOUT',
  'MONITORING',
  'ACTIVE',
]);

const DEFAULT_ROLLOUT_STATUS = 'ACTIVE';
const DEFAULT_REVIEW_AFTER_DAYS = 30;

class CanonicalAssortmentMatrixError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'CanonicalAssortmentMatrixError';
    this.code = code;
  }
}

function invalid(message) {
  throw new CanonicalAssortmentMatrixError('INVALID_CANONICAL_MATRIX', message);
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid(`${field} должен быть непустой строкой.`);
  }
  return value.trim();
}

function optionalString(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid(`${field} должен быть строкой.`);
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function nonNegativeInteger(value, field) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    invalid(`${field} должен быть неотрицательным целым числом.`);
  }
  return value;
}

function optionalNonNegativeInteger(value, field) {
  if (value === null || value === undefined) return null;
  return nonNegativeInteger(value, field);
}

function nonNegativeNumber(value, field) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    invalid(`${field} должен быть неотрицательным числом.`);
  }
  return value;
}

function optionalNonNegativeNumber(value, field) {
  if (value === null || value === undefined) return null;
  return nonNegativeNumber(value, field);
}

function requiredBoolean(value, field) {
  if (typeof value !== 'boolean') invalid(`${field} должен быть boolean.`);
  return value;
}

function isoTimestamp(value, field) {
  const normalized = requiredString(value, field);
  if (!Number.isFinite(Date.parse(normalized))) {
    invalid(`${field} должен содержать ISO timestamp.`);
  }
  return normalized;
}

function optionalIsoDate(value, field) {
  if (value === null || value === undefined) return null;
  const normalized = requiredString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    invalid(`${field} должен иметь формат YYYY-MM-DD.`);
  }
  if (!Number.isFinite(Date.parse(normalized))) {
    invalid(`${field} содержит некорректную дату.`);
  }
  return normalized;
}

function validateEnum(value, allowed, field) {
  const normalized = requiredString(value, field).toUpperCase();
  if (!allowed.includes(normalized)) {
    invalid(`${field} должен быть одним из: ${allowed.join(', ')}.`);
  }
  return normalized;
}

function validateSeasonality(value, sku) {
  if (!plainObject(value)) {
    invalid(`seasonality для ${sku} должен быть объектом.`);
  }
  const type = requiredString(value.type, `seasonality.type для ${sku}`).toLowerCase();
  if (!SEASONALITY_TYPES.includes(type)) {
    invalid(`seasonality.type для ${sku} должен быть one of: ${SEASONALITY_TYPES.join(', ')}.`);
  }
  if (type === 'year_round') {
    const coefficient = value.coefficient === undefined || value.coefficient === null
      ? 1.0
      : nonNegativeNumber(value.coefficient, `seasonality.coefficient для ${sku}`);
    if (coefficient === 0) {
      invalid(`seasonality.coefficient для ${sku} не может быть равен нулю.`);
    }
    return { type: 'year_round', coefficient };
  }

  // type === 'periods'
  if (!Array.isArray(value.periods)) {
    invalid(`seasonality.periods для ${sku} должен быть массивом.`);
  }
  const periods = value.periods.map((period, index) =>
    validateSeasonalityPeriod(period, sku, index)
  );
  return { type: 'periods', periods };
}

function validateSeasonalityPeriod(period, sku, index) {
  const prefix = `seasonality.periods[${index}] для ${sku}`;
  if (!plainObject(period)) invalid(`${prefix} должен быть объектом.`);
  const name = optionalString(period.name, `${prefix}.name`) ?? `period-${index}`;
  const startMonth = nonNegativeInteger(period.start_month, `${prefix}.start_month`);
  const startDay = nonNegativeInteger(period.start_day, `${prefix}.start_day`);
  const endMonth = nonNegativeInteger(period.end_month, `${prefix}.end_month`);
  const endDay = nonNegativeInteger(period.end_day, `${prefix}.end_day`);
  if (startMonth < 1 || startMonth > 12) {
    invalid(`${prefix}.start_month должен быть от 1 до 12.`);
  }
  if (endMonth < 1 || endMonth > 12) {
    invalid(`${prefix}.end_month должен быть от 1 до 12.`);
  }
  if (startDay < 1 || startDay > 31) {
    invalid(`${prefix}.start_day должен быть от 1 до 31.`);
  }
  if (endDay < 1 || endDay > 31) {
    invalid(`${prefix}.end_day должен быть от 1 до 31.`);
  }
  const coefficient = nonNegativeNumber(period.coefficient, `${prefix}.coefficient`);
  if (coefficient === 0) {
    invalid(`${prefix}.coefficient не может быть равен нулю.`);
  }
  return {
    name,
    start_month: startMonth,
    start_day: startDay,
    end_month: endMonth,
    end_day: endDay,
    coefficient,
  };
}

function validateCanonicalItem(value, index) {
  const prefix = `items[${index}]`;
  if (!plainObject(value)) invalid(`${prefix} должен быть объектом.`);

  const skuId = requiredString(value.sku_id, `${prefix}.sku_id`).toUpperCase();
  const supplier = optionalString(value.supplier, `${prefix}.supplier`);
  const supplierSku = optionalString(value.supplier_sku, `${prefix}.supplier_sku`);
  const brand = optionalString(value.brand, `${prefix}.brand`);
  const category = optionalString(value.category, `${prefix}.category`);
  const subcategory = optionalString(value.subcategory, `${prefix}.subcategory`);

  const rolloutStatus = value.rollout_status === undefined || value.rollout_status === null
    ? DEFAULT_ROLLOUT_STATUS
    : validateEnum(
        value.rollout_status,
        ROLLOUT_STATUSES,
        `${prefix}.rollout_status`
      );
  const reviewAfterDays = value.review_after_days === undefined || value.review_after_days === null
    ? DEFAULT_REVIEW_AFTER_DAYS
    : nonNegativeInteger(
        value.review_after_days,
        `${prefix}.review_after_days`
      );

  const assortmentStatus = validateEnum(
    value.assortment_status,
    ASSORTMENT_STATUSES,
    `${prefix}.assortment_status`
  );

  const mandatoryAssortment = requiredBoolean(
    value.mandatory_assortment,
    `${prefix}.mandatory_assortment`
  );
  const purchaseHold = requiredBoolean(
    value.purchase_hold,
    `${prefix}.purchase_hold`
  );

  const minDisplay = optionalNonNegativeInteger(
    value.min_display,
    `${prefix}.min_display`
  );
  const minStock = value.min_stock === undefined || value.min_stock === null
    ? null
    : nonNegativeInteger(value.min_stock, `${prefix}.min_stock`);
  const maxStock = value.max_stock === undefined || value.max_stock === null
    ? null
    : nonNegativeInteger(value.max_stock, `${prefix}.max_stock`);
  const targetStock = value.target_stock === undefined || value.target_stock === null
    ? null
    : nonNegativeInteger(value.target_stock, `${prefix}.target_stock`);

  if (minStock !== null && maxStock !== null && minStock > maxStock) {
    invalid(`${prefix}.min_stock не может превышать max_stock.`);
  }
  if (
    targetStock !== null &&
    ((minStock !== null && targetStock < minStock) ||
      (maxStock !== null && targetStock > maxStock))
  ) {
    invalid(`${prefix}.target_stock должен быть между min_stock и max_stock.`);
  }

  const boxQty = value.box_qty === undefined || value.box_qty === null
    ? 0
    : nonNegativeInteger(value.box_qty, `${prefix}.box_qty`);
  const purchaseHoldUntilStock = value.purchase_hold_until_stock === undefined || value.purchase_hold_until_stock === null
    ? null
    : nonNegativeInteger(
        value.purchase_hold_until_stock,
        `${prefix}.purchase_hold_until_stock`
      );
  const leadTimeDays = nonNegativeInteger(
    value.lead_time_days,
    `${prefix}.lead_time_days`
  );
  const orderCycleDays = nonNegativeInteger(
    value.order_cycle_days,
    `${prefix}.order_cycle_days`
  );

  const seasonality = validateSeasonality(
    value.seasonality || { type: 'year_round', coefficient: 1.0 },
    skuId
  );

  const testStartDate = optionalIsoDate(
    value.test_start_date,
    `${prefix}.test_start_date`
  );
  const testReviewDate = optionalIsoDate(
    value.test_review_date,
    `${prefix}.test_review_date`
  );

  if (assortmentStatus === 'TEST') {
    if (testStartDate && testReviewDate && testReviewDate <= testStartDate) {
      invalid(`${prefix}.test_review_date должен быть позже test_start_date.`);
    }
  } else if (testStartDate || testReviewDate) {
    invalid(`${prefix}: даты TEST разрешены только при assortment_status=TEST.`);
  }

  const ruleReason = optionalString(value.rule_reason, `${prefix}.rule_reason`);
  const ruleChangedAt = isoTimestamp(
    value.rule_changed_at,
    `${prefix}.rule_changed_at`
  );
  const ruleChangedBy = requiredString(
    value.rule_changed_by,
    `${prefix}.rule_changed_by`
  );

  // Опциональные поля для будущих правил
  const oneCStatus = value.one_c_status === undefined || value.one_c_status === null
    ? null
    : validateEnum(value.one_c_status, ONE_C_STATUSES, `${prefix}.one_c_status`);
  const priceDate = optionalIsoDate(value.price_date, `${prefix}.price_date`);
  const isPremiumPet = value.is_premium_pet === undefined
    ? false
    : requiredBoolean(value.is_premium_pet, `${prefix}.is_premium_pet`);

  const orderMode = boxQty > 1 ? 'BOX' : 'PIECE';

  return {
    sku_id: skuId,
    supplier,
    supplier_sku: supplierSku,
    brand,
    category,
    subcategory,
    rollout_status: rolloutStatus,
    review_after_days: reviewAfterDays,
    assortment_status: assortmentStatus,
    mandatory_assortment: mandatoryAssortment,
    purchase_hold: purchaseHold,
    purchase_hold_until_stock: purchaseHoldUntilStock,
    min_display: minDisplay,
    min_stock: minStock,
    max_stock: maxStock,
    target_stock: targetStock,
    box_qty: boxQty,
    order_mode: orderMode,
    lead_time_days: leadTimeDays,
    order_cycle_days: orderCycleDays,
    seasonality,
    test_start_date: testStartDate,
    test_review_date: testReviewDate,
    rule_reason: ruleReason,
    rule_changed_at: ruleChangedAt,
    rule_changed_by: ruleChangedBy,
    one_c_status: oneCStatus,
    price_date: priceDate,
    is_premium_pet: isPremiumPet,
  };
}

function validateCanonicalMatrix(value) {
  if (!plainObject(value)) {
    invalid('Каноническая ассортиментная матрица должна быть объектом.');
  }
  if (value.version !== 1) {
    invalid('Поддерживается только version=1 канонической матрицы.');
  }
  const updatedAt = isoTimestamp(value.updated_at, 'updated_at');
  const store = requiredString(value.store, 'store');
  if (!Array.isArray(value.items)) {
    invalid('items должен быть массивом.');
  }

  const items = value.items.map(validateCanonicalItem);
  const seenSkuIds = new Set();
  for (const item of items) {
    if (seenSkuIds.has(item.sku_id)) {
      invalid(`Повторяющийся sku_id: ${item.sku_id}.`);
    }
    seenSkuIds.add(item.sku_id);
  }

  return {
    version: 1,
    schema_version: 'miska-canonical-assortment-matrix-v1',
    updated_at: updatedAt,
    store,
    active: value.active === false ? false : true,
    items,
  };
}

function normalizeSku(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function matrixIndex(matrix) {
  return new Map(matrix.items.map(item => [item.sku_id, item]));
}

function dateInPeriod(date, period) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const afterStart =
    month > period.start_month ||
    (month === period.start_month && day >= period.start_day);
  const beforeEnd =
    month < period.end_month ||
    (month === period.end_month && day <= period.end_day);
  if (period.start_month <= period.end_month) {
    return afterStart && beforeEnd;
  }
  return afterStart || beforeEnd;
}

function currentSeasonalCoefficient(seasonality, date = new Date()) {
  if (!seasonality || seasonality.type === 'year_round') {
    return seasonality?.coefficient ?? 1.0;
  }
  for (const period of seasonality.periods || []) {
    if (dateInPeriod(date, period)) return period.coefficient;
  }
  return 1.0;
}

function toAssortmentPolicyRule(item) {
  return {
    sku: item.sku_id,
    assortment_status: item.assortment_status,
    min_stock: item.min_stock,
    max_stock: item.max_stock,
    target_stock: item.target_stock,
    order_mode: item.order_mode,
    box_qty: item.box_qty > 0 ? item.box_qty : null,
    display_stock: item.min_display !== null && item.min_display > 0,
    display_min_qty: item.min_display,
    purchase_hold: item.purchase_hold,
    purchase_hold_until_stock: item.purchase_hold_until_stock,
    mandatory_assortment: item.mandatory_assortment,
    owner_comment: item.rule_reason || '',
    rule_source: 'canonical-matrix',
    updated_at: item.rule_changed_at,
    category: item.category,
    rollout_status: item.rollout_status,
    review_after_days: item.review_after_days,
    canonical: {
      sku_id: item.sku_id,
      supplier: item.supplier,
      supplier_sku: item.supplier_sku,
      brand: item.brand,
      category: item.category,
      subcategory: item.subcategory,
      rollout_status: item.rollout_status,
      review_after_days: item.review_after_days,
      lead_time_days: item.lead_time_days,
      order_cycle_days: item.order_cycle_days,
      seasonality: item.seasonality,
      test_start_date: item.test_start_date,
      test_review_date: item.test_review_date,
      rule_reason: item.rule_reason,
      rule_changed_by: item.rule_changed_by,
      one_c_status: item.one_c_status,
      price_date: item.price_date,
      is_premium_pet: item.is_premium_pet,
    },
  };
}

module.exports = {
  ASSORTMENT_STATUSES,
  ONE_C_STATUSES,
  SEASONALITY_TYPES,
  ROLLOUT_STATUSES,
  DEFAULT_ROLLOUT_STATUS,
  DEFAULT_REVIEW_AFTER_DAYS,
  CanonicalAssortmentMatrixError,
  currentSeasonalCoefficient,
  dateInPeriod,
  matrixIndex,
  normalizeSku,
  toAssortmentPolicyRule,
  validateCanonicalItem,
  validateCanonicalMatrix,
};
