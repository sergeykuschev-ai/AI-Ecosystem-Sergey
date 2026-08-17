'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  applyAssortmentPolicy,
  applyAssortmentPolicyToProducts,
} = require('../services/assortment_policy');
const {
  loadAssortmentPolicySource,
} = require('../services/assortment_policy_store');

const CANONICAL_MATRIX_PATH = require('path').resolve(
  __dirname,
  '../../../data/purchasing/miska-canonical-assortment-matrix.json'
);
const OWNER_DECISIONS_PATH = require('path').resolve(
  __dirname,
  '../../../data/purchasing/miska-owner-decisions.json'
);

const {
  loadOwnerDecisions,
  latestActiveDecisions,
  applyOwnerDecisions,
} = require('../matrix_builder/owner_decisions');

function source() {
  return loadAssortmentPolicySource({ legacyPath: null, canonicalPath: CANONICAL_MATRIX_PATH });
}

function findRule(sku) {
  const src = source();
  const rule = src.store.rules.find(r => r.sku === sku);
  assert.ok(rule, `${sku} must be present in canonical policy`);
  return rule;
}

function policyFor(sku, currentStock, minmaxQty) {
  const rule = findRule(sku);
  return applyAssortmentPolicy({
    sku,
    current_stock: currentStock,
    minmax_qty: minmaxQty,
    rule,
  });
}

const AWARD_MANDATORY = ['2548955', '2548948', '7173648'];
const MNYAMS_MANDATORY = ['540164', '540140', '547262', '176946', '176953', '540157', '540195'];
const CARE_MANDATORY = ['DSHMABI300', 'DOSHALUN300', 'DSHACO300', 'NSHAZE100', 'NSHAZOL250', '25012'];

const ALL_NEW_MANDATORY = [...AWARD_MANDATORY, ...MNYAMS_MANDATORY, ...CARE_MANDATORY];

test('AWARD functional dry foods are CORE mandatory', () => {
  for (const sku of AWARD_MANDATORY) {
    const rule = findRule(sku);
    assert.equal(rule.assortment_status, 'CORE', sku);
    assert.equal(rule.mandatory_assortment, true, sku);
    assert.equal(rule.min_stock, 2, sku);
    assert.equal(rule.max_stock, 4, sku);
    assert.equal(rule.target_stock, 4, sku);
    assert.equal(rule.category, 'Сухой корм для кошек', sku);
  }
});

test('AWARD Sensitive Digestion positive control remains mandatory', () => {
  const rule = findRule('2548955');
  assert.equal(rule.canonical.subcategory, 'Sensitive Digestion');
});

test('AWARD stock=0 yields policy_qty = 4', () => {
  for (const sku of AWARD_MANDATORY) {
    const result = policyFor(sku, 0, 0);
    assert.equal(result.policy_qty, 4, sku);
    assert.equal(result.policy_rule, 'MANDATORY_ASSORTMENT', sku);
  }
});

test('Мнямс line is CORE mandatory with MIN=4 MAX=8 target=4', () => {
  for (const sku of MNYAMS_MANDATORY) {
    const rule = findRule(sku);
    assert.equal(rule.assortment_status, 'CORE', sku);
    assert.equal(rule.mandatory_assortment, true, sku);
    assert.equal(rule.canonical.brand, 'Мнямс', sku);
    assert.equal(rule.min_stock, 4, sku);
    assert.equal(rule.max_stock, 8, sku);
    assert.equal(rule.target_stock, 4, sku);
  }
});

test('Мнямс stock=0 yields policy_qty = 4', () => {
  for (const sku of MNYAMS_MANDATORY) {
    const result = policyFor(sku, 0, 0);
    assert.equal(result.policy_qty, 4, sku);
    assert.equal(result.policy_rule, 'MANDATORY_ASSORTMENT', sku);
  }
});

test('Care shampoos are CORE mandatory', () => {
  for (const sku of CARE_MANDATORY) {
    const rule = findRule(sku);
    assert.equal(rule.assortment_status, 'CORE', sku);
    assert.equal(rule.mandatory_assortment, true, sku);
    assert.ok(rule.min_stock >= 1, sku);
  }
});

test('DSHALU300 maps to supplier article DOSHALUN300', () => {
  const rule = findRule('DOSHALUN300');
  assert.equal(rule.canonical.supplier_sku, 'DOSHALUN300');
  assert.equal(rule.canonical.sku_id, 'CARE-003');
});

