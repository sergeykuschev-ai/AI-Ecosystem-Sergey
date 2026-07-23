const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { once } = require('node:events');

const {
  createPurchasingWebServer,
} = require('../server');
const {
  FrontendError,
  buildItemsUrl,
  buildDecisionUrl,
  createItemRow,
  createItemRows,
  decisionCounterView,
  defaultDecisionFilter,
  formatRub,
  itemMatchesDecisionFilter,
  needsOwnerDecisionView,
  paginationLabel,
  plainReason,
  pollRunStatus,
  renderItemRows,
  requestNeedsDecisionItems,
  requestJson,
  selectArtifacts,
  setProductsPanelState,
  summaryView,
  technicalExplanation,
} = require('../public/app');

const PUBLIC_ROOT = path.resolve(__dirname, '../public');
let server;
let baseUrl;

async function rawRequest(requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
  });
}

function fakeElement(tagName = 'div') {
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
    append(...children) {
      this.children.push(...children);
    },
    prepend(...children) {
      this.children.unshift(...children);
    },
    replaceChildren(...children) {
      this.children = [...children];
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    addEventListener(name, listener) {
      this.listeners[name] ||= [];
      this.listeners[name].push(listener);
    },
    set innerHTML(value) {
      throw new Error(`Unsafe innerHTML assignment: ${value}`);
    },
  };
}

function fakeDocument() {
  return {
    createElement(tagName) {
      return fakeElement(tagName);
    },
  };
}

function panelElements() {
  return {
    products: fakeElement(),
    productsLoading: fakeElement(),
    productsError: fakeElement(),
    productsEmpty: fakeElement(),
    productsContent: fakeElement(),
  };
}

before(async () => {
  server = createPurchasingWebServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    server.close();
    await once(server, 'close');
  }
});

