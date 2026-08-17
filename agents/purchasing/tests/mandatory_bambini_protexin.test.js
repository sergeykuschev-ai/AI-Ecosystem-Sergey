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

const BAMBINI_SKUS = [
  'BMP549761',
  'BMP549693',
  'BMP0852',
  'BMP549679',
  'BMP549730',
  'BMP1144',
  'BMP1523',
  'BMP549686',
  'BMP0822',
  'BMP0004',
  'BMP549723',
  'BMP549747',
  'BMP549754',
  'BMP549716',
  'BMP0630',
];

const PROTEXIN_15_30_SYN = ['500991', '501004', '500571'];
const PROTEXIN_60 = ['503435'];
const PROTEXIN_SKUS = [...PROTEXIN_15_30_SYN, ...PROTEXIN_60];
const ALL_MANDATORY_SKUS = [...BAMBINI_SKUS, ...PROTEXIN_SKUS];

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

test('all 19 mandatory SKU are present in canonical matrix', () => {
  const src = source();
  const policySkus = new Set(src.store.rules.map(r => r.sku));
  for (const sku of ALL_MANDATORY_SKUS) {
    assert.ok(policySkus.has(sku), `${sku} must be present in canonical policy`);
  }
});

test('Bambini SKU have CORE role, MIN=3, MAX=4, TARGET=4, mandatory_assortment=true', () => {
  for (const sku of BAMBINI_SKUS) {
    const rule = findRule(sku);
    assert.equal(rule.assortment_status, 'CORE', sku);
    assert.equal(rule.min_stock, 3, sku);
    assert.equal(rule.max_stock, 4, sku);
    assert.equal(rule.target_stock, 4, sku);
    assert.equal(rule.mandatory_assortment, true, sku);
    assert.equal(rule.purchase_hold, false, sku);
  }
});

test('Protexin 15/30/Synbiotic SKU have CORE role, MIN=2, MAX=3, TARGET=3', () => {
  for (const sku of PROTEXIN_15_30_SYN) {
    const rule = findRule(sku);
    assert.equal(rule.assortment_status, 'CORE', sku);
    assert.equal(rule.min_stock, 2, sku);
    assert.equal(rule.max_stock, 3, sku);
    assert.equal(rule.target_stock, 3, sku);
    assert.equal(rule.mandatory_assortment, true, sku);
    assert.equal(rule.purchase_hold, false, sku);
  }
});

test('Protexin 60 ml SKU has CORE role, MIN=2, MAX=2, TARGET=2', () => {
  const rule = findRule(PROTEXIN_60[0]);
  assert.equal(rule.assortment_status, 'CORE');
  assert.equal(rule.min_stock, 2);
  assert.equal(rule.max_stock, 2);
  assert.equal(rule.target_stock, 2);
  assert.equal(rule.mandatory_assortment, true);
  assert.equal(rule.purchase_hold, false);
});

test('Bambini stock=0 yields policy_qty = 4 (target)', () => {
  for (const sku of BAMBINI_SKUS) {
    const result = policyFor(sku, 0, 0);
    assert.equal(result.policy_qty, 4, sku);
    assert.equal(result.policy_rule, 'MANDATORY_ASSORTMENT', sku);
  }
});

test('Bambini stock=1 yields policy_qty = 3', () => {
  for (const sku of BAMBINI_SKUS) {
    assert.equal(policyFor(sku, 1, 0).policy_qty, 3, sku);
  }
});

test('Bambini stock=2 yields policy_qty = 2', () => {
  for (const sku of BAMBINI_SKUS) {
    assert.equal(policyFor(sku, 2, 0).policy_qty, 2, sku);
  }
});

test('Bambini stock=3 yields no mandatory purchase (MIN reached)', () => {
  for (const sku of BAMBINI_SKUS) {
    assert.equal(policyFor(sku, 3, 0).policy_qty, 0, sku);
  }
});

