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
const {
  OwnerDecisionService,
  ownerDecisionSummary,
  validateWebDecision,
} = require('../application/owner_decision_service');
const {
  OWNER_REVIEW_REASON_CODES,
  loadDecisionHistory,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);

const RUN_ID = '12121212-1212-4121-8121-121212121212';
const ROW_ID = 'smartzapas:fixture:Лист_1:6';
let temporaryRoot;
let decisionsPath;
let decisionHistoryPath;
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
      ownerDecisionHistoryPath: decisionHistoryPath,
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

test('pending decisions require an explicit Owner Review signal', () => {
  const item = (ownerReviewRequired, decision) => ({
    matrix: ownerReviewRequired === undefined
      ? {}
      : { owner_review_required: ownerReviewRequired },
    owner_decision: { decision },
  });
  // DEFER is a made decision: it no longer counts as «нужно решить»,
  // matching the canonical FinalOrderState where DEFER is resolved.
  assert.deepEqual(ownerDecisionSummary([
    item(true, null),
    item(true, 'DEFER'),
    item(true, 'BUY'),
    item(true, 'SKIP'),
    item(false, null),
    item(undefined, null),
  ]), {
    needs_decision: 1,
    confirmed: 0,
    confirmed_buy: 1,
    excluded: 1,
    deferred: 1,
  });
});

test('Owner Review accepts every stable reason code and rejects labels', () => {
  assert.deepEqual(OWNER_REVIEW_REASON_CODES, [
    'HIGH_STOCK',
    'LOW_DEMAND',
    'SEASONAL',
    'MANDATORY',
    'NEW_PRODUCT',
    'CUSTOMER_REQUEST',
    'MINMAX_ERROR',
    'POLICY_ERROR',
    'ALREADY_ORDERED',
    'WAIT_NEXT_DELIVERY',
    'TEST_PRODUCT',
    'SUPPLIER_LIMITATION',
    'PRICE_TOO_HIGH',
    'LOW_MARGIN',
    'MANUAL_EXPERIENCE',
    'OTHER',
  ]);
  for (const reasonCode of OWNER_REVIEW_REASON_CODES) {
    assert.equal(validateWebDecision({
      decision: 'SKIP',
      reasonCode,
      comment: reasonCode === 'OTHER' ? 'Своя причина' : '',
    }).reasonCode, reasonCode);
  }
  assert.throws(
    () => validateWebDecision({
      decision: 'SKIP',
      reasonCode: 'Высокий остаток',
    }),
    /причин[ау] решения/i
  );
});

test('all review items accept BUY, SKIP, and DEFER without a unique SKU', () => {
  const isolatedRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'purchasing-owner-identities-'
  ));
  const isolatedDecisionsPath = path.join(
    isolatedRoot,
    'owner-decisions.json'
  );
  const items = [
    {
      row_id: 'smartzapas:fixture:sheet:8',
      sku: null,
      barcode: null,
      name: 'Товар без артикула',
      brand: 'Бренд',
      matrix: { owner_review_required: true },
    },
    {
      row_id: 'smartzapas:fixture:sheet:9',
      sku: 'DUPLICATE',
      barcode: null,
      name: 'Товар дубль А',
      brand: 'Бренд',
      matrix: { owner_review_required: true },
    },
    {
      row_id: 'smartzapas:fixture:sheet:10',
      sku: 'DUPLICATE',
      barcode: null,
      name: 'Товар дубль Б',
      brand: 'Бренд',
      matrix: { owner_review_required: true },
    },
  ];
  const service = new OwnerDecisionService({
    registry: {
      getItems() {
        return structuredClone(items);
      },
    },
    ownerDecisionsPath: isolatedDecisionsPath,
    now: () => '2026-07-23T11:00:00.000Z',
  });

  try {
    service.saveDecision('run', items[0].row_id, {
      decision: 'BUY',
      quantity: 2,
      reasonCode: 'NEW_PRODUCT',
    });
    service.saveDecision('run', items[1].row_id, {
      decision: 'SKIP',
      quantity: 0,
      reasonCode: 'HIGH_STOCK',
    });
    service.saveDecision('run', items[2].row_id, {
      decision: 'DEFER',
      quantity: null,
      reasonCode: 'WAIT_NEXT_DELIVERY',
    });

    assert.deepEqual(
      service.decorateItems(items).map(
        item => item.owner_decision.decision
      ),
      ['BUY', 'SKIP', 'DEFER']
    );
    const stored = JSON.parse(fs.readFileSync(
      isolatedDecisionsPath,
      'utf8'
    ));
    assert.deepEqual(
      stored.decisions.map(decision => decision.sku),
      [
        'SUPPLIER:UNKNOWN:FALLBACK:БРЕНД|ТОВАР БЕЗ АРТИКУЛА',
        'SUPPLIER:UNKNOWN:FALLBACK:БРЕНД|ТОВАР ДУБЛЬ А',
        'SUPPLIER:UNKNOWN:FALLBACK:БРЕНД|ТОВАР ДУБЛЬ Б',
      ]
    );
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
});

