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
  classifyItem,
} = require('../../../agents/purchasing/services/final_order');
const {
  confirmedItemView,
  createApplication,
  decisionCounterView,
  ERROR_MESSAGES,
  finalOrderView,
  itemMatchesDecisionFilter,
  needsOwnerDecisionView,
  ownerDecisionView,
} = require('../public/app');

// Regression suite for the bug «товары не уходят из списка после решения
// владельца». Semantics under test (explicitly fixed rules):
// - «Нужно решить» = owner_review_required positions without any owner
//   decision. BUY, SKIP and DEFER are all made decisions: the row leaves
//   «Нужно решить» immediately after saving and stays out after reload.
// - DEFER is resolved (aligned with the canonical FinalOrderState): the
//   row remains visible in «Все товары» with the «Отложено» status.
// - «Подтверждены» = owner BUY (quantity > 0) + auto-approved positions,
//   mirroring classifyItem(item).kind === 'included' — the same set that
//   enters the final/supplier order.
// - «Пропущено» = owner SKIP only.
// - «Все товары» keeps every row with its actual decision status; rows
//   that never required an owner decision are labelled
//   «Решение не требуется», so a zero «Нужно решить» counter never
//   contradicts the visible rows.
// - Counters and rows come from one source (owner_decisions summary +
//   the same decorated items).

const RUN_ID = '34343434-3434-4344-8344-343434343434';

const ITEM_A = {
  row_id: 'tabs:fixture:row:6',
  source_row: 6,
  sku: 'TAB-SKU-1',
  name: 'Товар А',
  workflow_status: 'pending_manual_review',
  matrix: { owner_review_required: true },
  quantities: { provisional_quantity: 3 },
  amounts: { unit_price: 100, provisional_line_value: 300 },
};
const ITEM_B = {
  row_id: 'tabs:fixture:row:7',
  source_row: 7,
  sku: 'TAB-SKU-2',
  name: 'Товар Б',
  workflow_status: 'pending_manual_review',
  matrix: { owner_review_required: true },
  quantities: { provisional_quantity: 2 },
  amounts: { unit_price: 50, provisional_line_value: 100 },
};
const ITEM_C = {
  row_id: 'tabs:fixture:row:8',
  source_row: 8,
  sku: 'TAB-SKU-3',
  name: 'Товар В (auto)',
  workflow_status: 'auto_approved',
  matrix: { owner_review_required: false },
  quantities: { approved_quantity: 4 },
  amounts: { unit_price: 25, approved_line_value: 100 },
};
const ITEM_D = {
  row_id: 'tabs:fixture:row:9',
  source_row: 9,
  sku: 'TAB-SKU-4',
  name: 'Товар Г',
  workflow_status: 'no_order_action',
  matrix: { owner_review_required: false },
};
// The regression row for the budget deadlock: workflow says
// pending_manual_review, but owner review never flagged the row, so the
// owner is never asked about it. It must not block review completion.
const ITEM_E = {
  row_id: 'tabs:fixture:row:10',
  source_row: 10,
  sku: 'TAB-SKU-5',
  name: 'Товар Д (pending без review)',
  workflow_status: 'pending_manual_review',
  matrix: { owner_review_required: false },
  quantities: { provisional_quantity: 1 },
  amounts: { unit_price: 30, provisional_line_value: 30 },
};

class FixtureRegistry {
  constructor() {
    this.items = structuredClone(
      [ITEM_A, ITEM_B, ITEM_C, ITEM_D, ITEM_E]
    );
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
    return { run_id: runId, status: 'completed', stage: 'complete' };
  }

  getItems(runId) {
    this.getRunStatus(runId);
    return structuredClone(this.items);
  }

  getRunSummary(runId) {
    this.getRunStatus(runId);
    return {
      run_id: runId,
      sku_count: this.items.length,
      amounts: { analyzer_order_sum: 430 },
      financial: { maximum_safe_order_amount: null },
    };
  }
}

let temporaryRoot;
let decisionsPath;
let decisionHistoryPath;
let server;
let baseUrl;