test('Care stock=0 yields at least MIN', () => {
  assert.equal(policyFor('DSHMABI300', 0, 0).policy_qty, 1);
  assert.equal(policyFor('DOSHALUN300', 0, 0).policy_qty, 2);
  assert.equal(policyFor('DSHACO300', 0, 0).policy_qty, 2);
  assert.equal(policyFor('NSHAZE100', 0, 0).policy_qty, 2);
  assert.equal(policyFor('NSHAZOL250', 0, 0).policy_qty, 1);
  assert.equal(policyFor('25012', 0, 0).policy_qty, 1);
});

test('mandatory SKU missing from 1C input emits MANDATORY_SKU_MISSING_FROM_SOURCE', () => {
  const src = source();
  const products = applyAssortmentPolicyToProducts(
    [{ article: 'OTHER', freeStock: 0, availableStock: 0, finalRecommendedQuantity: 0 }],
    src.store
  );
  const unmatched = products.unmatchedActiveRules;
  for (const sku of ALL_NEW_MANDATORY) {
    assert.ok(
      unmatched.some(d => d.sku === sku && d.code === 'MANDATORY_SKU_MISSING_FROM_SOURCE'),
      `${sku} must emit MANDATORY_SKU_MISSING_FROM_SOURCE when absent from source`
    );
  }
});

test('purchase_hold takes priority over mandatory assortment', () => {
  const rule = findRule('2548948');
  const heldRule = { ...rule, purchase_hold: true };
  const result = applyAssortmentPolicy({
    sku: '2548948',
    current_stock: 0,
    minmax_qty: 0,
    rule: heldRule,
  });
  assert.equal(result.policy_qty, 0);
  assert.equal(result.policy_rule, 'PURCHASE_HOLD');
});

test('EXIT takes priority over mandatory assortment', () => {
  const rule = findRule('2548948');
  const exitRule = { ...rule, assortment_status: 'EXIT' };
  const result = applyAssortmentPolicy({
    sku: '2548948',
    current_stock: 0,
    minmax_qty: 0,
    rule: exitRule,
  });
  assert.equal(result.policy_qty, 0);
  assert.equal(result.policy_rule, 'EXIT');
});

test('Bambini mandatory regression still works', () => {
  const rule = findRule('BMP549761');
  const result = applyAssortmentPolicy({ sku: 'BMP549761', current_stock: 0, minmax_qty: 0, rule });
  assert.equal(result.policy_qty, 4);
});

test('Protexin mandatory regression still works', () => {
  const rule = findRule('500991');
  const result = applyAssortmentPolicy({ sku: '500991', current_stock: 0, minmax_qty: 0, rule });
  assert.equal(result.policy_qty, 3);
});

test('7173648 stock=6 yields zero policy qty without permanent SKIP', () => {
  const result = policyFor('7173648', 6, 0);
  assert.equal(result.policy_qty, 0);
  assert.equal(result.policy_rule, 'NONE');
});

test('7173648 stock=1 yields mandatory replenishment >=1', () => {
  const result = policyFor('7173648', 1, 0);
  assert.ok(result.policy_qty >= 1);
  assert.equal(result.policy_rule, 'MANDATORY_ASSORTMENT');
});

test('7173648 stock=0 yields mandatory replenishment >=2', () => {
  const result = policyFor('7173648', 0, 0);
  assert.ok(result.policy_qty >= 2);
  assert.equal(result.policy_rule, 'MANDATORY_ASSORTMENT');
});

test('7173648 old HIGH_STOCK SKIP is superseded by KEEP_CORE owner decision', () => {
  const loaded = loadOwnerDecisions(OWNER_DECISIONS_PATH, { allowMissing: true });
  const active = latestActiveDecisions(loaded.store.decisions, {
    now: new Date().toISOString(),
  });
  const key = 'SUPPLIER:АО "ВАЛТА ПЕТ ПРОДАКТС":SKU:7173648';
  assert.ok(active.has(key), 'latest active decision must exist');
  assert.equal(active.get(key).owner_decision, 'KEEP_CORE');

  const oldSkip = loaded.store.decisions.find(
    d => d.sku === key && d.owner_decision === 'SKIP' && d.reason_code === 'HIGH_STOCK'
  );
  assert.ok(oldSkip, 'old SKIP decision must remain in store for audit');

  const draft = {
    builder_version: 'test',
    items: [{
      supplier: 'АО "ВАЛТА ПЕТ ПРОДАКТС"',
      article: '7173648',
      sku: '7173648',
      name: 'AWARD Urinary для взрослых кошек, 1,5 кг',
      brand: 'AWARD',
      suggested_role: 'CORE',
    }],
  };
  const applied = applyOwnerDecisions(draft, loaded.store);
  const item = applied.draft.items[0];
  assert.ok(item.owner_decision_summary.startsWith('KEEP_CORE'));
  assert.equal(item.owner_decision_applied, true);
  assert.equal(item.owner_decision_conflict, false);
});