test('Protexin 15/30/Synbiotic stock=0 yields policy_qty = 3', () => {
  for (const sku of PROTEXIN_15_30_SYN) {
    const result = policyFor(sku, 0, 0);
    assert.equal(result.policy_qty, 3, sku);
    assert.equal(result.policy_rule, 'MANDATORY_ASSORTMENT', sku);
  }
});

test('Protexin 15/30/Synbiotic stock=1 yields policy_qty = 2', () => {
  for (const sku of PROTEXIN_15_30_SYN) {
    assert.equal(policyFor(sku, 1, 0).policy_qty, 2, sku);
  }
});

test('Protexin 15/30/Synbiotic stock=2 yields no mandatory purchase (MIN reached)', () => {
  for (const sku of PROTEXIN_15_30_SYN) {
    assert.equal(policyFor(sku, 2, 0).policy_qty, 0, sku);
  }
});

test('Protexin 60 ml stock=0 yields policy_qty = 2', () => {
  const result = policyFor(PROTEXIN_60[0], 0, 0);
  assert.equal(result.policy_qty, 2);
  assert.equal(result.policy_rule, 'MANDATORY_ASSORTMENT');
});

test('Protexin 60 ml stock=1 yields policy_qty = 1', () => {
  assert.equal(policyFor(PROTEXIN_60[0], 1, 0).policy_qty, 1);
});

test('Protexin 60 ml stock=2 yields no mandatory purchase', () => {
  assert.equal(policyFor(PROTEXIN_60[0], 2, 0).policy_qty, 0);
});

test('positive demand recommendation up to MAX is preserved', () => {
  const rule = findRule(BAMBINI_SKUS[0]);
  const atMax = applyAssortmentPolicy({
    sku: BAMBINI_SKUS[0],
    current_stock: 0,
    minmax_qty: 4,
    rule,
  });
  assert.equal(atMax.policy_qty, 4);
  assert.equal(atMax.policy_rule, 'NONE');

  const aboveMax = applyAssortmentPolicy({
    sku: BAMBINI_SKUS[0],
    current_stock: 0,
    minmax_qty: 7,
    rule,
  });
  assert.equal(aboveMax.policy_qty, 4);
  assert.equal(aboveMax.policy_rule, 'MAX_STOCK');
});

test('mandatory SKU missing from 1C input is not silently lost', () => {
  const src = source();
  const products = applyAssortmentPolicyToProducts(
    [{ article: 'OTHER', freeStock: 0, availableStock: 0, finalRecommendedQuantity: 0 }],
    src.store
  );
  const unmatched = products.unmatchedActiveRules;
  for (const sku of ALL_MANDATORY_SKUS) {
    assert.ok(
      unmatched.some(d => d.sku === sku && d.code === 'MANDATORY_SKU_MISSING_FROM_SOURCE'),
      `${sku} must emit MANDATORY_SKU_MISSING_FROM_SOURCE when absent from source`
    );
  }
});

test('purchase_hold takes priority over mandatory assortment', () => {
  const rule = findRule(BAMBINI_SKUS[0]);
  const heldRule = { ...rule, purchase_hold: true };
  const result = applyAssortmentPolicy({
    sku: BAMBINI_SKUS[0],
    current_stock: 0,
    minmax_qty: 0,
    rule: heldRule,
  });
  assert.equal(result.policy_qty, 0);
  assert.equal(result.policy_rule, 'PURCHASE_HOLD');
});

test('EXIT takes priority over mandatory assortment', () => {
  const rule = findRule(BAMBINI_SKUS[0]);
  const exitRule = { ...rule, assortment_status: 'EXIT' };
  const result = applyAssortmentPolicy({
    sku: BAMBINI_SKUS[0],
    current_stock: 0,
    minmax_qty: 0,
    rule: exitRule,
  });
  assert.equal(result.policy_qty, 0);
  assert.equal(result.policy_rule, 'EXIT');
});