async function startServer() {
  server = createPurchasingWebServer({
    registry: new FixtureRegistry(),
    serverPaths: {
      ...DEFAULT_SERVER_PATHS,
      ownerDecisionsPath: decisionsPath,
      ownerDecisionHistoryPath: decisionHistoryPath,
    },
    now: () => '2026-07-31T10:00:00.000Z',
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

function itemsUrl(query = '') {
  return `${baseUrl}/api/v1/runs/${RUN_ID}/items${query}`;
}

function decisionUrl(rowId) {
  return `${baseUrl}/api/v1/runs/${RUN_ID}/items/` +
    `${encodeURIComponent(rowId)}/decision`;
}

async function putDecision(rowId, decision, quantity) {
  return jsonRequest(decisionUrl(rowId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, quantity }),
  });
}

function skuList(payload) {
  return payload.body.data.items.map(item => item.sku);
}

before(async () => {
  temporaryRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'purchasing-decision-tabs-'
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

test('1. initial state: auto-approved is confirmed, review rows are missing',
  async () => {
    const missing = await jsonRequest(
      itemsUrl('?owner_review=true&owner_decision=missing')
    );
    assert.deepEqual(skuList(missing), ['TAB-SKU-1', 'TAB-SKU-2']);
    assert.deepEqual(missing.body.data.owner_decisions, {
      needs_decision: 2,
      confirmed: 1,
      confirmed_buy: 0,
      excluded: 0,
      deferred: 0,
    });
    const confirmed = await jsonRequest(
      itemsUrl('?owner_decision=confirmed')
    );
    assert.deepEqual(skuList(confirmed), ['TAB-SKU-3']);
    // Frontend predicates agree with the server-side filters.
    for (const item of missing.body.data.items) {
      assert.equal(needsOwnerDecisionView(item), true);
      assert.equal(confirmedItemView(item), false);
    }
    for (const item of confirmed.body.data.items) {
      assert.equal(confirmedItemView(item), true);
    }
  }
);

test('11. needs_decision > 0 blocks budget optimization (409)', async () => {
  const listed = await jsonRequest(itemsUrl());
  const summary = listed.body.data.owner_decisions;
  assert.equal(summary.needs_decision, 2);
  const finalOrder = await jsonRequest(
    `${baseUrl}/api/v1/runs/${RUN_ID}/final-order`
  );
  assert.equal(finalOrder.body.data.reviewComplete, false);
  // One source of truth: unresolved ≡ needs_decision.
  assert.equal(
    finalOrder.body.data.unresolvedCount,
    summary.needs_decision
  );
  const attempt = await jsonRequest(
    `${baseUrl}/api/v1/runs/${RUN_ID}/budget-optimization`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetBudget: 100 }),
    }
  );
  assert.equal(attempt.response.status, 409);
  assert.equal(attempt.body.error.code, 'OWNER_REVIEW_INCOMPLETE');
});

test('2. BUY immediately removes the row from «Нужно решить»', async () => {
  const saved = await putDecision(ITEM_A.row_id, 'BUY', 5);
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.data.item.owner_decision.decision, 'BUY');
  assert.equal(
    itemMatchesDecisionFilter(saved.body.data.item, 'needs'),
    false
  );
  const missing = await jsonRequest(
    itemsUrl('?owner_review=true&owner_decision=missing')
  );
  assert.deepEqual(skuList(missing), ['TAB-SKU-2']);
});

test('3. «Нужно решить» counter decrements after BUY', async () => {
  const listed = await jsonRequest(itemsUrl());
  assert.equal(listed.body.data.owner_decisions.needs_decision, 1);
  assert.equal(
    decisionCounterView(
      listed.body.data.owner_decisions,
      listed.body.data.pagination.total_items
    ).needsDecision,
    '1'
  );
});