test('changing SKIP to BUY preserves both history events', () => {
  const isolatedRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'purchasing-owner-change-history-'
  ));
  const isolatedDecisionsPath = path.join(
    isolatedRoot,
    'miska-owner-decisions.json'
  );
  const isolatedHistoryPath = path.join(
    isolatedRoot,
    'owner-decision-history.json'
  );
  const service = new OwnerDecisionService({
    registry: new FixtureRegistry(),
    ownerDecisionsPath: isolatedDecisionsPath,
    ownerDecisionHistoryPath: isolatedHistoryPath,
    now: () => '2026-07-23T11:30:00.000Z',
  });

  try {
    service.saveDecision(RUN_ID, ROW_ID, {
      decision: 'SKIP',
      reasonCode: 'HIGH_STOCK',
    });
    service.saveDecision(RUN_ID, ROW_ID, {
      decision: 'BUY',
      quantity: 5,
      reasonCode: 'CUSTOMER_REQUEST',
    });
    const history = loadDecisionHistory({ filePath: isolatedHistoryPath });

    assert.deepEqual(
      history.entries.map(entry => entry.ownerDecision),
      ['SKIP', 'BUY']
    );
    assert.deepEqual(
      history.entries.map(entry => entry.reasonCode),
      ['HIGH_STOCK', 'CUSTOMER_REQUEST']
    );
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
});

before(async () => {
  temporaryRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'purchasing-owner-web-'
  ));
  decisionsPath = path.join(temporaryRoot, 'owner-decisions.json');
  decisionHistoryPath = path.join(
    temporaryRoot,
    'owner-decision-history.json'
  );
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
    body: JSON.stringify({
      decision: 'BUY',
      quantity: 7,
      reasonCode: 'CUSTOMER_REQUEST',
      comment: 'Заказ подтверждён клиентом.',
    }),
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.api_version, 'v1');
  assert.equal(saved.body.data.item.owner_decision.decision, 'BUY');
  assert.equal(saved.body.data.item.owner_decision.quantity, 7);
  assert.deepEqual(saved.body.data.owner_decisions, {
    needs_decision: 0,
    confirmed: 1,
    confirmed_buy: 1,
    excluded: 0,
    deferred: 0,
  });

  const store = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
  assert.equal(store.decisions.length, 1);
  assert.equal(store.decisions[0].owner_decision, 'BUY');
  assert.equal(store.decisions[0].owner_order_quantity, 7);
  assert.equal(store.decisions[0].run_id, RUN_ID);
  assert.equal(store.decisions[0].reason_code, 'CUSTOMER_REQUEST');
  assert.equal(store.decisions[0].comment, 'Заказ подтверждён клиентом.');
  assert.equal(store.decisions[0].decided_by, 'owner-web-ui');
  assert.equal(saved.body.data.decisionHistory.status, 'RECORDED');
  const history = loadDecisionHistory({
    filePath: decisionHistoryPath,
  });
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].source, 'OWNER_REVIEW');
  assert.equal(history.entries[0].runId, RUN_ID);
  assert.equal(history.entries[0].stableItemKey, 'SUPPLIER:ПОСТАВЩИК:SKU:SKU-1');
  assert.equal(history.entries[0].ownerDecision, 'BUY');
  assert.equal(history.entries[0].ownerQuantity, 7);
  assert.equal(history.entries[0].reasonCode, 'CUSTOMER_REQUEST');
  assert.equal(history.entries[0].ownerComment, 'Заказ подтверждён клиентом.');
  assert.equal(history.entries[0].decidedBy, 'owner-web-ui');
});

