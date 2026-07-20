const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const {
  DEFAULT_MATRIX_BUILDER_CONFIG_PATH,
  buildDraftItem,
  buildManualReviewFile,
  buildMatrixDraftFromSmartZapasXlsx,
  policiesConflict,
} = require('../matrix_builder/matrix_builder');
const {
  buildMatrixBuilderReport,
} = require('../matrix_builder/matrix_builder_report');
const {
  calculateStockPolicy,
  completedWeeklyPeriods,
} = require('../matrix_builder/matrix_stock_policy');
const {
  assessDataQuality,
  classifyRole,
  matchStrategicGroups,
} = require('../matrix_builder/matrix_role_classifier');
const {
  loadMatrixBuilderConfig,
  validateDraftItem,
  validateMatrixDraft,
} = require('../matrix_builder/matrix_builder_validator');
const {
  runMatrixBuilderCli,
} = require('../../../scripts/build-purchasing-matrix');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const SYNTHETIC_XLSX = path.join(
  REPOSITORY_ROOT,
  'tests/fixtures/SmartZapas_synthetic.xlsx'
);
const TEMP_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), 'purchasing-matrix-builder-')
);
const CONFIG = loadMatrixBuilderConfig(
  DEFAULT_MATRIX_BUILDER_CONFIG_PATH
).config;

after(() => {
  fs.rmSync(TEMP_DIRECTORY, { recursive: true, force: true });
});

function week(periodStart, quantity, overrides = {}) {
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    periodStart,
    periodEnd: end.toISOString().slice(0, 10),
    quantity,
    rawValue: quantity,
    valueState: quantity === null
      ? 'invalid_value'
      : quantity === 0
        ? 'explicit_zero'
        : 'positive_quantity',
    sourceColumn: overrides.sourceColumn || 'D',
    sourceHeader: overrides.sourceHeader || `Неделя с ${periodStart}`,
    completionStatus: overrides.completionStatus || 'completed',
    ...overrides,
  };
}

function fourWeeks(quantities = [2, 2, 2, 2]) {
  return [
    week('2026-06-15', quantities[0], { sourceColumn: 'A' }),
    week('2026-06-22', quantities[1], { sourceColumn: 'B' }),
    week('2026-06-29', quantities[2], { sourceColumn: 'C' }),
    week('2026-07-06', quantities[3], { sourceColumn: 'D' }),
  ];
}

function weeklyHistory(quantities, start = '2026-04-20') {
  const first = new Date(`${start}T00:00:00.000Z`);
  return quantities.map((quantity, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + (index * 7));
    return week(date.toISOString().slice(0, 10), quantity, {
      sourceColumn: `W${index + 1}`,
    });
  });
}

function eightWeeks(quantities = Array(8).fill(2)) {
  return weeklyHistory(quantities, '2026-05-18');
}

function twelveWeeks(quantities = Array(12).fill(2)) {
  return weeklyHistory(quantities);
}

function twentySixWeeks(quantities = Array(26).fill(0)) {
  return weeklyHistory(quantities, '2026-01-12');
}

function row(overrides = {}) {
  const rowNumber = overrides.rowNumber || 10;
  return {
    rowIdentity: overrides.rowIdentity || `report:sheet:${rowNumber}`,
    rowNumber,
    article: Object.hasOwn(overrides, 'article') ? overrides.article : 'SKU-1',
    barcode: Object.hasOwn(overrides, 'barcode') ? overrides.barcode : '460000000001',
    internalProductId: overrides.internalProductId || null,
    name: overrides.name || 'Стабильный расходный корм 400 г',
    supplier: overrides.supplier || 'Тестовый поставщик',
    abc: Object.hasOwn(overrides, 'abc') ? overrides.abc : 'A',
    xyz: Object.hasOwn(overrides, 'xyz') ? overrides.xyz : 'X',
    weeklySalesHistory: overrides.weeklySalesHistory || twelveWeeks(),
    reportedSalesQuantity: Object.hasOwn(overrides, 'reportedSalesQuantity')
      ? overrides.reportedSalesQuantity
      : 24,
    reportedSalesPeriodDays: Object.hasOwn(overrides, 'reportedSalesPeriodDays')
      ? overrides.reportedSalesPeriodDays
      : 84,
    freeStock: Object.hasOwn(overrides, 'freeStock') ? overrides.freeStock : 2,
    stockDays: Object.hasOwn(overrides, 'stockDays') ? overrides.stockDays : 7,
    excessStock: Object.hasOwn(overrides, 'excessStock') ? overrides.excessStock : 0,
    supplierOrderQty: Object.hasOwn(overrides, 'supplierOrderQty')
      ? overrides.supplierOrderQty
      : 0,
    needQty: Object.hasOwn(overrides, 'needQty') ? overrides.needQty : 0,
    priceNum: Object.hasOwn(overrides, 'priceNum') ? overrides.priceNum : 100,
    supplierOrderSum: Object.hasOwn(overrides, 'supplierOrderSum')
      ? overrides.supplierOrderSum
      : 100,
    provenance: {
      reportFingerprint: 'fingerprint',
      worksheet: 'Лист_1',
      fields: {},
    },
    ...overrides,
  };
}