test('GET / serves the Russian frontend with secure headers', async () => {
  const response = await fetch(`${baseUrl}/`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'text/html; charset=utf-8'
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(body, /AI-агент закупщик «Миска»/);
  assert.match(body, /id="products"[\s\S]*hidden/);
  assert.match(body, /Товары к закупке/);
  assert.doesNotMatch(body, /Скачать результаты/);
  assert.match(body, />\s*Экспорт\s*</);
  for (const label of [
    'Полный отчёт',
    'Result JSON',
    'Решения владельца',
    'Объяснения рекомендаций',
  ]) {
    assert.match(body, new RegExp(label));
  }
  for (const heading of [
    'Товар',
    'Остаток',
    'Продажи 28 дней',
    'Рекомендовано',
    'Сумма',
    'Решение',
  ]) {
    assert.match(body, new RegExp(`>\\s*${heading}`));
  }
  assert.doesNotMatch(body, /<th>Бренд<\/th>/);
  assert.doesNotMatch(body, /<th[^>]*>Цена<\/th>/);
  assert.doesNotMatch(body, /<th[^>]*>Owner Review<\/th>/);
  assert.doesNotMatch(body, /<th[^>]*>Причина<\/th>/);
  for (const label of [
    'Все товары',
    'Нужно решить',
    'Подтверждены',
    'Не заказывать',
  ]) {
    assert.match(body, new RegExp(`>\\s*${label}\\s*<`));
  }
  assert.doesNotMatch(
    body,
    />\s*(?:Owner Review|manual review|BUY|SKIP|DEFER)\s*</i
  );
});

test('products panel stays hidden before completed and opens when ready', () => {
  const elements = panelElements();
  setProductsPanelState(elements, 'hidden');
  assert.equal(elements.products.hidden, true);
  setProductsPanelState(elements, 'ready');
  assert.equal(elements.products.hidden, false);
  assert.equal(elements.productsContent.hidden, false);
  assert.equal(elements.productsLoading.hidden, true);
});

test('whitelisted CSS and JavaScript have correct content types', async () => {
  const [css, script] = await Promise.all([
    fetch(`${baseUrl}/styles.css`),
    fetch(`${baseUrl}/app.js`),
  ]);
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(css.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(script.status, 200);
  assert.equal(
    script.headers.get('content-type'),
    'text/javascript; charset=utf-8'
  );
  assert.equal(script.headers.get('x-content-type-options'), 'nosniff');
});

test('unknown static paths return 404 without directory listing', async () => {
  const response = await fetch(`${baseUrl}/public/`);
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'ROUTE_NOT_FOUND');
  assert.equal(body.api_version, 'v1');
});

test('static traversal attempts are rejected', async () => {
  for (const requestPath of [
    '/..%2fserver.js',
    '/%252e%252e%252fserver.js',
    '/..%5cserver.js',
    '/%00app.js',
  ]) {
    const response = await rawRequest(requestPath);
    assert.equal(response.statusCode, 400, requestPath);
    assert.equal(
      JSON.parse(response.body).error.code,
      'INVALID_STATIC_PATH',
      requestPath
    );
  }
});

test('frontend assets contain no external URL or remote dependency', () => {
  for (const name of ['index.html', 'styles.css', 'app.js']) {
    const source = fs.readFileSync(path.join(PUBLIC_ROOT, name), 'utf8');
    assert.doesNotMatch(source, /https?:\/\//i, name);
  }
});

test('decision controls wrap as a whole and remain readable', () => {
  const css = fs.readFileSync(path.join(PUBLIC_ROOT, 'styles.css'), 'utf8');
  assert.match(
    css,
    /\.decision-controls\s*\{[^}]*flex-wrap:\s*wrap/s
  );
  assert.match(
    css,
    /\.decision-action-group\s*\{[^}]*min-width:\s*238px[^}]*flex-wrap:\s*nowrap/s
  );
  assert.match(
    css,
    /\.decision-action\s*\{[^}]*white-space:\s*nowrap/s
  );
  assert.doesNotMatch(
    css,
    /\.decision-action\s*\{[^}]*font-size:\s*0\.6[0-9]rem/s
  );
});

test('decision tabs are large, counted and do not use horizontal scrolling', () => {
  const css = fs.readFileSync(path.join(PUBLIC_ROOT, 'styles.css'), 'utf8');
  assert.match(
    css,
    /\.product-filters\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s
  );
  assert.match(
    css,
    /\.product-filters button\s*\{[^}]*min-height:\s*52px/s
  );
  assert.doesNotMatch(
    css,
    /\.product-filters\s*\{[^}]*overflow-x:\s*auto/s
  );
});

test('narrow viewport uses cards without horizontal table scrolling', () => {
  const css = fs.readFileSync(path.join(PUBLIC_ROOT, 'styles.css'), 'utf8');
  const narrowStyles = css.match(
    /@media \(max-width: 899px\) \{([\s\S]*?)\n\}\n\n@media \(max-width: 820px\)/
  )?.[1] || '';
  assert.match(narrowStyles, /\.table-scroll\s*\{[^}]*overflow-x:\s*visible/s);
  assert.match(
    narrowStyles,
    /\.table-scroll \.product-row\s*\{[^}]*display:\s*grid/s
  );
  assert.match(
    narrowStyles,
    /\.table-scroll table,[^}]*min-width:\s*0/s
  );
});

test('RUB and summary formatting preserve distinct monetary amounts', () => {
  const formatted = formatRub(1234567.8);
  assert.match(formatted, /1[\s\u00a0]234[\s\u00a0]567,80/);
  assert.match(formatted, /₽/);
  assert.equal(formatRub(null), '—');

  const view = summaryView({
    sku_count: 403,
    amounts: {
      analyzer_order_sum: 1,
      auto_approved_sum: 2,
      pending_review_sum: 3,
      working_maximum_sum: 4,
      financially_assessed_sum: 5,
    },
    financial: { status: 'red' },
    owner_review: { action_required: 17 },
  }, {
    started_at: '2026-07-23T00:00:00.000Z',
    completed_at: '2026-07-23T00:00:05.000Z',
  });

  assert.match(view.analyzerOrderSum, /1,00/);
  assert.match(view.autoApprovedSum, /2,00/);
  assert.match(view.pendingReviewSum, /3,00/);
  assert.match(view.workingMaximumSum, /4,00/);
  assert.match(view.financiallyAssessedSum, /5,00/);
  assert.equal(view.ownerReviewCount, '17');
  assert.equal(view.calculationTime, '5 сек');
});