test('latest active decision wins and history remains intact', async () => {
  for (const input of [
    { decision: 'SKIP', quantity: 99, reasonCode: 'HIGH_STOCK' },
    {
      decision: 'DEFER',
      quantity: 99,
      reasonCode: 'WAIT_NEXT_DELIVERY',
    },
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
  assert.equal(loadDecisionHistory({
    filePath: decisionHistoryPath,
  }).entries.length, 3);
});

test('repeated identical Owner Review decision does not duplicate history',
  async () => {
    const repeated = await jsonRequest(decisionUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: 'DEFER',
        quantity: null,
        reasonCode: 'WAIT_NEXT_DELIVERY',
      }),
    });

    assert.equal(repeated.response.status, 200);
    assert.equal(
      repeated.body.data.decisionHistory.status,
      'DUPLICATE'
    );
    assert.equal(loadDecisionHistory({
      filePath: decisionHistoryPath,
    }).entries.length, 3);
  });

test('legacy API request without reason remains compatible and reads safely',
  async () => {
    const isolatedRoot = fs.mkdtempSync(path.join(
      os.tmpdir(),
      'purchasing-owner-legacy-api-'
    ));
    const isolatedDecisionsPath = path.join(
      isolatedRoot,
      'miska-owner-decisions.json'
    );
    const isolatedHistoryPath = path.join(
      isolatedRoot,
      'owner-decision-history.json'
    );
    const isolatedServer = createPurchasingWebServer({
      registry: new FixtureRegistry(),
      serverPaths: {
        ...DEFAULT_SERVER_PATHS,
        ownerDecisionsPath: isolatedDecisionsPath,
        ownerDecisionHistoryPath: isolatedHistoryPath,
      },
      now: () => '2026-07-23T13:00:00.000Z',
    });
    isolatedServer.listen(0, '127.0.0.1');
    await once(isolatedServer, 'listening');
    const isolatedBase =
      `http://127.0.0.1:${isolatedServer.address().port}`;
    const url = `${isolatedBase}/api/v1/runs/${RUN_ID}/items/` +
      `${encodeURIComponent(ROW_ID)}/decision`;

    try {
      const beforePage = await fetch(`${isolatedBase}/`);
      assert.equal(beforePage.status, 200);
      assert.equal(fs.existsSync(isolatedHistoryPath), false);

      const legacy = await jsonRequest(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'BUY', quantity: 4 }),
      });
      assert.equal(legacy.response.status, 200);
      assert.equal(
        legacy.body.data.item.owner_decision.reason_code,
        null
      );
      const active = JSON.parse(fs.readFileSync(
        isolatedDecisionsPath,
        'utf8'
      ));
      assert.equal(active.decisions[0].reason_code, null);
      assert.equal(active.decisions[0].comment, null);
      let history = loadDecisionHistory({ filePath: isolatedHistoryPath });
      assert.equal(history.entries.length, 1);
      assert.equal(history.entries[0].reasonCode, 'NOT_SPECIFIED');
      assert.equal(history.entries[0].ownerComment, null);

      const listed = await jsonRequest(
        `${isolatedBase}/api/v1/runs/${RUN_ID}/items`
      );
      assert.equal(listed.response.status, 200);
      history = loadDecisionHistory({ filePath: isolatedHistoryPath });
      assert.equal(history.entries.length, 1);

      const otherWithoutComment = await jsonRequest(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'SKIP',
          reasonCode: 'OTHER',
        }),
      });
      assert.equal(otherWithoutComment.response.status, 400);

      const maxComment = await jsonRequest(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'SKIP',
          reasonCode: 'OTHER',
          comment: 'я'.repeat(1000),
        }),
      });
      assert.equal(maxComment.response.status, 200);
      history = loadDecisionHistory({ filePath: isolatedHistoryPath });
      assert.equal(history.entries.length, 2);
    } finally {
      isolatedServer.close();
      await once(isolatedServer, 'close');
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

test('history failure does not block Owner Review persistence', () => {
  const isolatedRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'purchasing-owner-history-failure-'
  ));
  const isolatedDecisionsPath = path.join(
    isolatedRoot,
    'owner-decisions.json'
  );
  const corruptedHistoryPath = path.join(
    isolatedRoot,
    'owner-decision-history.json'
  );
  const warnings = [];
  fs.writeFileSync(corruptedHistoryPath, '{ damaged history', 'utf8');
  const before = fs.readFileSync(corruptedHistoryPath, 'utf8');
  const service = new OwnerDecisionService({
    registry: new FixtureRegistry(),
    ownerDecisionsPath: isolatedDecisionsPath,
    ownerDecisionHistoryPath: corruptedHistoryPath,
    now: () => '2026-07-23T12:00:00.000Z',
    logger: {
      warn(message) { warnings.push(message); },
      error() {},
    },
  });

  try {
    const saved = service.saveDecision(RUN_ID, ROW_ID, {
      decision: 'SKIP',
      quantity: 0,
      reasonCode: 'HIGH_STOCK',
    });

    assert.equal(saved.item.owner_decision.decision, 'SKIP');
    assert.equal(saved.decisionHistory.status, 'UNAVAILABLE');
    assert.equal(
      JSON.parse(
        fs.readFileSync(isolatedDecisionsPath, 'utf8')
      ).decisions.length,
      1
    );
    assert.equal(fs.readFileSync(corruptedHistoryPath, 'utf8'), before);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(
      warnings[0],
      new RegExp(corruptedHistoryPath)
    );
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
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
    [decisionUrl(), {
      decision: 'BUY', quantity: 1, reasonCode: null,
    }, 400,
      'INVALID_OWNER_DECISION'],
    [decisionUrl(), {
      decision: 'BUY', quantity: 1, reasonCode: 'UNKNOWN_REASON',
    }, 400, 'INVALID_OWNER_DECISION'],
    [decisionUrl(), {
      decision: 'BUY', quantity: 1, reasonCode: 'OTHER',
    }, 400, 'INVALID_OWNER_DECISION'],
    [decisionUrl(), {
      decision: 'BUY', quantity: 1, reasonCode: 'OTHER',
      comment: 'x'.repeat(1001),
    }, 400, 'INVALID_OWNER_DECISION'],
    [decisionUrl(), { decision: 'UNKNOWN', quantity: 1 }, 400,
      'INVALID_OWNER_DECISION'],
    [decisionUrl(), { decision: 'BUY', quantity: 1.5 }, 400,
      'INVALID_OWNER_DECISION'],
    [decisionUrl(), { decision: 'BUY', quantity: -1 }, 400,
      'INVALID_OWNER_DECISION'],
    [decisionUrl(), { decision: 'BUY', quantity: 10001 }, 400,
      'INVALID_OWNER_DECISION'],
    [decisionUrl('missing-row'), {
      decision: 'SKIP', quantity: 0, reasonCode: 'HIGH_STOCK',
    }, 404,
      'ITEM_NOT_FOUND'],
    [
      `${baseUrl}/api/v1/runs/${RUN_ID}/items/..%252Fsecret/decision`,
      { decision: 'SKIP', quantity: 0, reasonCode: 'HIGH_STOCK' },
      400,
      'INVALID_ITEM_ID',
    ],
    [
      `${baseUrl}/api/v1/runs/34343434-3434-4343-8343-343434343434` +
        `/items/${encodeURIComponent(ROW_ID)}/decision`,
      { decision: 'SKIP', quantity: 0, reasonCode: 'HIGH_STOCK' },
      404,
      'RUN_NOT_FOUND',
    ],
    [
      `${baseUrl}/api/v1/runs/not-a-uuid/items/` +
        `${encodeURIComponent(ROW_ID)}/decision`,
      { decision: 'SKIP', quantity: 0, reasonCode: 'HIGH_STOCK' },
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
  // The DEFER-red SKU-1 is resolved, so «нужно решить» is 0 even though
  // SKU-2 still lacks an owner decision (it never required one).
  assert.deepEqual(missing.body.data.owner_decisions, {
    needs_decision: 0,
    confirmed: 0,
    confirmed_buy: 0,
    excluded: 0,
    deferred: 1,
  });
});


test('PUT saves BUY as run-scoped with 30-day expiration', async () => {
  const isolatedRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'purchasing-owner-scope-run-'
  ));
  const isolatedDecisionsPath = path.join(
    isolatedRoot,
    'miska-owner-decisions.json'
  );
  const isolatedHistoryPath = path.join(
    isolatedRoot,
    'owner-decision-history.json'
  );
  const isolatedServer = createPurchasingWebServer({
    registry: new FixtureRegistry(),
    serverPaths: {
      ...DEFAULT_SERVER_PATHS,
      ownerDecisionsPath: isolatedDecisionsPath,
      ownerDecisionHistoryPath: isolatedHistoryPath,
    },
    now: () => '2026-07-23T10:00:00.000Z',
  });
  isolatedServer.listen(0, '127.0.0.1');
  await once(isolatedServer, 'listening');
  const isolatedBase =
    `http://127.0.0.1:${isolatedServer.address().port}`;
  const url = `${isolatedBase}/api/v1/runs/${RUN_ID}/items/` +
    `${encodeURIComponent(ROW_ID)}/decision`;

  try {
    const response = await jsonRequest(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: 'BUY',
        quantity: 5,
        reasonCode: 'CUSTOMER_REQUEST',
      }),
    });
    assert.equal(response.response.status, 200);
    const stored = JSON.parse(fs.readFileSync(
      isolatedDecisionsPath,
      'utf8'
    ));
    assert.equal(stored.decisions.length, 1);
    assert.equal(stored.decisions[0].owner_decision, 'BUY');
    assert.equal(stored.decisions[0].scope, 'run');
    assert.equal(stored.decisions[0].expires_at, '2026-08-22T10:00:00.000Z');
    assert.equal(stored.decisions[0].decided_at, '2026-07-23T10:00:00.000Z');
  } finally {
    isolatedServer.close();
    await once(isolatedServer, 'close');
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
});