function phaseDecision(sourceRow, quantity = 1) {
  return {
    rowIdentity: sourceRow.rowIdentity,
    decision: quantity > 0 ? 'recommended' : 'do_not_buy',
    calculatedOrderQuantity: quantity,
  };
}

function draftItem(sourceRow = row(), options = {}) {
  return buildDraftItem({
    row: sourceRow,
    phase1Decision: phaseDecision(sourceRow),
    phase2Decision: phaseDecision(sourceRow),
    existingMatch: options.existingMatch || null,
    ambiguousIdentity: options.ambiguousIdentity || false,
    config: CONFIG,
  });
}

function existingMatch(overrides = {}) {
  return {
    itemIndex: 0,
    matchMethod: 'article',
    item: {
      article: 'SKU-1',
      name: 'Стабильный расходный корм 400 г',
      brand: 'AWARD',
      category: 'Корм',
      priority: 'critical',
      policy_status: 'approved',
      minimum_shelf_stock: 2,
      target_stock: 4,
      allow_zero_stock: false,
      notes: null,
      ...overrides,
    },
  };
}

test('loads the versioned conservative Miska Matrix Builder configuration', () => {
  assert.equal(CONFIG.version, 'miska-matrix-builder-v0.5.3');
  assert.equal(CONFIG.core_policy.minimum_completed_weeks, 8);
  assert.equal(CONFIG.stock_policy.preferred_weeks, 12);
  assert.equal(CONFIG.owner_review_policy.max_owner_action_items, 30);
  assert.equal(CONFIG.owner_review_policy.approved_conflict_score, 100);
  assert.equal(CONFIG.explicit_role_rules.length, 0);
});

test('orders completed weekly history chronologically and excludes partial periods', () => {
  const sourceRow = row({
    weeklySalesHistory: [
      week('2026-07-06', 4),
      week('2026-06-22', 2),
      week('2026-07-13', 100, { completionStatus: 'partial' }),
      week('2026-06-29', 3),
    ],
  });
  assert.deepEqual(
    completedWeeklyPeriods(sourceRow, CONFIG).map(period => period.periodStart),
    ['2026-06-22', '2026-06-29', '2026-07-06']
  );
});

test('calculates conservative monotonic stock levels from completed weeks', () => {
  const policy = calculateStockPolicy(row({
    weeklySalesHistory: twelveWeeks([1, 2, 3, 4, 2, 2, 3, 3, 2, 3, 3, 4]),
  }), CONFIG);
  assert.equal(policy.calculationStatus, 'calculated');
  assert.ok(policy.minimumShelfStock <= policy.targetStock);
  assert.ok(policy.targetStock <= policy.maximumStock);
  assert.equal(policy.completedWeeksUsed, 12);
});

test('keeps stock policy null when completed history is insufficient', () => {
  const policy = calculateStockPolicy(row({ weeklySalesHistory: [week('2026-07-06', 2)] }), CONFIG);
  assert.equal(policy.calculationStatus, 'insufficient_data');
  assert.equal(policy.minimumShelfStock, null);
  assert.equal(policy.targetStock, null);
  assert.equal(policy.maximumStock, null);
});

test('does not convert an invalid weekly value to zero', () => {
  const policy = calculateStockPolicy(row({
    weeklySalesHistory: [week('2026-06-29', null), week('2026-07-06', 2)],
  }), CONFIG);
  assert.equal(policy.completedWeeksUsed, 0);
  assert.equal(policy.shortAverage, 2);
  assert.equal(policy.averageWeeklySales, null);
  assert.equal(policy.minimumShelfStock, null);
});