test('polling stops on completed and failed run statuses', async () => {
  const statuses = ['processing', 'completed'];
  let calls = 0;
  const completed = await pollRunStatus({
    fetchFunction: async () => ({
      ok: true,
      async json() {
        return {
          data: {
            status: statuses[calls++],
          },
        };
      },
    }),
    statusUrl: '/api/v1/runs/fixture',
    intervalMs: 0,
    sleep: async () => {},
  });
  assert.equal(completed.status, 'completed');
  assert.equal(calls, 2);

  await assert.rejects(
    pollRunStatus({
      fetchFunction: async () => ({
        ok: true,
        async json() {
          return { data: { status: 'failed' } };
        },
      }),
      statusUrl: '/api/v1/runs/fixture',
    }),
    error => error.code === 'RUN_FAILED'
  );
});

test('polling has a deterministic timeout', async () => {
  let timestamp = 0;
  await assert.rejects(
    pollRunStatus({
      fetchFunction: async () => ({
        ok: true,
        async json() {
          return { data: { status: 'processing' } };
        },
      }),
      statusUrl: '/api/v1/runs/fixture',
      intervalMs: 1000,
      timeoutMs: 2000,
      now: () => timestamp,
      sleep: async delay => {
        timestamp += delay;
      },
    }),
    error => error.code === 'POLL_TIMEOUT'
  );
});

test('artifact buttons accept only whitelisted manifest download URLs', () => {
  const selected = selectArtifacts({
    artifacts: [
      {
        name: 'result.json',
        download_url:
          '/api/v1/runs/11111111-1111-4111-8111-111111111111' +
          '/artifacts/result.json',
      },
      {
        name: 'owner-review-report.md',
        download_url: '../../private/owner-review-report.md',
      },
      {
        name: 'user-input.xlsx',
        download_url:
          '/api/v1/runs/11111111-1111-4111-8111-111111111111' +
          '/artifacts/user-input.xlsx',
      },
    ],
  });
  assert.deepEqual(Object.keys(selected), ['result']);
  assert.equal(selected.result.name, 'result.json');
});

test('item search and filters use server-side query parameters', () => {
  const baseUrl =
    '/api/v1/runs/11111111-1111-4111-8111-111111111111/items';
  const search = new URL(buildItemsUrl(baseUrl, {
    page: 1,
    pageSize: 25,
    q: 'AWARD 7173648',
    filter: 'all',
    sort: 'source_row',
    order: 'asc',
  }), 'http://localhost');
  assert.equal(search.searchParams.get('q'), 'AWARD 7173648');
  assert.equal(search.searchParams.get('page_size'), '25');

  const undecided = new URL(buildItemsUrl(baseUrl, {
    filter: 'undecided',
  }), 'http://localhost');
  assert.equal(undecided.searchParams.get('owner_review'), 'true');
  assert.equal(undecided.searchParams.get('owner_decision'), 'missing');
  const deferred = new URL(buildItemsUrl(baseUrl, {
    filter: 'deferred',
  }), 'http://localhost');
  assert.equal(deferred.searchParams.get('owner_review'), 'true');
  assert.equal(deferred.searchParams.get('owner_decision'), 'DEFER');
  assert.equal(
    buildDecisionUrl(baseUrl, 'smartzapas:row%20one'),
    `${baseUrl}/smartzapas%3Arow%2520one/decision`
  );
});

test('amount sorting and pagination are encoded deterministically', () => {
  const baseUrl =
    '/api/v1/runs/11111111-1111-4111-8111-111111111111/items';
  const url = new URL(buildItemsUrl(baseUrl, {
    page: 2,
    pageSize: 50,
    filter: 'all',
    sort: 'recommended_line_value',
    order: 'desc',
  }), 'http://localhost');
  assert.equal(url.searchParams.get('sort'), 'recommended_line_value');
  assert.equal(url.searchParams.get('order'), 'desc');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('page_size'), '50');
  assert.equal(paginationLabel({
    page: 2,
    page_size: 50,
    total_items: 123,
  }), 'Показано 51–100 из 123');
});

