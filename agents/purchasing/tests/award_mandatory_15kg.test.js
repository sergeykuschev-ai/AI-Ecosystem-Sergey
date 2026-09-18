'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { applyAssortmentPolicy } = require('../services/assortment_policy');
const { loadAssortmentPolicySource } = require('../services/assortment_policy_store');

const MATRIX = path.resolve(
  __dirname,
  '../../../data/purchasing/miska-canonical-assortment-matrix.json'
);

const EXPECTED = [
  ['7173617', 'FOOD-058', 23, 35],
  ['7173587', 'FOOD-060', 18, 28],
  ['7173679', 'FOOD-048', 8, 12],
];

function rules() {
  return loadAssortmentPolicySource({ legacyPath: null, canonicalPath: MATRIX }).store.rules;
}

test('confirmed AWARD 1.5kg assortment is CORE mandatory with Valta identity', () => {
  const source = rules();
  for (const [article, skuId, min, max] of EXPECTED) {
    const rule = source.find(item => item.sku === article);
    assert.ok(rule, `${article} must exist`);
    assert.equal(rule.internal_sku_id, skuId);
    assert.equal(rule.canonical.supplier, 'Валта');
    assert.equal(rule.assortment_status, 'CORE');
    assert.equal(rule.mandatory_assortment, true);
    assert.equal(rule.min_stock, min);
    assert.equal(rule.max_stock, max);
    assert.equal(rule.target_stock, null);
  }
});

test('mandatory AWARD replenishes zero demand only to MIN', () => {
  for (const [article, , min] of EXPECTED) {
    const rule = rules().find(item => item.sku === article);
    const result = applyAssortmentPolicy({
      sku: article, current_stock: 0, minmax_qty: 0, rule,
    });
    assert.equal(result.policy_qty, min, article);
    assert.equal(result.policy_rule, 'MANDATORY_ASSORTMENT', article);
  }
});

test('positive demand is preserved instead of being forced to MIN', () => {
  for (const [article] of EXPECTED) {
    const rule = rules().find(item => item.sku === article);
    const result = applyAssortmentPolicy({
      sku: article, current_stock: 0, minmax_qty: 3, rule,
    });
    assert.equal(result.policy_qty, 3, article);
  }
});