test('preserves confirmed zero-sales weeks as numeric zero', () => {
  const policy = calculateStockPolicy(row({ weeklySalesHistory: eightWeeks(Array(8).fill(0)) }), CONFIG);
  assert.equal(policy.averageWeeklySales, 0);
  assert.equal(policy.minimumShelfStock, 0);
  assert.equal(policy.targetStock, 0);
  assert.equal(policy.maximumStock, 0);
});

test('classifies stable A/X demand as CORE', () => {
  const sourceRow = row();
  const result = classifyRole({
    row: sourceRow,
    stockPolicy: calculateStockPolicy(sourceRow, CONFIG),
    existingItem: null,
    config: CONFIG,
  });
  assert.equal(result.role, 'CORE');
});

test('does not classify weak or irregular demand as CORE', () => {
  const sourceRow = row({
    weeklySalesHistory: twelveWeeks([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]),
  });
  const result = classifyRole({
    row: sourceRow,
    stockPolicy: calculateStockPolicy(sourceRow, CONFIG),
    existingItem: null,
    config: CONFIG,
  });
  assert.notEqual(result.role, 'CORE');
});

test('does not invent TRAFFIC, PROFIT, IMAGE, or SEASONAL roles', () => {
  const item = draftItem(row({ abc: 'B', xyz: 'Z', weeklySalesHistory: fourWeeks([0, 1, 0, 1]) }));
  assert.ok(!['TRAFFIC', 'PROFIT', 'IMAGE', 'SEASONAL'].includes(item.suggested_role));
});

test('does not assign PROFIT without confirmed margin data', () => {
  assert.notEqual(draftItem().suggested_role, 'PROFIT');
});

test('does not assign IMAGE without an exact configuration rule', () => {
  assert.notEqual(draftItem().suggested_role, 'IMAGE');
});

test('does not assign SEASONAL from a short weekly history', () => {
  const item = draftItem(row({ weeklySalesHistory: [week('2026-07-06', 50)] }));
  assert.notEqual(item.suggested_role, 'SEASONAL');
});

test('marks a short-history product without cumulative evidence as possible NEW', () => {
  const item = draftItem(row({
    article: null,
    barcode: '460000000002',
    weeklySalesHistory: [week('2026-07-06', 0)],
    reportedSalesQuantity: null,
  }));
  assert.equal(item.suggested_role, 'NEW');
  assert.equal(item.manual_review_required, true);
});

test('does not call confirmed cumulative zero sales a new product', () => {
  const item = draftItem(row({
    weeklySalesHistory: [week('2026-07-06', 0)],
    reportedSalesQuantity: 0,
  }));
  assert.notEqual(item.suggested_role, 'NEW');
});

test('marks a weak classified zero-sales stocked product as EXIT candidate', () => {
  const item = draftItem(row({
    abc: 'C',
    xyz: 'Z',
    name: 'Обычный влажный корм 100 г',
    weeklySalesHistory: eightWeeks(Array(8).fill(0)),
    freeStock: 5,
    reportedSalesQuantity: 0,
  }));
  assert.equal(item.suggested_role, 'EXIT');
  assert.equal(item.suggested_priority, 'review');
  assert.equal(item.manual_review_required, true);
});

test('does not suggest EXIT without a stable source identifier', () => {
  const item = draftItem(row({
    article: null,
    barcode: null,
    internalProductId: null,
    abc: 'C',
    xyz: 'Z',
    name: 'Обычный влажный корм 100 г',
    weeklySalesHistory: eightWeeks(Array(8).fill(0)),
    freeStock: 5,
    reportedSalesQuantity: 0,
  }));
  assert.notEqual(item.suggested_role, 'EXIT');
  assert.equal(item.manual_review_required, true);
});

test('uses OPTIONAL for supported but low-significance assortment', () => {
  const item = draftItem(row({
    name: 'Обычный поддерживаемый ассортимент 400 г',
    abc: 'C',
    xyz: 'Y',
  }));
  assert.equal(item.suggested_role, 'OPTIONAL');
  assert.equal(item.suggested_priority, 'standard');
});

test('matches strategic groups only by all exact normalized tokens', () => {
  const exact = matchStrategicGroups(row({ name: 'AWARD Urinary корм 400 г' }), CONFIG);
  const near = matchStrategicGroups(row({ name: 'AWARD Urin корм 400 г' }), CONFIG);
  assert.equal(exact.some(group => group.id === 'award_urinary'), true);
  assert.equal(near.some(group => group.id === 'award_urinary'), false);
});