test('owner decision counters map updated API totals', () => {
  const initial = decisionCounterView({
    needs_decision: 17,
    confirmed_buy: 8,
    excluded: 4,
    deferred: 2,
  }, 31);
  assert.deepEqual(initial, {
    all: '31',
    needsDecision: '17',
    confirmedBuy: '8',
    excluded: '4',
  });
  const afterBuy = decisionCounterView({
    needs_decision: 16,
    confirmed_buy: 9,
    excluded: 4,
    deferred: 2,
  }, 31);
  assert.equal(afterBuy.needsDecision, '16');
  assert.equal(afterBuy.confirmedBuy, '9');
});

test('decision tab defaults to unresolved work and falls back to all', () => {
  assert.equal(defaultDecisionFilter({
    needs_decision: 2,
    deferred: 0,
  }), 'needs');
  assert.equal(defaultDecisionFilter({
    needs_decision: 0,
    deferred: 1,
  }), 'all');
  assert.equal(defaultDecisionFilter({
    needs_decision: 0,
    deferred: 0,
  }), 'all');
});

test('decision tabs show the correct owner choices', () => {
  const undecided = {
    matrix: { owner_review_required: true },
    owner_decision: { decision: null },
  };
  const confirmed = { owner_decision: { decision: 'BUY' } };
  const skipped = { owner_decision: { decision: 'SKIP' } };
  const deferred = {
    matrix: { owner_review_required: true },
    owner_decision: { decision: 'DEFER' },
  };
  const automatic = {
    matrix: { owner_review_required: false },
    owner_decision: { decision: null },
  };
  const items = [undecided, confirmed, skipped, deferred, automatic];

  assert.deepEqual(
    items.filter(item => itemMatchesDecisionFilter(item, 'all')),
    items
  );
  assert.deepEqual(
    items.filter(item => itemMatchesDecisionFilter(item, 'needs')),
    [undecided, deferred]
  );
  assert.deepEqual(
    items.filter(item => itemMatchesDecisionFilter(item, 'confirmed')),
    [confirmed]
  );
  assert.deepEqual(
    items.filter(item => itemMatchesDecisionFilter(item, 'skip')),
    [skipped]
  );
});

test('missing Owner Review signal never makes an item unresolved', () => {
  assert.equal(needsOwnerDecisionView({
    matrix: { owner_review_required: true },
    owner_decision: { decision: null },
  }), true);
  assert.equal(needsOwnerDecisionView({
    matrix: { owner_review_required: false },
    owner_decision: { decision: null },
  }), false);
  assert.equal(needsOwnerDecisionView({
    matrix: {},
    owner_decision: { decision: null },
  }), false);
});

test('unresolved tab combines reviewed missing and deferred without duplicates', async () => {
  const summary = {
    needs_decision: 3,
    confirmed_buy: 1,
    excluded: 1,
    deferred: 2,
  };
  const reviewedItem = (rowId, sourceRow, decision) => ({
    row_id: rowId,
    source_row: sourceRow,
    matrix: { owner_review_required: true },
    owner_decision: { decision },
  });
  const source = {
    missing: [
      reviewedItem('row-2', 2, null),
      reviewedItem('row-1', 1, null),
    ],
    DEFER: [
      reviewedItem('row-1', 1, 'DEFER'),
      reviewedItem('row-3', 3, 'DEFER'),
    ],
  };
  const requestedOwnerReview = [];
  const fetchFunction = async requestUrl => {
    const url = new URL(requestUrl, 'http://localhost');
    requestedOwnerReview.push(url.searchParams.get('owner_review'));
    const ownerDecision = url.searchParams.get('owner_decision');
    const items = source[ownerDecision] || [];
    return {
      ok: true,
      async json() {
        return {
          data: {
            items,
            pagination: {
              page: 1,
              page_size: 100,
              total_items: items.length,
              total_pages: items.length ? 1 : 0,
            },
            owner_decisions: summary,
          },
        };
      },
    };
  };

  const payload = await requestNeedsDecisionItems(
    fetchFunction,
    '/api/v1/runs/11111111-1111-4111-8111-111111111111/items',
    {
      page: 1,
      pageSize: 25,
      q: '',
      sort: 'source_row',
      order: 'asc',
    }
  );
  assert.deepEqual(
    payload.items.map(item => item.row_id),
    ['row-1', 'row-2', 'row-3']
  );
  assert.equal(payload.pagination.total_items, 3);
  assert.deepEqual(payload.owner_decisions, summary);
  assert.ok(requestedOwnerReview.every(value => value === 'true'));
});

