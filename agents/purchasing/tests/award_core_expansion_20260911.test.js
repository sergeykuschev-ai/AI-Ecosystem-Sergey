'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadAssortmentPolicySource } = require('../services/assortment_policy_store');

const EXPECTED = new Map([
  ['7173600', [18, 28]],
  ['7173631', [15, 23]],
  ['2548900', [2, 3]],
  ['7173402', [18, 28]],
  ['7173327', [4, 6]],
  ['7173297', [5, 8]],
]);

test('owner-approved AWARD core expansion is canonical and non-mandatory', () => {
  const source = loadAssortmentPolicySource({ legacyPath: null });
  for (const [sku, [min, max]] of EXPECTED) {
    const rule = source.store.rules.find(r => r.sku === sku);
    assert.ok(rule, sku);
    assert.equal(rule.assortment_status, 'CORE', sku);
    assert.equal(rule.mandatory_assortment, false, sku);
    assert.equal(rule.min_stock, min, sku);
    assert.equal(rule.max_stock, max, sku);
    assert.equal(rule.canonical.rule_changed_by, 'OWNER', sku);
  }
});