test('CORE requires long history and not only four active weeks', () => {
  const item = draftItem(row({
    weeklySalesHistory: fourWeeks([4, 4, 4, 4]),
  }));
  assert.notEqual(item.suggested_role, 'CORE');
  assert.equal(item.evidence.completed_weeks_used, 0);
});

test('low absolute weekly sales do not qualify for CORE', () => {
  const item = draftItem(row({
    weeklySalesHistory: twelveWeeks(Array(12).fill(0.75)),
  }));
  assert.notEqual(item.suggested_role, 'CORE');
  assert.ok(item.reason_codes.includes('core_below_average_threshold'));
});

test('strategic low-demand product can be important without becoming CORE', () => {
  const item = draftItem(row({
    name: 'AWARD Urinary тестовый корм 400 г',
    weeklySalesHistory: twelveWeeks([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]),
  }));
  assert.notEqual(item.suggested_role, 'CORE');
  assert.equal(item.suggested_priority, 'important');
  assert.ok(item.review_queue_memberships.includes('commercial_review'));
});

test('current partial-week sale blocks EXIT', () => {
  const item = draftItem(row({
    name: 'Влажный корм тестовый 100 г',
    abc: 'C',
    xyz: 'Z',
    weeklySalesHistory: [
      ...eightWeeks(Array(8).fill(0)),
      week('2026-07-13', 1, { completionStatus: 'partial' }),
    ],
    reportedSalesQuantity: 1,
    freeStock: 1,
  }));
  assert.notEqual(item.suggested_role, 'EXIT');
  assert.ok(item.reason_codes.includes('exit_blocked_current_week_sale'));
});

test('sale five completed weeks ago blocks eight-week EXIT', () => {
  const item = draftItem(row({
    name: 'Влажный корм тестовый 100 г',
    abc: 'C',
    xyz: 'Z',
    weeklySalesHistory: eightWeeks([0, 0, 1, 0, 0, 0, 0, 0]),
    reportedSalesQuantity: 1,
    freeStock: 1,
  }));
  assert.notEqual(item.suggested_role, 'EXIT');
  assert.ok(item.reason_codes.includes('exit_blocked_recent_sale'));
});

test('positive supplier need blocks EXIT', () => {
  const item = draftItem(row({
    name: 'Влажный корм тестовый 100 г',
    abc: 'C', xyz: 'Z',
    weeklySalesHistory: eightWeeks(Array(8).fill(0)),
    reportedSalesQuantity: 0,
    needQty: 1,
    freeStock: 1,
  }));
  assert.notEqual(item.suggested_role, 'EXIT');
  assert.ok(item.reason_codes.includes('exit_blocked_supplier_demand'));
});

test('positive supplier order blocks EXIT', () => {
  const item = draftItem(row({
    name: 'Влажный корм тестовый 100 г',
    abc: 'C', xyz: 'Z',
    weeklySalesHistory: eightWeeks(Array(8).fill(0)),
    reportedSalesQuantity: 0,
    supplierOrderQty: 1,
    freeStock: 1,
  }));
  assert.notEqual(item.suggested_role, 'EXIT');
  assert.ok(item.reason_codes.includes('exit_blocked_supplier_demand'));
});

test('strategic veterinary diet is protected from EXIT', () => {
  const item = draftItem(row({
    name: 'Вет диета CRAFTIA GALENA CAT RENAL CARE 1,4 кг',
    abc: 'D', xyz: 'ZZ',
    weeklySalesHistory: twentySixWeeks(),
    reportedSalesQuantity: 0,
    freeStock: 1,
  }));
  assert.notEqual(item.suggested_role, 'EXIT');
  assert.ok(item.reason_codes.includes('exit_blocked_strategic_policy'));
});

test('durable and consumable categories use different EXIT horizons', () => {
  const consumable = draftItem(row({
    name: 'Влажный корм тестовый 100 г',
    abc: 'C', xyz: 'Z',
    weeklySalesHistory: eightWeeks(Array(8).fill(0)),
    reportedSalesQuantity: 0,
    freeStock: 1,
  }));
  const insufficientDurable = draftItem(row({
    name: 'Миска тестовая 200 мл',
    abc: 'C', xyz: 'Z',
    weeklySalesHistory: twelveWeeks(Array(12).fill(0)),
    reportedSalesQuantity: 0,
    freeStock: 1,
  }));
  const observedDurable = draftItem(row({
    name: 'Миска тестовая 300 мл',
    abc: 'C', xyz: 'Z',
    weeklySalesHistory: twentySixWeeks(),
    reportedSalesQuantity: 0,
    freeStock: 1,
  }));
  assert.equal(consumable.suggested_role, 'EXIT');
  assert.notEqual(insufficientDurable.suggested_role, 'EXIT');
  assert.equal(observedDurable.suggested_role, 'EXIT');
  assert.ok(insufficientDurable.reason_codes.includes('exit_insufficient_history'));
});