test('final choices leave unresolved tab while defer remains', async () => {
  async function choose(decision) {
    const documentObject = fakeDocument();
    const item = {
      row_id: `row-${decision}`,
      source_row: 1,
      quantities: { provisional_quantity: 2 },
      matrix: { owner_review_required: true },
      owner_decision: { decision: null, quantity: null },
    };
    const rows = createItemRows(documentObject, item, {
      async onDecision(input) {
        return {
          item: {
            ...input.item,
            owner_decision: {
              status: 'active',
              decision: input.decision,
              quantity: input.quantity,
            },
          },
        };
      },
      onSaved(_result, savedItem) {
        return {
          remove: !itemMatchesDecisionFilter(savedItem, 'needs'),
        };
      },
    });
    const actionGroup = rows[0].children[5].children[1].children[1];
    const buttonIndex = { BUY: 0, SKIP: 1, DEFER: 2 }[decision];
    await actionGroup.children[buttonIndex].listeners.click[0]();
    return rows[0].hidden;
  }

  assert.equal(await choose('BUY'), true);
  assert.equal(await choose('SKIP'), true);
  assert.equal(await choose('DEFER'), false);
});

test('item renderer treats API text as textContent', () => {
  const documentObject = fakeDocument();
  const malicious = '<img src=x onerror=alert(1)>';
  const rows = createItemRows(documentObject, {
    sku: malicious,
    name: malicious,
    supplier: malicious,
    decision: 'manual_review',
    workflow_status: 'pending_manual_review',
    stock: { free_stock: 1 },
    sales: { last_28_days: 2 },
    quantities: { provisional_quantity: 3 },
    amounts: { unit_price: 10, provisional_line_value: 30 },
    matrix: { owner_review_required: true },
    explanation: { summary: malicious },
  });

  const row = rows[0];
  const details = rows[1];
  const expand = row.children[0].children[0];
  assert.equal(expand.children[0].textContent, malicious);
  assert.equal(expand.children[1].textContent, `Артикул: ${malicious}`);
  assert.equal(expand.children[2].textContent, malicious);
  assert.match(
    details.children[0].children[0].children[0].textContent,
    /окончательное решение/
  );
  assert.equal(details.hidden, true);
  const technical = details.children[0].children[0].children[4];
  assert.equal(technical.open, false);
  assert.equal(
    technical.children[0].textContent,
    'Показать технические детали'
  );
  expand.listeners.click[0]();
  assert.equal(details.hidden, false);
  assert.equal(expand.attributes['aria-expanded'], 'true');
});

test('plain-language reasons cover missing stock and EXIT review', () => {
  const reason = plainReason({
    matrix: {
      role: 'EXIT',
      owner_review_required: true,
      reason_codes: ['possible_exit_candidate'],
      missing_fields: ['free_stock'],
    },
  });
  assert.match(reason, /В отчёте нет остатка/);
  assert.match(reason, /Товар предложен к выводу/);
  assert.doesNotMatch(reason, /possible_exit_candidate/);
  assert.doesNotMatch(
    reason,
    /Matrix Builder|EXIT|DTO|overlay|manual review|Purchasing Agent/
  );

  const technical = technicalExplanation({
    explanation: {
      summary:
        'Товар предложен к EXIT готовым результатом Matrix Builder; ' +
        'требуется manual review Purchasing Agent.',
    },
  });
  assert.doesNotMatch(
    technical,
    /EXIT|Matrix Builder|manual review|Purchasing Agent/
  );
});

