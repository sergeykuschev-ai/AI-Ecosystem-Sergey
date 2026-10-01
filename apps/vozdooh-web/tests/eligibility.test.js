'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveEligibility, EXCLUSION_REASONS } = require('../src/eligibility');

test('deriveEligibility keeps only customer-eligible positive-stock SKUs sorted by sku', () => {
  const result = deriveEligibility([
    { sku: 'B-2', name: 'Two', stock_qty: 5, customer_eligible: true },
    { sku: 'A-1', name: 'One', stock_qty: 1, customer_eligible: true },
  ]);

  assert.equal(result.total_rows, 2);
  assert.deepEqual(
    result.eligible.map((e) => e.sku),
    ['A-1', 'B-2'],
  );
  assert.deepEqual(result.excluded, []);
});

test('deriveEligibility excludes not-customer-eligible, zero-stock and invalid rows with reasons', () => {
  const result = deriveEligibility([
    { sku: 'OK-1', name: 'Fine', stock_qty: 2, customer_eligible: true },
    { sku: 'NO-ELIG', name: 'Internal', stock_qty: 2, customer_eligible: false },
    { sku: 'NO-STOCK', name: 'Empty', stock_qty: 0, customer_eligible: true },
    { sku: 'NO-STOCK-NEG', name: 'Negative', stock_qty: -3, customer_eligible: true },
    { name: 'Missing sku', stock_qty: 1, customer_eligible: true },
    { sku: 'BAD-STOCK', name: 'NaN stock', stock_qty: 'n/a', customer_eligible: true },
    { sku: 'BAD-FLAG', name: 'Flag string', stock_qty: 1, customer_eligible: 'yes' },
  ]);

  assert.deepEqual(
    result.eligible.map((e) => e.sku),
    ['OK-1'],
  );
  const reasonsBySku = new Map(result.excluded.map((e) => [e.sku ?? `<row ${e.index}>`, e.reason]));
  assert.equal(reasonsBySku.get('NO-ELIG'), EXCLUSION_REASONS.NOT_CUSTOMER_ELIGIBLE);
  assert.equal(reasonsBySku.get('NO-STOCK'), EXCLUSION_REASONS.OUT_OF_STOCK);
  assert.equal(reasonsBySku.get('NO-STOCK-NEG'), EXCLUSION_REASONS.OUT_OF_STOCK);
  assert.equal(reasonsBySku.get('<row 4>'), EXCLUSION_REASONS.INVALID_ROW);
  assert.equal(reasonsBySku.get('BAD-STOCK'), EXCLUSION_REASONS.INVALID_ROW);
  assert.equal(reasonsBySku.get('BAD-FLAG'), EXCLUSION_REASONS.INVALID_ROW);
});

test('deriveEligibility carries brand when present', () => {
  const result = deriveEligibility([
    { sku: 'BR-1', name: 'Branded', stock_qty: 1, customer_eligible: true, brand: 'SynthWax' },
  ]);
  assert.equal(result.eligible[0].brand, 'SynthWax');
});

test('deriveEligibility rejects a non-array snapshot', () => {
  assert.throws(() => deriveEligibility(/** @type {never} */ ('nope')), /must be an array/);
  assert.throws(() => deriveEligibility(null), /must be an array/);
});

test('deriveEligibility treats a fractional stock as eligible', () => {
  const result = deriveEligibility([
    { sku: 'FR-1', name: 'Fractional', stock_qty: 0.5, customer_eligible: true },
  ]);
  assert.equal(result.eligible.length, 1);
});