test('PUT with permanent flag saves BUY as permanent without expiration', async () => {
  const isolatedRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'purchasing-owner-scope-permanent-'
  ));
  const isolatedDecisionsPath = path.join(
    isolatedRoot,
    'miska-owner-decisions.json'
  );
  const isolatedHistoryPath = path.join(
    isolatedRoot,
    'owner-decision-history.json'
  );
  const isolatedServer = createPurchasingWebServer({
    registry: new FixtureRegistry(),
    serverPaths: {
      ...DEFAULT_SERVER_PATHS,
      ownerDecisionsPath: isolatedDecisionsPath,
      ownerDecisionHistoryPath: isolatedHistoryPath,
    },
    now: () => '2026-07-23T10:00:00.000Z',
  });
  isolatedServer.listen(0, '127.0.0.1');
  await once(isolatedServer, 'listening');
  const isolatedBase =
    `http://127.0.0.1:${isolatedServer.address().port}`;
  const url = `${isolatedBase}/api/v1/runs/${RUN_ID}/items/` +
    `${encodeURIComponent(ROW_ID)}/decision`;

  try {
    const response = await jsonRequest(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: 'BUY',
        quantity: 5,
        reasonCode: 'CUSTOMER_REQUEST',
        permanent: true,
      }),
    });
    assert.equal(response.response.status, 200);
    const stored = JSON.parse(fs.readFileSync(
      isolatedDecisionsPath,
      'utf8'
    ));
    assert.equal(stored.decisions.length, 1);
    assert.equal(stored.decisions[0].owner_decision, 'BUY');
    assert.equal(stored.decisions[0].scope, 'permanent');
    assert.equal(stored.decisions[0].expires_at, null);
  } finally {
    isolatedServer.close();
    await once(isolatedServer, 'close');
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
});

