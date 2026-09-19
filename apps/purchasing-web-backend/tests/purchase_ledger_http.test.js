'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');

const {
  createPurchasingWebServer,
} = require('../server');
const {
  PurchaseLedgerService,
} = require('../application/purchase_ledger_service');

async function json(url, options) {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
}

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-http-'));
  const ledgerPath = path.join(root, 'purchase-ledger.json');
  const now = () => '2026-09-17T10:00:00.000Z';
  const service = new PurchaseLedgerService({ filePath: ledgerPath, now });
  service.configureMonth({ limit: 350000, purchased: 280000, at: now() });
  const recorded = service.recordOrder({
    runId: 'run-test',
    supplier: 'Валта',
    order: {
      totalAmount: 10000,
      rows: [{ article: 'SKU-1', name: 'Товар', quantity: 2, price: 5000, amount: 10000 }],
    },
    orderedAt: '2026-09-17T10:05:00.000Z',
  });
  const server = createPurchasingWebServer({
    runsRoot: path.join(root, 'runs'),
    uploadRoot: path.join(root, 'uploads'),
    purchaseLedgerService: service,
    now,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    root,
    service,
    orderId: recorded.order.orderId,
    server,
    base: `http://127.0.0.1:${server.address().port}`,
  };
}

test('purchase budget API returns persisted and automatically accumulated spend', async () => {
  const f = await fixture();
  try {
    const result = await json(`${f.base}/api/v1/purchase-budget/current`);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.limit, 350000);
    assert.equal(result.body.data.purchased, 290000);
    assert.equal(result.body.data.remaining, 60000);
  } finally {
    f.server.close();
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('purchase orders API lists journal entries', async () => {
  const f = await fixture();
  try {
    const result = await json(`${f.base}/api/v1/purchase-orders?month=2026-09`);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.orders.length, 1);
    assert.equal(result.body.data.orders[0].status, 'ORDERED');
  } finally {
    f.server.close();
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('purchase order status API moves an order to received and removes duplicate risk', async () => {
  const f = await fixture();
  try {
    const changed = await json(
      `${f.base}/api/v1/purchase-orders/${encodeURIComponent(f.orderId)}/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RECEIVED' }),
      }
    );
    assert.equal(changed.response.status, 200);
    assert.equal(changed.body.data.status, 'RECEIVED');
    assert.equal(f.service.getMonthSummary('2026-09-17T10:06:00.000Z').activeOrderCount, 0);
  } finally {
    f.server.close();
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