test('Мнямс stock=3 yields mandatory gap >=1', () => {
  for (const sku of MNYAMS_MANDATORY) {
    const result = policyFor(sku, 3, 0);
    assert.equal(result.policy_qty, 1, sku);
    assert.equal(result.policy_rule, 'MANDATORY_ASSORTMENT', sku);
  }
});

test('Мнямс stock=4 does not force mandatory purchase', () => {
  for (const sku of MNYAMS_MANDATORY) {
    const result = policyFor(sku, 4, 0);
    assert.equal(result.policy_qty, 0, sku);
    assert.equal(result.policy_rule, 'NONE', sku);
  }
});

test('Мнямс positive demand recommendation is preserved up to MAX', () => {
  for (const sku of MNYAMS_MANDATORY) {
    const belowMax = policyFor(sku, 0, 6);
    assert.equal(belowMax.policy_qty, 6, `${sku}: demand 6 below MAX 8`);
    const cappedByMax = policyFor(sku, 0, 12);
    assert.equal(cappedByMax.policy_qty, 8, `${sku}: demand 12 capped at MAX 8`);
  }
});

test('Мнямс positive-control flavours are not added or altered in canonical', () => {
  const src = source();
  const mnyamsRules = src.store.rules.filter(r => r.canonical && r.canonical.brand === 'Мнямс');
  assert.equal(mnyamsRules.length, MNYAMS_MANDATORY.length);
  for (const rule of mnyamsRules) {
    assert.ok(MNYAMS_MANDATORY.includes(rule.sku), `${rule.sku} is one of the approved 7`);
  }
});

test('AWARD non-mandatory SKUs remain unchanged', () => {
  const src = source();
  const otherAward = src.store.rules.find(r => r.sku === '2548924');
  assert.ok(otherAward);
  assert.equal(otherAward.assortment_status, 'CORE');
  assert.equal(otherAward.mandatory_assortment, false);
});

test('CARE-003 canonical supplier_sku is DOSHALUN300 and CORE MIN2 MAX4', () => {
  const rule = findRule('DOSHALUN300');
  assert.equal(rule.canonical.sku_id, 'CARE-003');
  assert.equal(rule.canonical.supplier_sku, 'DOSHALUN300');
  assert.equal(rule.assortment_status, 'CORE');
  assert.equal(rule.mandatory_assortment, true);
  assert.equal(rule.min_stock, 2);
  assert.equal(rule.max_stock, 4);
  assert.equal(rule.target_stock, 2);
});

test('CARE-003 stock scenarios match MIN/MAX/target policy', () => {
  assert.equal(policyFor('DOSHALUN300', 0, 0).policy_qty, 2, 'stock 0 -> target 2');
  assert.equal(policyFor('DOSHALUN300', 1, 0).policy_qty, 1, 'stock 1 -> gap 1');
  assert.equal(policyFor('DOSHALUN300', 2, 0).policy_qty, 0, 'stock 2 -> MIN reached');
  assert.equal(policyFor('DOSHALUN300', 3, 0).policy_qty, 0, 'stock 3 -> no forced purchase');
});

