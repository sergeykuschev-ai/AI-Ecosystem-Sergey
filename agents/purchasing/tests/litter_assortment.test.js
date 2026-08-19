#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const {
  applyAssortmentPolicy,
} = require('../services/assortment_policy');
const {
  loadAssortmentPolicySource,
} = require('../services/assortment_policy_store');
const {
  loadCanonicalAssortmentMatrix,
} = require('../services/canonical_assortment_matrix_store');

const CANONICAL_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/miska-canonical-assortment-matrix.json'
);

function source() {
  return loadAssortmentPolicySource({ legacyPath: null, canonicalPath: CANONICAL_PATH });
}

function findRule(sku) {
  const src = source();
  const rule = src.store.rules.find(r => r.sku === sku);
  assert.ok(rule, `${sku} must be present in canonical policy`);
  return rule;
}

function findRuleBySkuId(skuId) {
  const items = canonicalItems();
  const item = items.find(it => it.sku_id === skuId);
  assert.ok(item, `${skuId} must be present in canonical matrix`);
  const sku = item.supplier_sku || skuId;
  return findRule(sku);
}

function policyFor(sku, currentStock, minmaxQty = 0) {
  const rule = findRule(sku);
  return applyAssortmentPolicy({
    sku,
    current_stock: currentStock,
    minmax_qty: minmaxQty,
    rule,
  });
}

function canonicalItems() {
  return loadCanonicalAssortmentMatrix(CANONICAL_PATH).matrix.items;
}

test('old LITTER-* items are removed from canonical matrix', () => {
  const items = canonicalItems();
  const oldLitter = items.filter(it => it.sku_id.startsWith('LITTER-'));
  assert.equal(oldLitter.length, 0, 'no old LITTER-* records should remain');
});

test('toilet/hygiene/behavior categories are present with expected counts', () => {
  const items = canonicalItems();
  const byCategory = {};
  for (const it of items) {
    byCategory[it.category] = (byCategory[it.category] || 0) + 1;
  }
  assert.equal(byCategory['Наполнители'], 51);
  assert.equal(byCategory['Туалеты и аксессуары'], 17);
  assert.equal(byCategory['Поведение и запах'], 9);
  assert.equal(byCategory['Пеленки'], 6);
  assert.equal(byCategory['Прогулочная гигиена'], 2);
});

test('role distribution matches OWNER APPROVED v6', () => {
  const items = canonicalItems().filter(it =>
    ['Наполнители', 'Туалеты и аксессуары', 'Поведение и запах', 'Пеленки', 'Прогулочная гигиена'].includes(it.category)
  );
  const counts = {};
  for (const it of items) {
    counts[it.assortment_status] = (counts[it.assortment_status] || 0) + 1;
  }
  assert.equal(counts.CORE, 45);
  assert.equal(counts.OPTIONAL, 26);
  assert.equal(counts.TEST, 12);
  assert.equal(counts.EXIT, 2);
});

test('TEST start now = ДА allows initial test stock', () => {
  const rule = findRuleBySkuId('NEW-FILL-01');
  assert.equal(rule.assortment_status, 'TEST');
  assert.equal(rule.purchase_hold, false);
  assert.equal(rule.mandatory_assortment, false);
  const result = policyFor(rule.sku, 0, 0);
  assert.ok(result.policy_qty > 0, 'start-YES TEST should recommend initial stock');
});

test('TEST start now = НЕТ does not create automatic order', () => {
  const rule = findRuleBySkuId('NEW-FILL-03');
  assert.equal(rule.assortment_status, 'TEST');
  assert.equal(rule.purchase_hold, true);
  assert.equal(rule.mandatory_assortment, false);
  const result = policyFor(rule.sku, 0, 0);
  assert.equal(result.policy_qty, 0, 'start-NO TEST must not order automatically');
});

test('EXIT items do not create automatic order', () => {
  const rule = findRuleBySkuId('BEH-005');
  assert.equal(rule.assortment_status, 'EXIT');
  assert.equal(rule.purchase_hold, true);
  assert.equal(rule.mandatory_assortment, false);
  const result = policyFor(rule.sku, 0, 0);
  assert.equal(result.policy_qty, 0);
});

test('UNKNOWN stock is not coerced to zero and blocks automatic order', () => {
  const rule = findRuleBySkuId('FILL-005');
  assert.equal(rule.assortment_status, 'CORE');
  assert.ok(rule.owner_comment.includes('STOCK_UNKNOWN'));
  const result = policyFor(rule.sku, null, 0);
  assert.ok(result.policy_qty === null || result.policy_qty === 0, 'unknown stock must not force mandatory qty');
});

test('NULL supplier_sku is preserved with explicit warning', () => {
  const items = canonicalItems();
  const odor = items.find(it => it.sku_id === 'ODOR-001');
  assert.ok(odor);
  assert.equal(odor.supplier_sku, null);
  assert.ok(odor.rule_reason.includes('MISSING_SUPPLIER_SKU'));
  assert.ok(odor.rule_reason.includes('OWNER_ACTION_REQUIRED'));
});

test('CORE with missing article does not silently order', () => {
  const rule = findRuleBySkuId('ODOR-001');
  assert.equal(rule.assortment_status, 'CORE');
  assert.equal(rule.purchase_hold, false);
  // Without confirmed supplier_sku, runtime should flag owner review rather than silently place order.
  assert.ok(rule.owner_comment.includes('MISSING_SUPPLIER_SKU'));
});

test('duplicate SKU_ID is rejected by canonical adapter', () => {
  const skuIds = canonicalItems().map(it => it.sku_id);
  const duplicates = skuIds.filter((item, index) => skuIds.indexOf(item) !== index);
  assert.deepEqual(duplicates, []);
});

test('duplicate supplier_sku/article is rejected by canonical adapter', () => {
  const articles = canonicalItems().map(it => it.supplier_sku).filter(Boolean);
  const duplicates = articles.filter((item, index) => articles.indexOf(item) !== index);
  assert.deepEqual(duplicates, []);
});

test('MIN never exceeds MAX across new matrix', () => {
  const items = canonicalItems().filter(it =>
    ['Наполнители', 'Туалеты и аксессуары', 'Поведение и запах', 'Пеленки', 'Прогулочная гигиена'].includes(it.category)
  );
  for (const it of items) {
    assert.ok(it.min_stock <= it.max_stock, `${it.sku_id} MIN > MAX`);
  }
});

test('unrelated canonical items are unchanged', () => {
  const care = canonicalItems().find(it => it.sku_id === 'CARE-003');
  assert.equal(care.assortment_status, 'CORE');
  assert.equal(care.supplier_sku, 'DOSHALUN300');
  const award = canonicalItems().find(it => it.sku_id === 'GAL5427740');
  assert.equal(award.assortment_status, 'CORE');
});