test('approved critical policy blocks EXIT and remains unchanged', () => {
  const item = draftItem(row({
    name: 'Влажный корм утверждённый 100 г',
    abc: 'C', xyz: 'Z',
    weeklySalesHistory: eightWeeks(Array(8).fill(0)),
    reportedSalesQuantity: 0,
    freeStock: 1,
  }), { existingMatch: existingMatch() });
  assert.notEqual(item.suggested_role, 'EXIT');
  assert.ok(item.reason_codes.includes('exit_blocked_approved_policy'));
  assert.equal(item.suggested_priority, 'critical');
  assert.equal(item.suggested_minimum_shelf_stock, 2);
  assert.equal(item.suggested_target_stock, 4);
});

test('growth cap limits a four-week spike against long-term average', () => {
  const policy = calculateStockPolicy(row({
    weeklySalesHistory: twelveWeeks([
      1, 1, 1, 1, 1, 1, 1, 1, 10, 10, 10, 10,
    ]),
  }), CONFIG);
  assert.equal(policy.shortAverage, 10);
  assert.equal(policy.longTermAverage, 4);
  assert.equal(policy.effectiveAverage, 6);
  assert.equal(policy.growthCapApplied, true);
});

test('growth cap also constrains a preferred average above the long-term cap', () => {
  const policy = calculateStockPolicy(row({
    weeklySalesHistory: twentySixWeeks([
      ...Array(14).fill(1),
      ...Array(8).fill(10),
      ...Array(4).fill(20),
    ]),
  }), CONFIG);
  assert.equal(policy.shortAverage, 20);
  assert.ok(policy.preferredAverage > policy.longTermAverage * 1.5);
  assert.equal(
    policy.effectiveAverage,
    Math.round(policy.longTermAverage * 1.5 * 10000) / 10000
  );
  assert.equal(policy.growthCapApplied, true);
});

test('stock policy exposes base and preferred long-horizon averages', () => {
  const policy = calculateStockPolicy(row({
    weeklySalesHistory: twelveWeeks([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]),
  }), CONFIG);
  assert.equal(policy.baseAverage, 2.5);
  assert.equal(policy.preferredAverage, 2);
  assert.equal(policy.completedWeeksUsed, 12);
});

test('minimum shelf stock and safety stock are calculated independently', () => {
  const policy = calculateStockPolicy(row({
    weeklySalesHistory: twelveWeeks(Array(12).fill(2)),
  }), CONFIG);
  assert.equal(policy.minimumShelfStock, 1);
  assert.equal(policy.safetyStock, 0);
  assert.notEqual(policy.minimumShelfStock, policy.safetyStock);
});

test('expensive maximum policy enters large inventory review', () => {
  const item = draftItem(row({
    weeklySalesHistory: twelveWeeks(Array(12).fill(10)),
    priceNum: 1000,
  }));
  assert.ok(item.maximum_stock_value >= 20000);
  assert.equal(item.inventory_value_review_level, 'critical');
  assert.ok(item.review_queue_memberships.includes('large_inventory_review'));
});

test('missing purchase price remains null and enters insufficient-data review', () => {
  const item = draftItem(row({ priceNum: null }));
  assert.equal(item.maximum_stock_value, null);
  assert.ok(item.reason_codes.includes('missing_purchase_price'));
  assert.ok(item.review_queue_memberships.includes('insufficient_data'));
});

test('placeholder difference is not an approved policy conflict', () => {
  const item = draftItem(row(), {
    existingMatch: existingMatch({
      policy_status: 'placeholder',
      priority: 'standard',
      minimum_shelf_stock: 0,
      target_stock: 0,
      allow_zero_stock: true,
    }),
  });
  assert.equal(item.approved_policy_conflict, false);
  assert.equal(item.placeholder_difference, true);
  assert.equal(item.existing_policy_preserved, false);
  assert.ok(item.suggested_target_stock > 0);
});