test('CARE-003 old DSHALU300 SKIP/LOW_DEMAND is superseded by KEEP_CORE', () => {
  const loaded = loadOwnerDecisions(OWNER_DECISIONS_PATH, { allowMissing: true });
  const active = latestActiveDecisions(loaded.store.decisions, {
    now: new Date().toISOString(),
  });
  const oldKey = 'SUPPLIER:АО "ВАЛТА ПЕТ ПРОДАКТС":SKU:DSHALU300';
  const newKey = 'SUPPLIER:АО "ВАЛТА ПЕТ ПРОДАКТС":SKU:DOSHALUN300';

  assert.ok(active.has(oldKey), 'old key must have a latest active decision');
  assert.equal(active.get(oldKey).owner_decision, 'KEEP_CORE', 'old key latest active must be KEEP_CORE');
  assert.ok(active.has(newKey), 'new key must have a latest active decision');
  assert.equal(active.get(newKey).owner_decision, 'KEEP_CORE', 'new key latest active must be KEEP_CORE');

  const oldSkip = loaded.store.decisions.find(
    d => d.sku === oldKey && d.owner_decision === 'SKIP' && d.reason_code === 'LOW_DEMAND'
  );
  assert.ok(oldSkip, 'old SKIP/LOW_DEMAND must remain in store for audit');
});

test('CARE-003 old DSHALU300 key no longer blocks a draft item', () => {
  const loaded = loadOwnerDecisions(OWNER_DECISIONS_PATH, { allowMissing: true });
  const draft = {
    builder_version: 'test',
    items: [{
      supplier: 'АО "ВАЛТА ПЕТ ПРОДАКТС"',
      article: 'DSHALU300',
      sku: 'DSHALU300',
      name: 'ISB DO IT YOURSELF Шампунь для животных с длинной шерстью 300 мл',
      brand: 'ISB',
      suggested_role: 'CORE',
    }],
  };
  const applied = applyOwnerDecisions(draft, loaded.store);
  const item = applied.draft.items[0];
  assert.ok(item.owner_decision_summary.startsWith('KEEP_CORE'));
  assert.equal(item.owner_decision_applied, true);
  assert.equal(item.owner_decision_conflict, false);
});

test('CARE-003 new DOSHALUN300 key applies KEEP_CORE to a draft item', () => {
  const loaded = loadOwnerDecisions(OWNER_DECISIONS_PATH, { allowMissing: true });
  const draft = {
    builder_version: 'test',
    items: [{
      supplier: 'АО "ВАЛТА ПЕТ ПРОДАКТС"',
      article: 'DOSHALUN300',
      sku: 'DOSHALUN300',
      name: 'ISB DO IT YOURSELF Шампунь для животных с длинной шерстью 300 мл',
      brand: 'ISB',
      suggested_role: 'CORE',
    }],
  };
  const applied = applyOwnerDecisions(draft, loaded.store);
  const item = applied.draft.items[0];
  assert.ok(item.owner_decision_summary.startsWith('KEEP_CORE'));
  assert.equal(item.owner_decision_applied, true);
  assert.equal(item.owner_decision_conflict, false);
});

test('CARE-003 purchase_hold still takes priority if explicitly set', () => {
  const rule = findRule('DOSHALUN300');
  const heldRule = { ...rule, purchase_hold: true };
  const result = applyAssortmentPolicy({
    sku: 'DOSHALUN300',
    current_stock: 0,
    minmax_qty: 0,
    rule: heldRule,
  });
  assert.equal(result.policy_qty, 0);
  assert.equal(result.policy_rule, 'PURCHASE_HOLD');
});

test('CARE-003 EXIT still takes priority if explicitly set', () => {
  const rule = findRule('DOSHALUN300');
  const exitRule = { ...rule, assortment_status: 'EXIT' };
  const result = applyAssortmentPolicy({
    sku: 'DOSHALUN300',
    current_stock: 0,
    minmax_qty: 0,
    rule: exitRule,
  });
  assert.equal(result.policy_qty, 0);
  assert.equal(result.policy_rule, 'EXIT');
});

test('Other Care shampoos remain unchanged', () => {
  const unchanged = ['DSHMABI300', 'DSHACO300', 'NSHAZE100', 'NSHAZOL250', '25012'];
  const before = {
    DSHMABI300: { min: 1, max: 2, target: 1 },
    DSHACO300: { min: 2, max: 4, target: 2 },
    NSHAZE100: { min: 2, max: 4, target: 2 },
    NSHAZOL250: { min: 1, max: 2, target: 1 },
    25012: { min: 1, max: 1, target: 1 },
  };
  for (const sku of unchanged) {
    const rule = findRule(sku);
    const expected = before[sku];
    assert.equal(rule.assortment_status, 'CORE', sku);
    assert.equal(rule.mandatory_assortment, true, sku);
    assert.equal(rule.min_stock, expected.min, sku);
    assert.equal(rule.max_stock, expected.max, sku);
    assert.equal(rule.target_stock, expected.target, sku);
  }
});
