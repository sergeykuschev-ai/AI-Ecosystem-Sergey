'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { aggregateDay, nextRetryDelaySeconds } = require('./aggregation_model');

const base = {
  businessDate: '2026-10-04',
  sourceInstance: 'ut-test',
  sourceUpdatedAt: '2026-10-04T00:00:00+10:00',
  posted: true,
  storeName: 'Миска',
  businessDate: '2026-10-04',
  postedAt: '2026-10-04T10:00:00+10:00',
  updatedAt: '2026-10-04T10:01:00+10:00',
  ref: 'doc-guid',
};

function aggregate(documents, requestedStoreCodes = ['miska']) {
  return aggregateDay({
    businessDate: '2026-10-04',
    sourceInstance: 'ut-test',
    sourceUpdatedAt: '2026-10-04T20:00:00+10:00',
    documents,
    requestedStoreCodes,
  })[0];
}

test('cash, card and SBP returns reduce the actual channel and sold units', () => {
  const sale = {
    ...base,
    type: 'retail_sale',
    cash: 500,
    card: 400,
    qr: 100,
    items: 10,
    cashierRef: 'cashier-guid',
    cashierName: 'Тестовый кассир',
  };
  for (const returnPayment of [
    { cash: 100, card: 0, qr: 0 },
    { cash: 0, card: 100, qr: 0 },
    { cash: 0, card: 0, qr: 100 },
  ]) {
    const result = aggregate([sale, {
      ...base,
      ...returnPayment,
      type: 'retail_return',
      ref: `return-${JSON.stringify(returnPayment)}`,
      items: 1,
    }]);
    assert.equal(result.cash + result.acquiring, 900);
    assert.equal(result.retailSales - result.retailReturns, 900);
    assert.equal(result.itemsSold, 9);
    assert.equal(result.returnReceipts, 1);
  }
});

test('card and SBP in one day keep QR inside acquiring', () => {
  const result = aggregate([{
    ...base,
    type: 'retail_sale',
    cash: 100,
    card: 500,
    qr: 200,
    items: 4,
  }]);
  assert.equal(result.acquiring, 700);
  assert.equal(result.qr, 200);
  assert.equal(result.cash + result.acquiring, 800);
  assert.equal(result.retailSales, 800);
});

test('only posted B2B shipment counts; order and payment never count', () => {
  const result = aggregate([
    { ...base, type: 'customer_order', amount: 1000, ref: 'order' },
    { ...base, type: 'customer_payment', amount: 1000, ref: 'payment' },
    { ...base, type: 'b2b_shipment', amount: 900, items: 3, ref: 'shipment' },
  ]);
  assert.equal(result.b2b, 900);
  assert.equal(result.b2bOrders, 1);
  assert.equal(result.itemsSold, 3);
  assert.equal(result.sourceDocuments.length, 1);
  assert.equal(result.sourceDocuments[0].type, 'b2b_shipment');
});

test('unknown warehouse is excluded and missing cashier does not block store totals', () => {
  const result = aggregate([
    { ...base, type: 'retail_sale', cash: 100, items: 1 },
    { ...base, type: 'retail_sale', storeName: 'Офис XXI ВЕК', cash: 999, items: 9 },
  ]);
  assert.equal(result.cash, 100);
  assert.deepEqual(result.cashiers, []);
});

test('reposting updates the same stable daily record and unposting removes the fact', () => {
  const first = aggregate([{ ...base, type: 'retail_sale', cash: 100, items: 1 }]);
  const reposted = aggregate([{
    ...base,
    type: 'retail_sale',
    cash: 150,
    items: 2,
    updatedAt: '2026-10-04T11:00:00+10:00',
  }]);
  const unposted = aggregate([{ ...base, posted: false, type: 'retail_sale', cash: 150 }]);
  assert.equal(first.recordId, reposted.recordId);
  assert.equal(reposted.cash, 150);
  assert.equal(unposted.recordId, first.recordId);
  assert.equal(unposted.cash, 0);
  assert.equal(unposted.sourceDocuments.length, 0);
});

test('retry schedule backs off and is bounded for temporary API outages', () => {
  assert.deepEqual([1, 2, 3, 8, 20].map(nextRetryDelaySeconds), [30, 60, 120, 3600, 3600]);
});