test('assigns low confidence and manual review to ambiguous identity', () => {
  const item = draftItem(row(), { ambiguousIdentity: true });
  assert.equal(item.confidence, 'low');
  assert.equal(item.manual_review_required, true);
  assert.ok(item.reason_codes.includes('ambiguous_identity'));
});

test('assigns low confidence when no stable source identifier is available', () => {
  const sourceRow = row({ article: null, barcode: null, internalProductId: null });
  const quality = assessDataQuality({
    row: sourceRow,
    stockPolicy: calculateStockPolicy(sourceRow, CONFIG),
    ambiguousIdentity: false,
    config: CONFIG,
  });
  assert.equal(quality.confidence, 'low');
  assert.ok(quality.reasons.includes('missing_stable_identifier'));
  assert.ok(!quality.reasons.includes('ambiguous_identity'));
});

test('preserves existing critical policy instead of overwriting it', () => {
  const item = draftItem(row({ weeklySalesHistory: twelveWeeks(Array(12).fill(10)) }), {
    existingMatch: existingMatch(),
  });
  assert.equal(item.suggested_priority, 'critical');
  assert.equal(item.suggested_minimum_shelf_stock, 2);
  assert.equal(item.suggested_target_stock, 4);
  assert.equal(item.existing_policy_preserved, true);
});

test('reports but does not apply a conflict with existing policy', () => {
  const automatic = {
    priority: 'important',
    minimum_shelf_stock: 5,
    target_stock: 10,
  };
  assert.equal(policiesConflict(existingMatch().item, automatic), true);
  const item = draftItem(row({ weeklySalesHistory: twelveWeeks(Array(12).fill(10)) }), {
    existingMatch: existingMatch(),
  });
  assert.equal(item.policy_conflict, true);
  assert.equal(item.recommended_action, 'keep_approved_and_review_difference');
});

test('exposes human-readable explanation and source provenance', () => {
  const item = draftItem();
  assert.ok(item.explanation.includes('Завершённые недели'));
  assert.equal(item.provenance.source.source_row_number, 10);
  assert.equal(item.provenance.stock_policy.configVersion, CONFIG.version);
});

test('validates one malformed draft item without crashing the draft pipeline', () => {
  const item = draftItem();
  item.suggested_minimum_shelf_stock = 5;
  item.suggested_target_stock = 2;
  const validation = validateDraftItem(item, CONFIG);
  assert.ok(validation.errors.includes('minimum_exceeds_target'));
});

test('validates a negative raw weekly sale even when normalized quantity is unavailable', () => {
  const item = draftItem();
  item.evidence.weekly_sales[0] = {
    ...item.evidence.weekly_sales[0],
    quantity: null,
    rawValue: -2,
    valueState: 'invalid_value',
  };
  const validation = validateDraftItem(item, CONFIG);
  assert.ok(validation.errors.includes('negative_weekly_sales'));
});

test('separates invalid stock, role, priority, and safety-stock errors', () => {
  const item = draftItem();
  item.name = '';
  item.suggested_role = 'UNKNOWN';
  item.suggested_priority = 'urgent';
  item.suggested_safety_stock = -1;
  item.evidence.free_stock = -2;
  const validation = validateDraftItem(item, CONFIG);
  assert.ok(validation.errors.includes('empty_product_name'));
  assert.ok(validation.errors.includes('unknown_role'));
  assert.ok(validation.errors.includes('unknown_priority'));
  assert.ok(validation.errors.includes('invalid_suggested_safety_stock'));
  assert.ok(validation.errors.includes('negative_free_stock'));
});

test('retains valid SKU when another draft SKU fails validation', () => {
  const valid = draftItem();
  const invalid = { ...draftItem(row({ rowIdentity: 'bad-row' })), name: '' };
  const result = validateMatrixDraft({ status: 'draft', items: [valid, invalid] }, CONFIG);
  assert.equal(result.draft.items.length, 2);
  assert.equal(result.draft.items[0].validation.errors.length, 0);
  assert.ok(result.draft.items[1].validation.errors.includes('empty_product_name'));
  assert.equal(result.draft.items[1].manual_review_required, true);
});

test('manual-review output contains low-confidence and NEW/EXIT items', () => {
  const stable = draftItem();
  const candidate = draftItem(row({
    rowIdentity: 'new-row',
    article: null,
    weeklySalesHistory: [week('2026-07-06', 0)],
    reportedSalesQuantity: null,
  }));
  const draft = {
    generated_at: '2026-07-20T00:00:00.000Z',
    source: { sku_count: 2 },
    items: [stable, candidate],
  };
  const review = buildManualReviewFile(draft);
  assert.equal(review.item_count, 1);
  assert.equal(review.items[0].rowIdentity, 'new-row');
});