test('DEFER is always run-scoped regardless of permanent flag', async () => {
  const isolatedRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'purchasing-owner-defer-scope-'
  ));
  const isolatedDecisionsPath = path.join(
    isolatedRoot,
    'miska-owner-decisions.json'
  );
  const isolatedHistoryPath = path.join(
    isolatedRoot,
    'owner-decision-history.json'
  );
  const isolatedServer = createPurchasingWebServer({
    registry: new FixtureRegistry(),
    serverPaths: {
      ...DEFAULT_SERVER_PATHS,
      ownerDecisionsPath: isolatedDecisionsPath,
      ownerDecisionHistoryPath: isolatedHistoryPath,
    },
    now: () => '2026-07-23T10:00:00.000Z',
  });
  isolatedServer.listen(0, '127.0.0.1');
  await once(isolatedServer, 'listening');
  const isolatedBase =
    `http://127.0.0.1:${isolatedServer.address().port}`;
  const url = `${isolatedBase}/api/v1/runs/${RUN_ID}/items/` +
    `${encodeURIComponent(ROW_ID)}/decision`;

  try {
    const response = await jsonRequest(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: 'DEFER',
        quantity: null,
        reasonCode: 'WAIT_NEXT_DELIVERY',
        permanent: true,
      }),
    });
    assert.equal(response.response.status, 200);
    const stored = JSON.parse(fs.readFileSync(
      isolatedDecisionsPath,
      'utf8'
    ));
    assert.equal(stored.decisions.length, 1);
    assert.equal(stored.decisions[0].owner_decision, 'DEFER');
    assert.equal(stored.decisions[0].scope, 'run');
    assert.equal(stored.decisions[0].expires_at, '2026-08-22T10:00:00.000Z');
  } finally {
    isolatedServer.close();
    await once(isolatedServer, 'close');
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
});
