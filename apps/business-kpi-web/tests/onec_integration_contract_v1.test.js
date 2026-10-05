'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeRecord } = require('../application/onec_integration_service');

function record(overrides = {}) {
  return {
    recordId: 'miska:2026-10-04',
    storeCode: 'miska',
    businessDate: '2026-10-04',
    sourceUpdatedAt: '2026-10-04T20:00:00+10:00',
    cash: 400,
    acquiring: 500,
    qr: 200,
    b2b: 250,
    b2bOrders: 1,
    receipts: 8,
    itemsSold: 12,
    retailSales: 1000,
    retailReturns: 100,
    returnReceipts: 1,
    ...overrides,
  };
}

test('v1 contract represents cash, card and SBP returns without double-counting QR', () => {
  for (const breakdown of [
    { cashReturns: 100, cardReturns: 0, qrReturns: 0 },
    { cashReturns: 0, cardReturns: 100, qrReturns: 0 },
    { cashReturns: 0, cardReturns: 0, qrReturns: 100 },
  ]) {
    const normalized = normalizeRecord(record(breakdown), 0);
    assert.equal(normalized.cash + normalized.acquiring, 900);
    assert.equal(normalized.retailSales - normalized.retailReturns, 900);
    assert.equal(normalized.qr, 200);
    assert.equal(
      normalized.cashReturns + normalized.cardReturns + normalized.qrReturns,
      100
    );
  }
});

test('v1 contract preserves cashier and source-document provenance', () => {
  const normalized = normalizeRecord(record({
    cashiers: [{
      ref: 'e1cib/data/Справочник.Пользователи?ref=cashier-guid',
      code: 'MISKA-001',
      name: 'Тестовый кассир',
      receipts: 8,
      itemsSold: 12,
    }],
    organizationRefs: ['e1cib/data/Справочник.Организации?ref=org-guid'],
    sourceDocuments: [{
      type: 'retail_sale',
      ref: 'e1cib/data/Документ.ЧекККМ?ref=receipt-guid',
      number: 'TEST-1',
      postedAt: '2026-10-04T12:00:00+10:00',
      updatedAt: '2026-10-04T12:01:00+10:00',
      warehouseRef: 'e1cib/data/Справочник.Склады?ref=miska-guid',
      organizationRef: 'e1cib/data/Справочник.Организации?ref=org-guid',
      cashierRef: 'e1cib/data/Справочник.Пользователи?ref=cashier-guid',
    }],
  }), 0);
  assert.equal(normalized.cashiers[0].name, 'Тестовый кассир');
  assert.equal(normalized.sourceDocuments[0].type, 'retail_sale');
  assert.equal(normalized.organizationRefs.length, 1);
});

test('v1 contract rejects QR double-counting and inconsistent return breakdowns', () => {
  assert.throws(
    () => normalizeRecord(record({ acquiring: 100, qr: 200 }), 0),
    error => error.code === 'ONEC_VALIDATION_ERROR'
  );
  assert.throws(
    () => normalizeRecord(record({
      cashReturns: 10,
      cardReturns: 20,
      qrReturns: 30,
    }), 0),
    error => error.code === 'ONEC_VALIDATION_ERROR'
  );
  assert.throws(
    () => normalizeRecord(record({ retailSales: 1200 }), 0),
    error => error.code === 'ONEC_VALIDATION_ERROR'
  );
});

test('v1 contract remains compatible with legacy returnsAmount payloads', () => {
  const normalized = normalizeRecord(record({
    retailSales: undefined,
    retailReturns: undefined,
    returnsAmount: 100,
  }), 0);
  assert.equal(normalized.retailReturns, 100);
  assert.equal(normalized.retailSales, 1000);
  assert.equal(normalized.returnsAmount, 100);
});