test('review queues are separated while unique manual review does not double-count', () => {
  const multiQueue = draftItem(row({
    rowIdentity: 'multi-queue',
    article: null,
    barcode: null,
    internalProductId: null,
    weeklySalesHistory: twelveWeeks(Array(12).fill(10)),
    priceNum: 1000,
  }));
  const draft = {
    generated_at: '2026-07-20T00:00:00.000Z',
    source: { sku_count: 1 },
    items: [multiQueue],
  };
  const review = buildManualReviewFile(draft);
  assert.equal(review.item_count, 1);
  assert.equal(review.review_queues.identity_remediation.length, 1);
  assert.equal(review.review_queues.large_inventory_review.length, 1);
  assert.equal(review.items[0].rowIdentity, 'multi-queue');
});

test('text report contains all required review sections', () => {
  const item = draftItem();
  const draft = {
    builder_version: CONFIG.version,
    source: {
      file: 'fixture.xlsx', worksheet: 'Лист_1', report_timestamp: null,
      report_timestamp_source: null, sku_count: 1, structural_row_count: 0,
    },
    existing_matrix: null,
    items: [item],
    summary: {
      total_sku: 1,
      confidence: { high: 1, medium: 0, low: 0 },
      manual_review: 0,
      existing_matrix_items: 0,
      policy_conflicts: 0,
      products_without_stock_policy: 0,
      roles: { CORE: 1 },
      priorities: { important: 1 },
    },
    validation_summary: { error_count: 0, warning_count: 0 },
  };
  const report = buildMatrixBuilderReport(draft, { items: [] });
  for (const heading of [
    'ИСХОДНЫЕ ДАННЫЕ', 'ИТОГОВАЯ СВОДКА', 'ПРЕДЛОЖЕННЫЕ РОЛИ',
    'ПРЕДЛОЖЕННЫЕ ПРИОРИТЕТЫ', 'CORE-ПОЗИЦИИ', 'ВОЗМОЖНЫЕ НОВИНКИ',
    'КАНДИДАТЫ НА ВЫВОД', 'КОНФЛИКТЫ', 'ПОЗИЦИИ ДЛЯ РУЧНОЙ ПРОВЕРКИ',
    'НЕХВАТКА ДАННЫХ', 'РЕКОМЕНДУЕМЫЕ СЛЕДУЮЩИЕ ДЕЙСТВИЯ',
  ]) assert.ok(report.includes(heading));
});

test('builds a complete draft from the sanitized XLSX without existing matrix', async () => {
  const result = await buildMatrixDraftFromSmartZapasXlsx(SYNTHETIC_XLSX, {
    generatedAt: '2026-07-20T00:00:00.000Z',
    reportDate: '2026-07-19',
  });
  assert.equal(result.draft.summary.total_sku, 6);
  assert.equal(result.draft.items.length, 6);
  assert.equal(result.draft.existing_matrix, null);
  assert.equal(result.draft.validation_summary.error_count, 0);
  assert.equal(result.draft.source.report_date, '2026-07-19');
  assert.equal(result.draft.source.report_date_source, 'explicit_report_date');
});

test('loads an existing matrix and preserves its exact matched item', async () => {
  const first = await buildMatrixDraftFromSmartZapasXlsx(SYNTHETIC_XLSX, {
    generatedAt: '2026-07-20T00:00:00.000Z', reportDate: '2026-07-19',
  });
  const sourceItem = first.draft.items[0];
  const matrixPath = path.join(TEMP_DIRECTORY, 'existing-matrix.json');
  fs.writeFileSync(matrixPath, `${JSON.stringify({
    version: 1,
    updated_at: '2026-07-19',
    store: 'Миска',
    items: [{
      article: sourceItem.article,
      name: sourceItem.name,
      priority: 'critical',
      minimum_shelf_stock: 3,
      target_stock: 5,
      allow_zero_stock: false,
    }],
  }, null, 2)}\n`);
  const result = await buildMatrixDraftFromSmartZapasXlsx(SYNTHETIC_XLSX, {
    generatedAt: '2026-07-20T00:00:00.000Z',
    reportDate: '2026-07-19',
    existingMatrixPath: matrixPath,
  });
  const matched = result.draft.items.find(item => item.rowIdentity === sourceItem.rowIdentity);
  assert.equal(matched.existing_matrix_item, true);
  assert.equal(matched.suggested_priority, 'critical');
  assert.equal(matched.suggested_minimum_shelf_stock, 3);
});

