const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { once } = require('node:events');

const {
  DEFAULT_SERVER_PATHS,
  isValidRunId,
} = require('../config');
const {
  RunRegistryError,
} = require('../storage/file_run_registry');
const {
  createPurchasingWebServer,
} = require('../server');

const RUN_ID = '12121212-1212-4121-8121-121212121212';
const ROW_ID = 'smartzapas:fixture:Лист_1:6';
let temporaryRoot;
let decisionsPath;
let server;
let baseUrl;

const ITEMS = Object.freeze([
  {
    row_id: ROW_ID,
    source_row: 6,
    sku: 'SKU-1',
    barcode: '460000000001',
    name: 'Товар 1',
    brand: 'Бренд',
    supplier: 'Поставщик',
    decision: 'manual_review',
    workflow_status: 'pending_manual_review',
    matrix: { owner_review_required: true },
    stock: { free_stock: 1 },
    sales: { last_28_days: 2 },
    quantities: { provisional_quantity: 3 },
    amounts: { provisional_line_value: 300 },
    owner_decision: {
      status: 'none',
      decision: null,
      quantity: null,
    },
  },
  {
    row_id: 'smartzapas:fixture:Лист_1:7',
    source_row: 7,
    sku: 'SKU-2',
    name: 'Товар 2',
    matrix: { owner_review_required: false },
    quantities: { approved_quantity: 1 },
    amounts: { approved_line_value: 100 },
  },
]);

class FixtureRegistry {
  constructor() {
    this.items = structuredClone(ITEMS);
  }

  getRunStatus(runId) {
    if (!isValidRunId(runId)) {
      throw new RunRegistryError(
        'INVALID_RUN_ID',
        'Run ID должен быть корректным UUID.'
      );
    }
    if (runId !== RUN_ID) {
      throw new RunRegistryError('RUN_NOT_FOUND', 'Run не найден.');
    }
    return {
      run_id: runId,
      status: 'completed',
      stage: 'complete',
    };
  }

  getItems(runId) {
    this.getRunStatus(runId);
    return structuredClone(this.items);
  }
}

async function startServer() {
  server = createPurchasingWebServer({
    registry: new FixtureRegistry(),
    serverPaths: {
      ...DEFAULT_SERVER_PATHS,
      ownerDecisionsPath: decisionsPath,
    },
    now: () => '2026-07-23T10:00:00.000Z',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function stopServer() {
  if (!server?.listening) return;
  server.close();
  await once(server, 'close');
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
}

function decisionUrl(rowId = ROW_ID) {
  return `${baseUrl}/api/v1/runs/${RUN_ID}/items/` +
    `${encodeURIComponent(rowId)}/decision`;
}

before(async () => {
  temporaryRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'purchasing-owner-web-'
  ));
  decisionsPath = path.join(temporaryRoot, 'owner-decisions.json');
  await startServer();
});

after(async () => {
  await stopServer();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('PUT saves BUY in append-only Owner Decisions Memory', async () => {
  const saved = await jsonRequest(decisionUrl(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'BUY', quantity: 7 }),
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.api_version, 'v1');
  assert.equal(saved.body.data.item.owner_decision.decision, 'BUY');
  assert.equal(saved.body.data.item.owner_decision.quantity, 7);
  assert.deepEqual(saved.body.data.owner_decisions, {
    needs_decision: 1,
    confirmed_buy: 1,
    excluded: 0,
    deferred: 0,
  });

  const store = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
  assert.equal(store.decisions.length, 1);
  assert.equal(store.decisions[0].owner_decision, 'BUY');
  assert.equal(store.decisions[0].owner_order_quantity, 7);
  assert.equal(store.decisions[0].decided_by, 'owner-web-ui');
});

test('latest active decision wins and history remains intact', async () => {
  for (const input of [
    { decision: 'SKIP', quantity: 99 },
    { decision: 'DEFER', quantity: 99 },
  ]) {
    const response = await jsonRequest(decisionUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    assert.equal(response.response.status, 200);
  }
  const listed = await jsonRequest(
    `${baseUrl}/api/v1/runs/${RUN_ID}/items`
  );
  assert.equal(listed.body.data.items[0].owner_decision.decision, 'DEFER');
  assert.equal(listed.body.data.items[0].owner_decision.quantity, null);
  assert.equal(
    JSON.parse(fs.readFileSync(decisionsPath, 'utf8')).decisions.length,
    3
  );
});

test('decision persists after server restart', async () => {
  await stopServer();
  await startServer();
  const listed = await jsonRequest(
    `${baseUrl}/api/v1/runs/${RUN_ID}/items?owner_decision=DEFER`
  );
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.data.items.length, 1);
  assert.equal(listed.body.data.items[0].sku, 'SKU-1');
});

test('invalid decision, quantity, item and traversal are rejected safely', async () => {
  const cases = [
    [decisionUrl(), { decision: 'UNKNOWN', quantity: 1 }, 400,
      'INVALID_OWNER_DECISION'],
    [decisionUrl(), { decision: 'BUY', quantity: 1.5 }, 400,
      'INVALID_OWNER_DECISION'],
    [decisionUrl(), { decision: 'BUY', quantity: -1 }, 400,
      'INVALID_OWNER_DECISION'],
    [decisionUrl(), { decision: 'BUY', quantity: 10001 }, 400,
      'INVALID_OWNER_DECISION'],
    [decisionUrl('missing-row'), { decision: 'SKIP', quantity: 0 }, 404,
      'ITEM_NOT_FOUND'],
    [
      `${baseUrl}/api/v1/runs/${RUN_ID}/items/..%252Fsecret/decision`,
      { decision: 'SKIP', quantity: 0 },
      400,
      'INVALID_ITEM_ID',
    ],
    [
      `${baseUrl}/api/v1/runs/34343434-3434-4343-8343-343434343434` +
        `/items/${encodeURIComponent(ROW_ID)}/decision`,
      { decision: 'SKIP', quantity: 0 },
      404,
      'RUN_NOT_FOUND',
    ],
    [
      `${baseUrl}/api/v1/runs/not-a-uuid/items/` +
        `${encodeURIComponent(ROW_ID)}/decision`,
      { decision: 'SKIP', quantity: 0 },
      400,
      'INVALID_RUN_ID',
    ],
  ];
  for (const [url, body, status, code] of cases) {
    const result = await jsonRequest(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(result.response.status, status);
    assert.equal(result.body.error.code, code);
    const serialized = JSON.stringify(result.body);
    assert.equal(serialized.includes('stack'), false);
    assert.equal(serialized.includes(temporaryRoot), false);
  }
});

test('missing decisions filter and counters are deterministic', async () => {
  const missing = await jsonRequest(
    `${baseUrl}/api/v1/runs/${RUN_ID}/items?owner_decision=missing`
  );
  assert.equal(missing.response.status, 200);
  assert.deepEqual(
    missing.body.data.items.map(item => item.sku),
    ['SKU-2']
  );
  assert.deepEqual(missing.body.data.owner_decisions, {
    needs_decision: 1,
    confirmed_buy: 0,
    excluded: 0,
    deferred: 1,
  });
});