test('4. «Подтверждены» counter grows and the BUY row joins the tab',
  async () => {
    const listed = await jsonRequest(itemsUrl());
    const summary = listed.body.data.owner_decisions;
    assert.equal(summary.confirmed_buy, 1);
    assert.equal(summary.confirmed, 2); // BUY + auto-approved
    const confirmed = await jsonRequest(
      itemsUrl('?owner_decision=confirmed')
    );
    assert.deepEqual(skuList(confirmed), ['TAB-SKU-1', 'TAB-SKU-3']);
    for (const item of confirmed.body.data.items) {
      assert.equal(confirmedItemView(item), true);
      assert.equal(classifyItem(item).kind, 'included');
    }
  }
);

test('5. SKIP immediately removes the row and fills «Пропущено»', async () => {
  const saved = await putDecision(ITEM_B.row_id, 'SKIP', 0);
  assert.equal(saved.response.status, 200);
  assert.equal(
    itemMatchesDecisionFilter(saved.body.data.item, 'needs'),
    false
  );
  assert.equal(
    itemMatchesDecisionFilter(saved.body.data.item, 'skip'),
    true
  );
  const summary = saved.body.data.owner_decisions;
  assert.equal(summary.needs_decision, 0);
  assert.equal(summary.excluded, 1);
  const missing = await jsonRequest(
    itemsUrl('?owner_review=true&owner_decision=missing')
  );
  assert.deepEqual(skuList(missing), []);
  const skipped = await jsonRequest(itemsUrl('?owner_decision=SKIP'));
  assert.deepEqual(skuList(skipped), ['TAB-SKU-2']);
});

test('6. decisions survive a full reload (server restart)', async () => {
  await stopServer();
  await startServer();
  const missing = await jsonRequest(
    itemsUrl('?owner_review=true&owner_decision=missing')
  );
  assert.deepEqual(skuList(missing), []);
  assert.deepEqual(missing.body.data.owner_decisions, {
    needs_decision: 0,
    confirmed: 2,
    confirmed_buy: 1,
    excluded: 1,
    deferred: 0,
  });
  const confirmed = await jsonRequest(
    itemsUrl('?owner_decision=confirmed')
  );
  assert.deepEqual(skuList(confirmed), ['TAB-SKU-1', 'TAB-SKU-3']);
});

test('7. active tab is not reset to «Все товары» after saving', async () => {
  const requests = [];
  const summaryBefore = {
    needs_decision: 1,
    confirmed: 0,
    confirmed_buy: 0,
    excluded: 0,
    deferred: 0,
  };
  const summaryAfter = { ...summaryBefore, needs_decision: 0 };
  let decided = false;
  const undecidedItem = {
    row_id: 'tabs:app:row:1',
    source_row: 1,
    sku: 'APP-SKU-1',
    name: 'Товар из приложения',
    workflow_status: 'pending_manual_review',
    matrix: { owner_review_required: true },
    quantities: { provisional_quantity: 2 },
    amounts: { unit_price: 10, provisional_line_value: 20 },
    owner_decision: { status: 'none', decision: null, quantity: null },
  };
  const mockFetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    if ((options.method || 'GET') === 'PUT') {
      decided = true;
      return {
        ok: true,
        async json() {
          return {
            data: {
              item: {
                ...undecidedItem,
                owner_decision: {
                  status: 'active',
                  decision: 'BUY',
                  quantity: 2,
                },
              },
              owner_decisions: summaryAfter,
            },
          };
        },
      };
    }
    const parsed = new URL(url, 'http://localhost');
    const isUndecided =
      parsed.searchParams.get('owner_review') === 'true' &&
      parsed.searchParams.get('owner_decision') === 'missing';
    const items = isUndecided && !decided ? [undecidedItem] : [];
    return {
      ok: true,
      async json() {
        return {
          data: {
            items,
            pagination: {
              page: 1,
              page_size: 25,
              total_items: items.length,
              total_pages: items.length ? 1 : 0,
            },
            owner_decisions: decided ? summaryAfter : summaryBefore,
          },
        };
      },
    };
  };
  const application = createApplication(
    fakeAppDocument(),
    mockFetch
  );
  await application.activateItems(
    `/api/v1/runs/${RUN_ID}/items`
  );
  // The default filter resolved to «Нужно решить».
  const lastGet = () => [...requests]
    .reverse()
    .find(request => request.method === 'GET');
  assert.match(lastGet().url, /owner_review=true/);
  assert.match(lastGet().url, /owner_decision=missing/);
  // Click «Заказать» on the rendered row.
  const body = applicationInternals.productsBody;
  const actionGroup = body.children[0].children[5].children[1].children[1];
  await actionGroup.children[0].listeners.click[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  // The silent reload after saving keeps the active «Нужно решить» tab
  // even though the counter reached 0 (the default would be «Все товары»).
  assert.match(lastGet().url, /owner_review=true/);
  assert.match(lastGet().url, /owner_decision=missing/);
});