test('CLI dry-run creates no output directory', async () => {
  const outputRoot = path.join(TEMP_DIRECTORY, 'dry-run');
  const result = await runMatrixBuilderCli([
    '--input', SYNTHETIC_XLSX,
    '--output-dir', outputRoot,
    '--owner-decisions', path.join(TEMP_DIRECTORY, 'missing-owner-decisions.json'),
    '--report-date', '2026-07-19',
    '--dry-run',
  ], { output: () => {}, currentDate: '2026-07-20T10:11:12.000Z' });
  assert.equal(result.mode, 'dry-run');
  assert.equal(fs.existsSync(outputRoot), false);
  assert.equal(result.result.draft.summary.total_sku, 6);
});

test('CLI writes Matrix Builder files and the Owner Review Dashboard', async () => {
  const outputRoot = path.join(TEMP_DIRECTORY, 'written');
  const result = await runMatrixBuilderCli([
    '--input', SYNTHETIC_XLSX,
    '--output-dir', outputRoot,
    '--report-date', '2026-07-19',
  ], { output: () => {}, currentDate: new Date(2026, 6, 20, 10, 11, 12) });
  assert.deepEqual(fs.readdirSync(result.runDirectory).sort(), [
    'manual-review.json',
    'matrix-draft.json',
    'matrix-report.txt',
    'owner-review-report.md',
    'owner-review.json',
    'run-metadata.json',
  ]);
  const ownerReport = fs.readFileSync(
    path.join(result.runDirectory, 'owner-review-report.md'), 'utf8'
  );
  assert.ok(ownerReport.includes('Owner Review — ассортиментная матрица'));
  assert.ok(ownerReport.includes('EXECUTIVE SUMMARY'));
  assert.ok(ownerReport.includes('OWNER DECISION SHEET'));
  const ownerReview = JSON.parse(fs.readFileSync(
    path.join(result.runDirectory, 'owner-review.json'), 'utf8'
  ));
  assert.equal(ownerReview.report_version, 'owner-review-v0.5.3');
  assert.equal(ownerReview.owner_decisions.records_loaded, 0);
  assert.ok(ownerReview.items.every(item =>
    Number.isFinite(item.owner_review_score) &&
    typeof item.owner_review_priority === 'string' &&
    Array.isArray(item.owner_review_reasons) &&
    typeof item.owner_decision_status === 'string' &&
    typeof item.owner_decision_applied === 'boolean' &&
    typeof item.owner_decision_conflict === 'boolean' &&
    (item.owner_decision_summary === null ||
      typeof item.owner_decision_summary === 'string')
  ));
  const metadata = JSON.parse(fs.readFileSync(
    path.join(result.runDirectory, 'run-metadata.json'), 'utf8'
  ));
  assert.equal(metadata.input.sku_count, 6);
  assert.equal(metadata.configuration.version, CONFIG.version);
  assert.equal(metadata.owner_decisions.summary.records_loaded, 0);
  assert.equal(metadata.dry_run, false);
});

test('CLI forwards explicit report date without using system date as report date', async () => {
  let receivedOptions;
  const fakeResult = {
    draft: {
      source: {
        worksheet: 'Sheet', report_timestamp: null, report_timestamp_source: 'explicit',
        sku_count: 0, structural_row_count: 0,
      },
      summary: {
        total_sku: 0, roles: { CORE: 0, NEW: 0, EXIT: 0 },
        manual_review: 0, policy_conflicts: 0,
      },
      validation_summary: { error_count: 0, warning_count: 0 },
    },
    manualReview: { items: [] },
    reportText: 'draft',
    config: CONFIG,
    configPath: DEFAULT_MATRIX_BUILDER_CONFIG_PATH,
  };
  await runMatrixBuilderCli([
    '--input', SYNTHETIC_XLSX,
    '--report-date', '2026-07-19',
    '--dry-run',
  ], {
    output: () => {},
    currentDate: '2026-08-20T10:11:12.000Z',
    builder: async (_file, options) => {
      receivedOptions = options;
      return fakeResult;
    },
  });
  assert.equal(receivedOptions.reportDate, '2026-07-19');
  assert.notEqual(receivedOptions.reportDate, '2026-08-20');
});