test('owner action saves once, updates the row and rolls back on error', async () => {
  const documentObject = fakeDocument();
  const item = {
    row_id: 'row-1',
    sku: 'SKU-1',
    name: 'Товар',
    quantities: { provisional_quantity: 3 },
    amounts: { provisional_line_value: 30 },
    matrix: {},
    owner_decision: { decision: null, quantity: null },
  };
  const calls = [];
  const [row] = createItemRows(documentObject, item, {
    async onDecision(input) {
      calls.push({
        decision: input.decision,
        quantity: input.quantity,
      });
      return {
        item: {
          ...input.item,
          owner_decision: {
            status: 'active',
            decision: input.decision,
            quantity: input.quantity,
          },
        },
      };
    },
  });
  const decisionCell = row.children[5];
  const controls = decisionCell.children[1];
  const actionGroup = controls.children[1];
  const buyButton = actionGroup.children[0];
  controls.children[0].value = '9';
  await buyButton.listeners.click[0]();
  assert.deepEqual(calls[0], { decision: 'BUY', quantity: 9 });
  assert.equal(item.owner_decision.decision, 'BUY');
  assert.equal(decisionCell.children[2].textContent, 'Сохранено');
  await actionGroup.children[1].listeners.click[0]();
  assert.deepEqual(calls[1], { decision: 'SKIP', quantity: 0 });
  assert.equal(item.owner_decision.decision, 'SKIP');
  await actionGroup.children[2].listeners.click[0]();
  assert.deepEqual(calls[2], { decision: 'DEFER', quantity: null });
  assert.equal(item.owner_decision.decision, 'DEFER');

  const failingItem = structuredClone(item);
  const [failingRow] = createItemRows(documentObject, failingItem, {
    async onDecision() {
      throw new FrontendError('OWNER_DECISION_STORAGE_ERROR');
    },
  });
  const failingDecisionCell = failingRow.children[5];
  const skipButton =
    failingDecisionCell.children[1].children[1].children[1];
  await skipButton.listeners.click[0]();
  assert.equal(failingItem.owner_decision.decision, 'DEFER');
  assert.match(failingDecisionCell.children[2].textContent, /Не удалось/);
});

test('owner action exposes saving state and prevents a second click', async () => {
  const documentObject = fakeDocument();
  let complete;
  let calls = 0;
  const [row] = createItemRows(documentObject, {
    row_id: 'row-1',
    sku: 'SKU-1',
    quantities: { provisional_quantity: 2 },
    matrix: {},
    owner_decision: { decision: null, quantity: null },
  }, {
    onDecision() {
      calls += 1;
      return new Promise(resolve => {
        complete = resolve;
      });
    },
  });
  const decisionCell = row.children[5];
  const controls = decisionCell.children[1];
  const actions = controls.children[1];
  const pending = actions.children[0].listeners.click[0]();
  assert.equal(decisionCell.children[2].textContent, 'Сохраняем…');
  assert.equal(actions.children[0].disabled, true);
  assert.equal(actions.children[1].disabled, true);
  complete({
    item: {
      owner_decision: {
        status: 'active',
        decision: 'BUY',
        quantity: 2,
      },
    },
  });
  await pending;
  assert.equal(calls, 1);
  assert.equal(actions.children[0].disabled, false);
  assert.equal(decisionCell.children[2].textContent, 'Сохранено');
});

test('API error and empty item list have explicit UI states', async () => {
  await assert.rejects(
    requestJson(async () => ({
      ok: false,
      async json() {
        return { error: { code: 'RUN_FAILED' } };
      },
    }), '/api/v1/runs/fixture/items'),
    error => error.code === 'RUN_FAILED'
  );

  const errorElements = panelElements();
  setProductsPanelState(errorElements, 'error');
  assert.equal(errorElements.products.hidden, false);
  assert.equal(errorElements.productsError.hidden, false);

  const body = fakeElement('tbody');
  renderItemRows(fakeDocument(), body, []);
  assert.equal(body.children.length, 0);
  setProductsPanelState(errorElements, 'empty');
  assert.equal(errorElements.productsEmpty.hidden, false);
});
