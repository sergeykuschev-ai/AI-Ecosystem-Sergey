'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PurchaseLedgerService,
  monthKey,
  orderFingerprint,
} = require('../application/purchase_ledger_service');

function fixtureOrder(amount = 1000) {
  return {
    totalAmount: amount,
    rows: [
      {
        article: 'SKU-1',
        name: 'Товар 1',
        quantity: 2,
        price: amount / 2,
        amount,
      },
    ],
  };
}

function withService(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchase-ledger-'));
  const service = new PurchaseLedgerService({
    filePath: path.join(root, 'ledger.json'),
    timeZone: 'Asia/Vladivostok',
  });
  try {
    return callback(service, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('monthKey uses business timezone around UTC month boundary', () => {
  assert.equal(monthKey('2026-08-31T16:30:00.000Z'), '2026-09');
});

test('configured baseline and limit persist and calculate remaining', () => {
  withService(service => {
    service.configureMonth({
      limit: 350000,
      purchased: 280000,
      at: '2026-09-17T10:00:00.000Z',
    });
    const summary = service.getMonthSummary('2026-09-17T10:01:00.000Z');
    assert.equal(summary.limit, 350000);
    assert.equal(summary.purchased, 280000);
    assert.equal(summary.remaining, 70000);
  });
});

test('future orders are automatically added after the manual baseline', () => {
  withService(service => {
    service.configureMonth({
      limit: 350000,
      purchased: 280000,
      at: '2026-09-17T10:00:00.000Z',
    });
    service.recordOrder({
      runId: 'run-1',
      supplier: 'АО ВАЛТА ПЕТ ПРОДАКТС',
      order: fixtureOrder(12000),
      orderedAt: '2026-09-17T10:05:00.000Z',
    });
    const summary = service.getMonthSummary('2026-09-17T10:06:00.000Z');
    assert.equal(summary.ledgerOrdersPurchased, 12000);
    assert.equal(summary.purchased, 292000);
    assert.equal(summary.remaining, 58000);
  });
});

test('orders before a refreshed baseline are not double counted', () => {
  withService(service => {
    service.recordOrder({
      runId: 'run-before',
      supplier: 'Валта',
      order: fixtureOrder(10000),
      orderedAt: '2026-09-10T10:00:00.000Z',
    });
    service.configureMonth({
      limit: 300000,
      purchased: 150000,
      at: '2026-09-17T10:00:00.000Z',
    });
    assert.equal(
      service.getMonthSummary('2026-09-17T10:01:00.000Z').purchased,
      150000
    );
  });
});

test('same run download is idempotent and updates instead of duplicating', () => {
  withService(service => {
    const first = service.recordOrder({
      runId: 'run-1', supplier: 'Валта', order: fixtureOrder(1000),
      orderedAt: '2026-09-17T10:00:00.000Z',
    });
    const second = service.recordOrder({
      runId: 'run-1', supplier: 'Валта', order: fixtureOrder(1000),
      orderedAt: '2026-09-17T10:01:00.000Z',
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.changed, false);
    assert.equal(service.listOrders().length, 1);
  });
});

test('cancelled order is excluded from monthly purchased amount', () => {
  withService(service => {
    service.configureMonth({
      limit: 10000, purchased: 0, at: '2026-09-17T09:00:00.000Z',
    });
    const recorded = service.recordOrder({
      runId: 'run-1', supplier: 'Валта', order: fixtureOrder(1000),
      orderedAt: '2026-09-17T10:00:00.000Z',
    });
    service.changeOrderStatus(
      recorded.order.orderId,
      'CANCELLED',
      '2026-09-17T11:00:00.000Z'
    );
    assert.equal(
      service.getMonthSummary('2026-09-17T11:01:00.000Z').purchased,
      0
    );
  });
});

test('received order remains part of monthly purchases but not active queue', () => {
  withService(service => {
    service.configureMonth({
      limit: 10000, purchased: 0, at: '2026-09-17T09:00:00.000Z',
    });
    const recorded = service.recordOrder({
      runId: 'run-1', supplier: 'Валта', order: fixtureOrder(1000),
      orderedAt: '2026-09-17T10:00:00.000Z',
    });
    service.changeOrderStatus(
      recorded.order.orderId,
      'RECEIVED',
      '2026-09-17T11:00:00.000Z'
    );
    const summary = service.getMonthSummary('2026-09-17T11:01:00.000Z');
    assert.equal(summary.purchased, 1000);
    assert.equal(summary.activeOrderCount, 0);
  });
});

test('exact duplicate from another active run is detected across supplier aliases', () => {
  withService(service => {
    service.recordOrder({
      runId: 'old-run',
      supplier: 'АКЦИОНЕРНОЕ ОБЩЕСТВО "ВАЛТА ПЕТ ПРОДАКТС"',
      order: fixtureOrder(1000),
      orderedAt: '2026-09-15T10:00:00.000Z',
    });
    const risk = service.findDuplicateRisk({
      runId: 'new-run',
      supplier: 'АО ВАЛТА ПЕТ ПРОДАКТС',
      order: fixtureOrder(1000),
      asOf: '2026-09-17T10:00:00.000Z',
    });
    assert.ok(risk.exactDuplicate);
    assert.equal(risk.overlapCount, 1);
  });
});

test('received order does not trigger duplicate risk', () => {
  withService(service => {
    const recorded = service.recordOrder({
      runId: 'old-run', supplier: 'Валта', order: fixtureOrder(1000),
      orderedAt: '2026-09-15T10:00:00.000Z',
    });
    service.changeOrderStatus(
      recorded.order.orderId,
      'RECEIVED',
      '2026-09-16T10:00:00.000Z'
    );
    const risk = service.findDuplicateRisk({
      runId: 'new-run', supplier: 'Валта', order: fixtureOrder(1000),
      asOf: '2026-09-17T10:00:00.000Z',
    });
    assert.equal(risk.exactDuplicate, null);
    assert.equal(risk.overlapCount, 0);
  });
});

test('resolveFinancialOverrides reuses persisted budget when next run sends no fields', () => {
  withService(service => {
    const first = service.resolveFinancialOverrides({
      monthly_purchase_limit: 50000,
      purchased_this_month: 10000,
    }, '2026-09-17T10:00:00.000Z');
    assert.deepEqual(first, {
      monthly_purchase_limit: 50000,
      purchased_this_month: 10000,
    });
    service.recordOrder({
      runId: 'run-1', supplier: 'Валта', order: fixtureOrder(2500),
      orderedAt: '2026-09-17T11:00:00.000Z',
    });
    const second = service.resolveFinancialOverrides(
      null,
      '2026-09-17T12:00:00.000Z'
    );
    assert.deepEqual(second, {
      monthly_purchase_limit: 50000,
      purchased_this_month: 12500,
    });
  });
});

test('orderFingerprint is stable for canonical supplier aliases', () => {
  assert.equal(
    orderFingerprint('Оникиенко Роман Евгеньевич', fixtureOrder().rows),
    orderFingerprint('ЗООГРАД-ХАБАРОВСК ООО', fixtureOrder().rows)
  );
});


test('invoice amount replaces ordered reserve in monthly spend', () => {
  withService(service => {
    service.configureMonth({ limit: 200000, purchased: 50000, at: '2026-09-17T10:00:00.000Z' });
    const recorded = service.recordOrder({
      runId: 'invoice-run',
      supplier: 'Валта',
      order: fixtureOrder(100000),
      orderedAt: '2026-09-17T10:05:00.000Z',
    });
    assert.equal(service.getMonthSummary('2026-09-17T10:06:00.000Z').purchased, 150000);
    const changed = service.setInvoiceAmount(recorded.order.orderId, 92000, '2026-09-17T10:07:00.000Z');
    assert.equal(changed.order.totalAmount, 100000);
    assert.equal(changed.order.invoiceAmount, 92000);
    const summary = service.getMonthSummary('2026-09-17T10:08:00.000Z');
    assert.equal(summary.purchased, 142000);
    assert.equal(summary.remaining, 58000);
  });
});