test('8. no «Решение не принято» rows remain when unresolved is zero',
  async () => {
    const listed = await jsonRequest(itemsUrl('?page_size=100'));
    assert.equal(listed.body.data.owner_decisions.needs_decision, 0);
    for (const item of listed.body.data.items) {
      assert.notEqual(
        ownerDecisionView(item).label,
        'Решение не принято'
      );
    }
    // Rows that never required an owner decision get an explicit label.
    assert.equal(
      ownerDecisionView({
        workflow_status: 'auto_approved',
        matrix: { owner_review_required: false },
        owner_decision: { decision: null },
      }).label,
      'Решение не требуется'
    );
    // Rows still waiting for the owner keep the actionable label.
    assert.equal(
      ownerDecisionView({
        workflow_status: 'pending_manual_review',
        matrix: { owner_review_required: true },
        owner_decision: { decision: null },
      }).label,
      'Решение не принято'
    );
  }
);

test('9. frontend and backend filter semantics match exactly', () => {
  const decisions = [
    { decision: null, quantity: null },
    { decision: 'BUY', quantity: 3 },
    { decision: 'BUY', quantity: 0 },
    { decision: 'SKIP', quantity: 0 },
    { decision: 'DEFER', quantity: null },
  ];
  const workflows = [
    'auto_approved',
    'pending_manual_review',
    'no_order_action',
  ];
  for (const ownerDecision of decisions) {
    for (const workflowStatus of workflows) {
      for (const reviewRequired of [true, false]) {
        for (const approved of [0, 2]) {
          const item = {
            workflow_status: workflowStatus,
            matrix: { owner_review_required: reviewRequired },
            quantities: { approved_quantity: approved },
            owner_decision: ownerDecision,
          };
          assert.equal(
            confirmedItemView(item),
            classifyItem(item).kind === 'included',
            `confirmed mismatch: ${JSON.stringify(item)}`
          );
          assert.equal(
            needsOwnerDecisionView(item),
            reviewRequired === true && ownerDecision.decision === null,
            `needs mismatch: ${JSON.stringify(item)}`
          );
        }
      }
    }
  }
});

test('10. DEFER leaves «Нужно решить», stays in «Все товары» as «Отложено»',
  async () => {
    const saved = await putDecision(ITEM_A.row_id, 'DEFER', null);
    assert.equal(saved.response.status, 200);
    assert.equal(
      itemMatchesDecisionFilter(saved.body.data.item, 'needs'),
      false
    );
    assert.equal(
      itemMatchesDecisionFilter(saved.body.data.item, 'confirmed'),
      false
    );
    const summary = saved.body.data.owner_decisions;
    assert.equal(summary.needs_decision, 0);
    assert.equal(summary.deferred, 1);
    assert.equal(summary.confirmed, 1); // only the auto-approved row
    const confirmed = await jsonRequest(
      itemsUrl('?owner_decision=confirmed')
    );
    assert.deepEqual(skuList(confirmed), ['TAB-SKU-3']);
    const missing = await jsonRequest(
      itemsUrl('?owner_review=true&owner_decision=missing')
    );
    assert.deepEqual(skuList(missing), []);
    const all = await jsonRequest(itemsUrl('?page_size=100'));
    const deferredRow = all.body.data.items
      .find(item => item.sku === 'TAB-SKU-1');
    assert.equal(deferredRow.owner_decision.decision, 'DEFER');
    assert.equal(ownerDecisionView(deferredRow).label, 'Отложено');
    assert.equal(
      itemMatchesDecisionFilter(deferredRow, 'all'),
      true
    );
  }
);

