'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { analyzeShift } = require('../business_kpi_agent');
const {
  calculateKpiMetrics,
} = require('../services/calculate_kpi_metrics');

const VALID_SHIFT = Object.freeze({
  cash: 12000,
  acquiring: 18000,
  qr: 3000,
  receipts: 25,
  itemsSold: 60,
  upsellReceipts: 8,
  treatsRevenue: 1500,
  treatsReceipts: 6,
});

test('revenue does not count QR twice when acquiring already includes it', () => {
  const result = calculateKpiMetrics(VALID_SHIFT);

  assert.equal(result.revenue, 30000);
  assert.equal(result.averageCheck, 1200);
  assert.equal(result.itemsPerReceipt, 2.4);
  assert.equal(result.qrShare, 0.1);
  assert.equal(result.paymentBreakdown.qrIncludedInAcquiring, true);
});

test('zero receipts produce null ratios instead of division errors', () => {
  const result = calculateKpiMetrics({
    ...VALID_SHIFT,
    cash: 0,
    acquiring: 0,
    qr: 0,
    receipts: 0,
    itemsSold: 0,
    upsellReceipts: 0,
    treatsRevenue: 0,
    treatsReceipts: 0,
  });

  assert.equal(result.averageCheck, null);
  assert.equal(result.itemsPerReceipt, null);
  assert.equal(result.upsellReceiptShare, null);
  assert.equal(result.treatsReceiptShare, null);
  assert.equal(result.qrShare, null);
});

test('agent exposes a stable versioned result contract', () => {
  const result = analyzeShift(VALID_SHIFT);

  assert.equal(result.contractVersion, 'v2');
  assert.equal(result.settingsVersion, 1);
  assert.equal(result.metrics.revenue, 30000);
  assert.equal(result.metrics.itemsPerReceipt, 2.4);
  assert.equal(result.metrics.kpiStatus, 'COMPLETE');
});

test('QR cannot exceed acquiring when acquiring includes QR', () => {
  assert.throws(
    () => calculateKpiMetrics({ ...VALID_SHIFT, qr: 18000.01 }),
    /qr must be less than or equal to acquiring/
  );
});

test('invalid negative, fractional, and over-count inputs fail clearly', () => {
  assert.throws(
    () => calculateKpiMetrics({ ...VALID_SHIFT, cash: -1 }),
    /cash must be a non-negative finite number/
  );
  assert.throws(
    () => calculateKpiMetrics({ ...VALID_SHIFT, receipts: 1.5 }),
    /receipts must be a non-negative integer/
  );
  assert.throws(
    () => calculateKpiMetrics({ ...VALID_SHIFT, upsellReceipts: 26 }),
    /upsellReceipts must not exceed receipts/
  );
});