test('12. needs_decision = 0 allows optimization; pending workflow alone never blocks',
  async () => {
    // ITEM_E (workflow pending_manual_review, no owner review flag, no
    // decision) is still undecided — the exact row that deadlocked
    // optimization before the fix.
    const listed = await jsonRequest(itemsUrl());
    const summary = listed.body.data.owner_decisions;
    assert.equal(summary.needs_decision, 0);
    const finalOrder = await jsonRequest(
      `${baseUrl}/api/v1/runs/${RUN_ID}/final-order`
    );
    assert.equal(finalOrder.body.data.reviewComplete, true);
    assert.equal(finalOrder.body.data.unresolvedCount, 0);
    // The invariant in one place:
    assert.equal(
      summary.needs_decision === 0,
      finalOrder.body.data.reviewComplete
    );
    const optimized = await jsonRequest(
      `${baseUrl}/api/v1/runs/${RUN_ID}/budget-optimization`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetBudget: 80 }),
      }
    );
    assert.equal(optimized.response.status, 200);
    assert.ok(optimized.body.data.optimizedTotal <= 80);
    assert.equal(
      optimized.body.data.originalTotal,
      finalOrder.body.data.totalAmount
    );
  }
);

test('13. UI reads the same review flag and message as the backend', () => {
  const incomplete = finalOrderView({
    reviewComplete: false,
    itemCount: 5,
    unresolvedCount: 2,
    totalAmount: 100,
    autoApprovedAmount: 60,
    unresolvedAmount: 40,
  });
  assert.equal(incomplete.ownerReviewCount, '2 позиций для решения');
  assert.equal(incomplete.runStatus, null);
  const complete = finalOrderView({
    reviewComplete: true,
    itemCount: 5,
    unresolvedCount: 0,
    totalAmount: 100,
    autoApprovedAmount: 100,
    unresolvedAmount: 0,
  });
  assert.equal(
    complete.ownerReviewCount,
    '0 позиций для решения · проверка завершена'
  );
  assert.equal(complete.runStatus, 'Проверка завершена');
  // The budget block shows the server-side error code text — the UI has
  // no separate «review complete» computation of its own.
  assert.equal(
    ERROR_MESSAGES.OWNER_REVIEW_INCOMPLETE,
    'Завершите ручную проверку всех позиций перед оптимизацией под бюджет.'
  );
});

// --- App-level fake DOM (test 7) -----------------------------------------

let applicationInternals;

function fakeAppElement(tagName = 'div') {
  return {
    tagName,
    children: [],
    className: '',
    dataset: {},
    attributes: {},
    listeners: {},
    hidden: false,
    textContent: '',
    disabled: false,
    value: '',
    checked: false,
    open: false,
    style: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains: () => false,
    },
    append(...children) {
      this.children.push(...children);
    },
    prepend(...children) {
      this.children.unshift(...children);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = [...children];
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener(name, listener) {
      this.listeners[name] ||= [];
      this.listeners[name].push(listener);
    },
    removeEventListener() {},
    querySelector: () => fakeAppElement(),
    querySelectorAll: () => [],
    closest: () => fakeAppElement('th'),
    focus() {},
    click() {},
    close() {},
    showModal() {},
    show() {},
    remove() {},
    set innerHTML(value) {
      throw new Error(`Unsafe innerHTML assignment: ${value}`);
    },
  };
}

function fakeAppDocument() {
  const byId = new Map();
  const documentObject = {
    createElement: tagName => fakeAppElement(tagName),
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, fakeAppElement());
      return byId.get(id);
    },
    querySelectorAll: () => [],
    addEventListener() {},
    body: fakeAppElement('body'),
  };
  applicationInternals = {
    get productsBody() {
      return documentObject.getElementById('products-body');
    },
  };
  return documentObject;
}
