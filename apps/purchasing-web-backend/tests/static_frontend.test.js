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
  analyticsViewState,
  buildAnalyticsUrl,
  buildCandidatesUrl,
  buildLifecyclePayload,
  buildLifecycleStatusUrl,
  buildMaterializedRulesUrl,
  buildMaterializationPayload,
  buildMaterializationUrl,
  buildItemsUrl,
  buildDecisionUrl,
  candidateViewState,
  candidateLifecycleActions,
  confidenceLabel,
  createCandidateCard,
  createMaterializedRuleCard,
  createItemRow,
  createItemRows,
  decisionCounterView,
  decisionLabel,
  defaultDecisionFilter,
  eligibilityLabel,
  filterCandidates,
  formatSignedQuantity,
  formatRub,
  formatPercent,
  itemMatchesDecisionFilter,
  lifecycleErrorMessage,
  lifecycleStatusLabel,
  materializedRuleSafetyLabel,
  materializedRuleStatusLabel,
  materializedRulesViewState,
  needsOwnerDecisionView,
  paginationLabel,
  plainReason,
  priorityLabel,
  patternLabel,
  pollRunStatus,
  renderItemRows,
  renderAnalytics,
  renderCandidateCards,
  renderCandidateSummary,
  renderMaterializedRuleCards,
  renderMaterializedRuleDetail,
  renderMaterializedRulesSummary,
  resetCandidateFilters,
  resetMaterializedRulesFilters,
  requestNeedsDecisionItems,
  requestJson,
  selectArtifacts,
  setHistoryPanelState,
  setCandidatePanelState,
  setMaterializedRulesPanelState,
  setProductsPanelState,
  shouldShowMaterialize,
  summaryView,
  technicalExplanation,
  reasonLabel,
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

function historyElements() {
  return {
    historyLoading: fakeElement(),
    historyEmpty: fakeElement(),
    historyNoResults: fakeElement(),
    historyUnavailable: fakeElement(),
    historyInvalid: fakeElement(),
    historyContent: fakeElement(),
    historyDecisionDistribution: fakeElement('dl'),
    historyReasons: fakeElement('tbody'),
    historyPatterns: fakeElement('tbody'),
    historyItems: fakeElement('tbody'),
    historySummary: {
      total: fakeElement('strong'),
      items: fakeElement('strong'),
      brands: fakeElement('strong'),
      suppliers: fakeElement('strong'),
      agreements: fakeElement('strong'),
      disagreements: fakeElement('strong'),
      agreementRate: fakeElement('strong'),
    },
  };
}

function candidateElements() {
  return {
    candidateLoading: fakeElement(),
    candidateEmpty: fakeElement(),
    candidateNoPatterns: fakeElement(),
    candidateNoResults: fakeElement(),
    candidateUnavailable: fakeElement(),
    candidateInvalid: fakeElement(),
    candidateContent: fakeElement(),
    candidateList: fakeElement(),
    candidateSupplier: { value: 'Валта' },
    candidateBrand: { value: 'AWARD' },
    candidateDecision: { value: 'SKIP' },
    candidateReason: { value: 'LOW_SALES' },
    candidateDateFrom: { value: '2026-07-01' },
    candidateDateTo: { value: '2026-07-25' },
    candidateEligibility: { value: 'ELIGIBLE' },
    candidateConfidence: { value: 'VERY_HIGH' },
    candidatePriority: { value: 'CRITICAL' },
    candidateSummary: {
      total: fakeElement('strong'),
      eligible: fakeElement('strong'),
      reviewOnly: fakeElement('strong'),
      ineligible: fakeElement('strong'),
      highPriority: fakeElement('strong'),
      criticalPriority: fakeElement('strong'),
    },
  };
}

function candidateFixture(overrides = {}) {
  return {
    candidateId: 'private-candidate-id',
    patternType: 'SAME_ITEM_SAME_DECISION',
    scopeType: 'ITEM',
    scopeKey: 'technical-scope-key',
    displayScope: {
      primary: '<img src=x onerror=alert(1)>',
      secondary: null,
    },
    proposedAction: {
      decision: 'SKIP',
      quantityStrategy: 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    confidence: { score: 86, level: 'VERY_HIGH' },
    ranking: {
      priorityScore: 79,
      priorityLevel: 'CRITICAL',
      rank: 1,
    },
    evidence: {
      occurrences: 7,
      dominantShare: 0.875,
      firstRecordedAt: '2026-01-01T00:00:00.000Z',
      lastRecordedAt: '2026-07-20T00:00:00.000Z',
      historySpanDays: 200,
      evidenceDecisionIds: ['private-decision-id'],
    },
    impact: {
      estimatedAffectedItems: 1,
      estimatedHistoricalQuantityDelta: -12,
      hasFinancialEstimate: false,
    },
    eligibility: {
      status: 'ELIGIBLE',
      reasons: ['ELIGIBLE_STRICT_CRITERIA_MET'],
    },
    explanation: {
      headline: 'Повторяющееся решение по товару',
      summary:
        'В истории обнаружено повторяющееся решение SKIP по товару.',
      details: ['Повторений: 7'],
      strengths: ['Высокая повторяемость'],
      risks: ['Есть противоречия'],
      recommendedOwnerAction: 'REVIEW_AND_APPROVE',
      explanationCodes: ['HIGH_CONFIDENCE'],
    },
    ownerComment: 'private comment',
    metadata: { private: true },
    ...overrides,
  };
}

function materializedRulesElements() {
  const input = value => ({ value });
  return {
    materializedRulesLoading: fakeElement(),
    materializedRulesEmpty: fakeElement(),
    materializedRulesNoResults: fakeElement(),
    materializedRulesUnavailable: fakeElement(),
    materializedRulesInvalid: fakeElement(),
    materializedRulesNetwork: fakeElement(),
    materializedRulesContent: fakeElement(),
    materializedRulesStatus: input('DISABLED'),
    materializedRulesDecision: input('SKIP'),
    materializedRulesConfidence: input('VERY_HIGH'),
    materializedRulesPriority: input('HIGH'),
    materializedRulesLifecycle: input('APPROVED'),
    materializedRulesAvailability: input('UNAVAILABLE'),
    materializedRulesDateFrom: input('2026-07-01'),
    materializedRulesDateTo: input('2026-07-25'),
    materializedRulesSearch: input('AWARD 7177004'),
    materializedRulesSummary: {
      total: fakeElement('strong'),
      active: fakeElement('strong'),
      disabled: fakeElement('strong'),
      buy: fakeElement('strong'),
      skip: fakeElement('strong'),
      defer: fakeElement('strong'),
    },
    materializedRuleDetail: Object.fromEntries(
      [
        'name',
        'sku',
        'decision',
        'quantity',
        'status',
        'source',
        'confidence',
        'priority',
        'eligibility',
        'lifecycle',
        'created',
        'updated',
        'safety',
      ].map(name => [name, fakeElement()])
    ),
  };
}

function materializedRuleFixture(overrides = {}) {
  return {
    ruleId: 'approved-rule-private-id',
    status: 'DISABLED',
    ruleType: 'ITEM_DECISION_OVERRIDE',
    displayScope: {
      primary: '<img src=x onerror=alert(1)>',
      secondary: '7177004',
    },
    action: {
      decision: 'SKIP',
      quantityStrategy: 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    source: {
      type: 'OWNER_LEARNING_CANDIDATE',
      label: 'Кандидат Owner Learning',
    },
    provenance: {
      candidateId: 'private-candidate-id',
      patternType: 'SAME_ITEM_SAME_DECISION',
      confidenceScore: 91,
      confidenceLevel: 'VERY_HIGH',
      priorityScore: 88,
      priorityLevel: 'HIGH',
      eligibilityStatus: 'ELIGIBLE',
      materializedAt: '2026-07-25T04:00:00.000Z',
      materializationVersion: 'v0.9.0',
    },
    lifecycle: {
      status: 'APPROVED',
      lastAction: 'APPROVE',
      lastRecordedAt: '2026-07-24T04:00:00.000Z',
      reasonCode: 'READY_FOR_RULE',
    },
    candidateAvailability: { status: 'UNAVAILABLE' },
    timestamps: {
      createdAt: '2026-07-25T04:00:00.000Z',
      updatedAt: '2026-07-25T04:00:00.000Z',
    },
    safety: {
      affectsPurchasing: false,
      message: 'Правило неактивно и не влияет на закупку.',
    },
    ...overrides,
  };
}

function descendantText(element) {
  return [
    element.textContent,
    ...(element.children || []).map(descendantText),
  ].join(' ');
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
  const productsBody = body.match(
    /<section\s+class="products card"[\s\S]*?<\/section>/
  )?.[0] || '';
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
    assert.match(productsBody, new RegExp(`>\\s*${heading}`));
  }
  assert.doesNotMatch(productsBody, /<th>Бренд<\/th>/);
  assert.doesNotMatch(productsBody, /<th[^>]*>Цена<\/th>/);
  assert.doesNotMatch(productsBody, /<th[^>]*>Owner Review<\/th>/);
  assert.doesNotMatch(productsBody, /<th[^>]*>Причина<\/th>/);
  for (const label of [
    'Все товары',
    'Нужно решить',
    'Подтверждены',
    'Не заказывать',
  ]) {
    assert.match(body, new RegExp(`>\\s*${label}\\s*<`));
  }
  assert.doesNotMatch(
    productsBody,
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

test('decision history block and all safe UI states are present', async () => {
  const response = await fetch(`${baseUrl}/`);
  const body = await response.text();

  assert.match(body, /id="decision-history"/);
  assert.match(body, />История решений</);
  assert.match(body, /id="history-loading"/);
  assert.match(body, /id="history-empty"/);
  assert.match(body, /id="history-unavailable"/);
  assert.match(body, /id="history-invalid"/);
  assert.match(body, /id="history-no-results"/);
  assert.match(
    body,
    /История решений временно недоступна\. Работа закупщика не затронута\./
  );
});

test('analytics labels use neutral Russian owner language', () => {
  assert.equal(decisionLabel('BUY'), 'Купить');
  assert.equal(decisionLabel('SKIP'), 'Пропустить');
  assert.equal(decisionLabel('DEFER'), 'Отложить');
  assert.equal(decisionLabel('REVIEW'), 'Проверить');
  assert.equal(reasonLabel('LOW_SALES'), 'Низкие продажи');
  assert.equal(
    patternLabel('AGENT_DISAGREEMENT_REPEAT'),
    'Повторные расхождения с агентом'
  );
  assert.equal(formatPercent(null), '—');
  assert.match(formatPercent(0.75), /75/);
});

test('analytics filters build a new backend request', () => {
  const url = new URL(buildAnalyticsUrl({
    supplier: 'Валта & Ко',
    brand: 'Alpha',
    ownerDecision: 'SKIP',
    reasonCode: 'LOW_SALES',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-25',
  }), 'http://local');

  assert.equal(
    url.pathname,
    '/api/v1/owner-learning/decision-history/analytics'
  );
  assert.equal(url.searchParams.get('supplier'), 'Валта & Ко');
  assert.equal(url.searchParams.get('brand'), 'Alpha');
  assert.equal(url.searchParams.get('ownerDecision'), 'SKIP');
  assert.equal(url.searchParams.get('reasonCode'), 'LOW_SALES');
  assert.equal(url.searchParams.get('dateFrom'), '2026-07-01');
  assert.equal(url.searchParams.get('dateTo'), '2026-07-25');
  assert.equal(url.searchParams.get('maxItems'), '100');
});

test('analytics state distinguishes empty, unavailable and no results', () => {
  assert.equal(analyticsViewState({ status: 'UNAVAILABLE' }), 'unavailable');
  assert.equal(analyticsViewState({
    status: 'AVAILABLE',
    data: { population: { totalEntries: 0, filteredEntries: 0 } },
  }), 'empty');
  assert.equal(analyticsViewState({
    status: 'AVAILABLE',
    data: { population: { totalEntries: 4, filteredEntries: 0 } },
  }), 'no-results');

  const elements = historyElements();
  setHistoryPanelState(elements, 'loading');
  assert.equal(elements.historyLoading.hidden, false);
  setHistoryPanelState(elements, 'unavailable');
  assert.equal(elements.historyUnavailable.hidden, false);
  setHistoryPanelState(elements, 'invalid');
  assert.equal(elements.historyInvalid.hidden, false);
});

test('analytics renderer shows summary, labels, patterns and item table safely', () => {
  const elements = historyElements();
  const maliciousName = '<img src=x onerror=alert(1)>';
  renderAnalytics(fakeDocument(), elements, {
    population: {
      totalEntries: 3,
      filteredEntries: 3,
      uniqueItems: 1,
      uniqueBrands: 1,
      uniqueSuppliers: 1,
    },
    agreementAnalysis: {
      agreements: 2,
      disagreements: 1,
      agreementRate: 2 / 3,
    },
    ownerDecisionDistribution: {
      BUY: 2,
      SKIP: 1,
      DEFER: 0,
      REVIEW: 0,
    },
    reasonDistribution: [{
      reasonCode: 'LOW_SALES',
      count: 1,
      share: 1 / 3,
      ownerComment: 'private',
    }],
    itemAnalytics: [{
      stableItemKey: 'technical:key:must-not-render',
      sku: 'SKU-1',
      productName: maliciousName,
      brand: 'Alpha',
      supplier: 'Валта',
      totalEntries: 3,
      dominantOwnerDecision: 'BUY',
      agreements: 2,
      disagreements: 1,
      agreementRate: null,
      averageOwnerQuantity: null,
      ownerQuantityDeltaAverage: null,
      lastRecordedAt: null,
      metadata: { private: true },
      decisionId: 'private-id',
      ownerComment: 'private',
    }],
    repeatedDecisionPatterns: [{
      patternType: 'SAME_ITEM_SAME_DECISION',
      scopeType: 'ITEM',
      scopeKey: 'technical:key:must-not-render',
      occurrences: 3,
      dominantValue: 'BUY',
      share: 1,
      firstRecordedAt: '2026-07-01T00:00:00.000Z',
      lastRecordedAt: '2026-07-03T00:00:00.000Z',
      evidenceDecisionIds: ['private-id'],
    }],
  });

  assert.equal(elements.historySummary.total.textContent, '3');
  assert.equal(elements.historySummary.agreements.textContent, '2');
  const visible = descendantText({
    children: [
      elements.historyDecisionDistribution,
      elements.historyReasons,
      elements.historyPatterns,
      elements.historyItems,
    ],
    textContent: '',
  });
  assert.match(visible, /Купить/);
  assert.match(visible, /Низкие продажи/);
  assert.match(visible, /Повторяется одно решение по товару/);
  assert.match(visible, /<img src=x onerror=alert\(1\)>/);
  assert.match(visible, /—/);
  for (const forbidden of [
    'technical:key:must-not-render',
    'private-id',
    'ownerComment',
    'metadata',
  ]) {
    assert.equal(visible.includes(forbidden), false);
  }
});

test('candidate lifecycle dashboard and confirmation modal are present', async () => {
  const response = await fetch(`${baseUrl}/`);
  const body = await response.text();
  const section = body.match(
    /<section[\s\S]*?id="learning-candidates"[\s\S]*?<\/section>/
  )?.[0] || '';

  assert.match(body, /id="learning-candidates"/);
  assert.match(body, />Кандидаты для обучения</);
  assert.match(
    body,
    /Кандидаты сформированы по истории решений и предназначены только\s+для ручной проверки\. Никакие правила автоматически не создаются\s+и не применяются\./
  );
  for (const id of [
    'candidate-loading',
    'candidate-empty',
    'candidate-no-patterns',
    'candidate-no-results',
    'candidate-unavailable',
    'candidate-invalid',
    'candidate-lifecycle-modal',
    'candidate-lifecycle-form',
    'candidate-approve-checkbox',
    'candidate-modal-reason',
    'candidate-modal-comment',
  ]) {
    assert.match(body, new RegExp(`id="${id}"`));
  }
  assert.match(
    body,
    /История решений пока пуста\. Кандидаты появятся после накопления\s+подтверждённых решений\./
  );
  assert.match(body, /Устойчивые паттерны пока не найдены\./);
  assert.match(
    body,
    /Кандидаты временно недоступны\. Работа закупщика не затронута\./
  );
  assert.doesNotMatch(section, /<button[^>]*>\s*Применить\s*<\/button>/i);
  assert.match(
    body,
    /Я понимаю, что на этом этапе правило ещё не создаётся и не\s+применяется\./
  );
});

test('candidate labels use the required cautious Russian wording', () => {
  assert.equal(eligibilityLabel('ELIGIBLE'), 'Можно рассмотреть');
  assert.equal(
    eligibilityLabel('REVIEW_ONLY'),
    'Только ручной анализ'
  );
  assert.equal(
    eligibilityLabel('INELIGIBLE'),
    'Недостаточно безопасно'
  );
  assert.equal(confidenceLabel('LOW'), 'Низкая');
  assert.equal(confidenceLabel('MEDIUM'), 'Средняя');
  assert.equal(confidenceLabel('HIGH'), 'Высокая');
  assert.equal(confidenceLabel('VERY_HIGH'), 'Очень высокая');
  assert.equal(priorityLabel('LOW'), 'Низкий');
  assert.equal(priorityLabel('MEDIUM'), 'Средний');
  assert.equal(priorityLabel('HIGH'), 'Высокий');
  assert.equal(
    priorityLabel('CRITICAL'),
    'Критический для проверки'
  );
  assert.equal(formatSignedQuantity(12), '+12');
  assert.equal(formatSignedQuantity(-12), '−12');
  assert.equal(formatSignedQuantity(null), '—');
});

test('candidate filters send history filters only to backend', () => {
  const url = new URL(buildCandidatesUrl({
    supplier: 'Валта & Ко',
    brand: 'AWARD',
    ownerDecision: 'SKIP',
    reasonCode: 'LOW_SALES',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-25',
    eligibility: 'ELIGIBLE',
    confidence: 'VERY_HIGH',
    priority: 'CRITICAL',
  }), 'http://local');

  assert.equal(
    url.pathname,
    '/api/v1/owner-learning/candidates'
  );
  assert.equal(url.searchParams.get('supplier'), 'Валта & Ко');
  assert.equal(url.searchParams.get('brand'), 'AWARD');
  assert.equal(url.searchParams.get('ownerDecision'), 'SKIP');
  assert.equal(url.searchParams.get('reasonCode'), 'LOW_SALES');
  assert.equal(url.searchParams.get('dateFrom'), '2026-07-01');
  assert.equal(url.searchParams.get('dateTo'), '2026-07-25');
  assert.equal(url.searchParams.get('eligibility'), null);
  assert.equal(url.searchParams.get('confidence'), null);
  assert.equal(url.searchParams.get('priority'), null);
  assert.equal(url.searchParams.get('includeIneligible'), 'true');
  assert.equal(url.searchParams.get('limit'), '100');
});

test('candidate state distinguishes loading, empty, patterns and unavailable', () => {
  assert.equal(candidateViewState({
    status: 'AVAILABLE',
    summary: {
      historyEntries: 0,
      patternsFound: 0,
      totalCandidates: 0,
    },
    candidates: [],
  }), 'empty');
  assert.equal(candidateViewState({
    status: 'AVAILABLE',
    summary: {
      historyEntries: 3,
      patternsFound: 0,
      totalCandidates: 0,
    },
    candidates: [],
  }), 'no-patterns');
  assert.equal(
    candidateViewState({ status: 'UNAVAILABLE' }),
    'unavailable'
  );
  assert.equal(candidateViewState({ status: 'AVAILABLE' }), 'invalid');

  const elements = candidateElements();
  setCandidatePanelState(elements, 'loading');
  assert.equal(elements.candidateLoading.hidden, false);
  setCandidatePanelState(elements, 'no-results');
  assert.equal(elements.candidateNoResults.hidden, false);
  setCandidatePanelState(elements, 'unavailable');
  assert.equal(elements.candidateUnavailable.hidden, false);
});

test('candidate summary and frontend-only filters are deterministic', () => {
  const elements = candidateElements();
  renderCandidateSummary(elements, {
    totalCandidates: 7,
    eligible: 2,
    reviewOnly: 3,
    ineligible: 2,
    highPriority: 3,
    criticalPriority: 1,
  });
  assert.equal(elements.candidateSummary.total.textContent, '7');
  assert.equal(elements.candidateSummary.eligible.textContent, '2');
  assert.equal(elements.candidateSummary.reviewOnly.textContent, '3');
  assert.equal(elements.candidateSummary.ineligible.textContent, '2');

  const eligible = candidateFixture();
  const reviewOnly = candidateFixture({
    eligibility: { status: 'REVIEW_ONLY', reasons: [] },
    confidence: { score: 60, level: 'HIGH' },
    ranking: { priorityScore: 60, priorityLevel: 'HIGH', rank: 2 },
  });
  assert.deepEqual(
    filterCandidates([eligible, reviewOnly], {
      eligibility: 'REVIEW_ONLY',
      confidence: 'HIGH',
      priority: 'HIGH',
    }),
    [reviewOnly]
  );
});

test('reset clears every candidate filter', () => {
  const elements = candidateElements();
  resetCandidateFilters(elements);
  for (const key of [
    'candidateSupplier',
    'candidateBrand',
    'candidateDecision',
    'candidateReason',
    'candidateDateFrom',
    'candidateDateTo',
    'candidateEligibility',
    'candidateConfidence',
    'candidatePriority',
  ]) {
    assert.equal(elements[key].value, '');
  }
});

test('candidate card renders facts and explanations using text nodes only', () => {
  const candidate = candidateFixture();
  const card = createCandidateCard(fakeDocument(), candidate);
  const visible = descendantText(card);

  assert.match(visible, /#1/);
  assert.match(visible, /<img src=x onerror=alert\(1\)>/);
  assert.match(visible, /Повторяется одно решение по товару/);
  assert.match(visible, /Confidence: 86 · Очень высокая/);
  assert.match(visible, /Критический для проверки/);
  assert.match(visible, /Можно рассмотреть/);
  assert.match(visible, /Пропустить/);
  assert.match(visible, /87,5|87\.5/);
  assert.match(visible, /−12/);
  assert.match(visible, /Повторяющееся решение по товару/);
  assert.match(visible, /Высокая повторяемость/);
  assert.match(visible, /Есть противоречия/);
  assert.match(
    visible,
    /Рассмотреть и при необходимости одобрить позже/
  );
  for (const forbidden of [
    'private-candidate-id',
    'technical-scope-key',
    'private-decision-id',
    'private comment',
    'metadata',
  ]) {
    assert.equal(visible.includes(forbidden), false);
  }
});

test('candidate renderer handles nulls without exposing identifiers', () => {
  const parent = fakeElement();
  renderCandidateCards(fakeDocument(), parent, [
    candidateFixture({
      candidateId: 'hidden-id',
      displayScope: { primary: null, secondary: null },
      confidence: { score: null, level: null },
      evidence: {
        occurrences: 1,
        dominantShare: null,
        firstRecordedAt: null,
        lastRecordedAt: null,
      },
      impact: {
        estimatedAffectedItems: 0,
        estimatedHistoricalQuantityDelta: null,
      },
    }),
  ]);
  const visible = descendantText(parent);

  assert.match(visible, /—/);
  assert.equal(visible.includes('hidden-id'), false);
});

test('lifecycle statuses and allowed buttons match every state', () => {
  const labels = {
    NEW: ['Начать проверку', 'Одобрить для создания правила', 'Отклонить', 'Отложить'],
    UNDER_REVIEW: ['Одобрить для создания правила', 'Отклонить', 'Отложить'],
    POSTPONED: ['Вернуть на проверку', 'Одобрить для создания правила', 'Отклонить'],
    APPROVED: ['Вернуть на проверку'],
    REJECTED: ['Вернуть на проверку'],
  };
  for (const [status, expected] of Object.entries(labels)) {
    assert.deepEqual(
      candidateLifecycleActions(status).map(value => value.label),
      expected
    );
    if (status !== 'NEW') {
      assert.notEqual(lifecycleStatusLabel(status), 'Новый');
    }
  }
  assert.equal(lifecycleStatusLabel('NEW'), 'Новый');
});

test('candidate cards show lifecycle status, actions and approval warning', () => {
  for (const status of [
    'NEW',
    'UNDER_REVIEW',
    'POSTPONED',
    'APPROVED',
    'REJECTED',
  ]) {
    const card = createCandidateCard(
      fakeDocument(),
      candidateFixture({ lifecycle: { status } })
    );
    const visible = descendantText(card);
    assert.match(visible, new RegExp(lifecycleStatusLabel(status)));
    for (const action of candidateLifecycleActions(status)) {
      assert.match(visible, new RegExp(action.label));
    }
    if (candidateLifecycleActions(status).some(
      value => value.action === 'APPROVE'
    )) {
      assert.match(
        visible,
        /Одобрение кандидата пока не создаёт и не применяет правило\./
      );
    }
    assert.doesNotMatch(visible, /Применить/);
  }
});

test('lifecycle modal requires approval checkbox and rejection reason', () => {
  const approve = candidateLifecycleActions('NEW').find(
    value => value.action === 'APPROVE'
  );
  assert.throws(
    () => buildLifecyclePayload(approve, {
      reasonCode: 'READY_FOR_RULE',
      approvedConfirmed: false,
    }),
    error =>
      error.code ===
        'OWNER_LEARNING_LIFECYCLE_CONFIRMATION_REQUIRED'
  );
  for (const actionName of ['REJECT', 'POSTPONE']) {
    const action = candidateLifecycleActions('NEW').find(
      value => value.action === actionName
    );
    assert.throws(
      () => buildLifecyclePayload(action, {
        reasonCode: 'NOT_SPECIFIED',
      }),
      error =>
        error.code === 'OWNER_LEARNING_LIFECYCLE_REASON_REQUIRED'
    );
  }
});

test('lifecycle request contains only the allowed payload', () => {
  const approve = candidateLifecycleActions('NEW').find(
    value => value.action === 'APPROVE'
  );
  const payload = buildLifecyclePayload(approve, {
    reasonCode: 'READY_FOR_RULE',
    ownerComment: '<img src=x onerror=alert(1)>',
    approvedConfirmed: true,
    candidateSnapshot: { confidenceScore: 100 },
  });
  assert.deepEqual(payload, {
    targetStatus: 'APPROVED',
    action: 'APPROVE',
    reasonCode: 'READY_FOR_RULE',
    ownerComment: '<img src=x onerror=alert(1)>',
  });
  assert.equal(Object.hasOwn(payload, 'candidateSnapshot'), false);
  assert.equal(
    buildLifecycleStatusUrl('a'.repeat(64)),
    `/api/v1/owner-learning/candidate-lifecycle/${'a'.repeat(64)}/status`
  );
  assert.throws(() => buildLifecycleStatusUrl('../private'));
});

test('lifecycle frontend exposes safe retry messages for API failures', () => {
  assert.match(
    lifecycleErrorMessage(
      'OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID'
    ),
    /обновите список/i
  );
  assert.match(
    lifecycleErrorMessage('CANDIDATE_NOT_AVAILABLE'),
    /больше не доступен/i
  );
  assert.match(
    lifecycleErrorMessage('OWNER_LEARNING_LIFECYCLE_UNAVAILABLE'),
    /временно недоступны/i
  );
  assert.match(lifecycleErrorMessage('NETWORK_ERROR'), /Нет связи/);
});

test('materialization modal contains confirmation and safety wording', async () => {
  const response = await fetch(`${baseUrl}/`);
  const body = await response.text();
  for (const id of [
    'rule-materialization-modal',
    'rule-materialization-form',
    'rule-materialization-checkbox',
    'rule-materialization-submit',
    'rule-materialization-error',
  ]) {
    assert.match(body, new RegExp(`id="${id}"`));
  }
  assert.match(
    body,
    /Будет создано неактивное правило\. Оно не изменит текущий или\s+будущий заказ/
  );
  assert.match(
    body,
    /Я понимаю, что правило создаётся неактивным и пока не\s+применяется\./
  );
});

test('materialize button is limited to approved eligible item candidate', () => {
  const eligible = candidateFixture({
    candidateId: 'a'.repeat(64),
    proposedRuleType: 'ITEM_DECISION_OVERRIDE',
    lifecycle: { status: 'APPROVED' },
    materialization: { status: 'NOT_MATERIALIZED' },
  });
  assert.equal(shouldShowMaterialize(eligible), true);
  for (const status of [
    'NEW',
    'UNDER_REVIEW',
    'REJECTED',
    'POSTPONED',
  ]) {
    assert.equal(shouldShowMaterialize({
      ...eligible,
      lifecycle: { status },
    }), false);
  }
  assert.equal(shouldShowMaterialize({
    ...eligible,
    eligibility: { status: 'REVIEW_ONLY' },
  }), false);
  assert.equal(shouldShowMaterialize({
    ...eligible,
    materialization: { status: 'MATERIALIZED' },
  }), false);
});

test('materialization sends confirmation only and requires checkbox', () => {
  assert.throws(
    () => buildMaterializationPayload(false),
    error =>
      error.code ===
        'OWNER_RULE_MATERIALIZATION_CONFIRMATION_REQUIRED'
  );
  assert.deepEqual(buildMaterializationPayload(true), {
    confirmation: true,
  });
  assert.equal(
    buildMaterializationUrl('a'.repeat(64)),
    `/api/v1/owner-learning/candidates/${
      'a'.repeat(64)
    }/materialize-rule`
  );
  assert.throws(() => buildMaterializationUrl('../private'));
});

test('candidate card shows materialization create and success states safely', () => {
  const base = candidateFixture({
    candidateId: 'a'.repeat(64),
    proposedRuleType: 'ITEM_DECISION_OVERRIDE',
    lifecycle: { status: 'APPROVED' },
    materialization: { status: 'NOT_MATERIALIZED' },
  });
  const available = descendantText(
    createCandidateCard(fakeDocument(), base)
  );
  assert.match(available, /Создать неактивное правило/);
  const created = descendantText(createCandidateCard(
    fakeDocument(),
    {
      ...base,
      displayScope: {
        primary: '<img src=x onerror=alert(1)>',
        secondary: null,
      },
      materialization: {
        status: 'MATERIALIZED',
        ruleStatus: 'DISABLED',
        materializedAt: '2026-07-25T04:00:00.000Z',
      },
    }
  ));
  assert.match(created, /Неактивное правило создано/);
  assert.match(created, /Правило пока не влияет на закупку\./);
  assert.match(created, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(
    created,
    /Активировать|Включить|Применить|Изменить заказ|Удалить правило/
  );
});

test('materialization unavailable and API failures have retry-safe text', () => {
  const visible = descendantText(createCandidateCard(
    fakeDocument(),
    candidateFixture({
      materialization: { status: 'UNAVAILABLE' },
    })
  ));
  assert.match(visible, /временно недоступно/i);
  assert.match(
    lifecycleErrorMessage('RULE_REGISTRY_UNAVAILABLE'),
    /временно недоступен/i
  );
  assert.match(
    lifecycleErrorMessage(
      'RULE_MATERIALIZATION_STORAGE_UNAVAILABLE'
    ),
    /временно недоступно/i
  );
});

test('materialized rules section is read-only and contains safety text',
  async () => {
    const response = await fetch(`${baseUrl}/`);
    const body = await response.text();
    assert.match(body, /id="materialized-rules"/);
    assert.match(body, /Материализованные правила/);
    assert.match(
      body,
      /Этот раздел показывает созданные правила\. Управление активацией\s+будет добавлено отдельно\. Неактивные правила не влияют на закупку\./
    );
    const section = body.match(
      /<section\s+class="materialized-rules card"[\s\S]*?<\/section>/
    )?.[0] || '';
    for (const label of [
      'Всего правил',
      'Активных',
      'Неактивных',
      'BUY',
      'SKIP',
      'DEFER',
    ]) {
      assert.match(section, new RegExp(label));
    }
    assert.doesNotMatch(
      section,
      />\s*(Активировать|Выключить|Удалить|Изменить|Применить)\s*</
    );
  }
);

test('materialized rules URL sends filters, search, sorting and limit', () => {
  const url = new URL(buildMaterializedRulesUrl({
    status: 'DISABLED',
    decision: 'SKIP',
    confidenceLevel: 'VERY_HIGH',
    priorityLevel: 'HIGH',
    lifecycleStatus: 'APPROVED',
    candidateAvailability: 'UNAVAILABLE',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-25',
    search: 'AWARD & 7177004',
  }), 'http://local');
  assert.equal(
    url.pathname,
    '/api/v1/owner-learning/materialized-rules'
  );
  assert.equal(url.searchParams.get('status'), 'DISABLED');
  assert.equal(url.searchParams.get('decision'), 'SKIP');
  assert.equal(url.searchParams.get('confidenceLevel'), 'VERY_HIGH');
  assert.equal(url.searchParams.get('priorityLevel'), 'HIGH');
  assert.equal(url.searchParams.get('lifecycleStatus'), 'APPROVED');
  assert.equal(
    url.searchParams.get('candidateAvailability'),
    'UNAVAILABLE'
  );
  assert.equal(url.searchParams.get('search'), 'AWARD & 7177004');
  assert.equal(url.searchParams.get('sortBy'), 'materializedAt');
  assert.equal(url.searchParams.get('sortDirection'), 'desc');
  assert.equal(url.searchParams.get('limit'), '100');
});

test('materialized rules states cover loading, empty, no results and unavailable',
  () => {
    const empty = {
      status: 'AVAILABLE',
      summary: { totalRules: 0 },
      rules: [],
    };
    assert.equal(materializedRulesViewState(empty), 'empty');
    assert.equal(
      materializedRulesViewState(empty, { search: 'missing' }),
      'no-results'
    );
    assert.equal(
      materializedRulesViewState({ status: 'UNAVAILABLE' }),
      'unavailable'
    );
    assert.equal(
      materializedRulesViewState({ status: 'AVAILABLE' }),
      'invalid'
    );
    const elements = materializedRulesElements();
    setMaterializedRulesPanelState(elements, 'loading');
    assert.equal(elements.materializedRulesLoading.hidden, false);
    setMaterializedRulesPanelState(elements, 'empty');
    assert.equal(elements.materializedRulesEmpty.hidden, false);
    setMaterializedRulesPanelState(elements, 'no-results');
    assert.equal(elements.materializedRulesNoResults.hidden, false);
    setMaterializedRulesPanelState(elements, 'unavailable');
    assert.equal(elements.materializedRulesUnavailable.hidden, false);
    setMaterializedRulesPanelState(elements, 'network');
    assert.equal(elements.materializedRulesNetwork.hidden, false);
  }
);

test('materialized rules summary renders all six counts', () => {
  const elements = materializedRulesElements();
  renderMaterializedRulesSummary(elements, {
    totalRules: 4,
    activeRules: 1,
    disabledRules: 3,
    buyRules: 2,
    skipRules: 1,
    deferRules: 1,
  });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(elements.materializedRulesSummary).map(
        ([name, element]) => [name, element.textContent]
      )
    ),
    {
      total: '4',
      active: '1',
      disabled: '3',
      buy: '2',
      skip: '1',
      defer: '1',
    }
  );
});

test('materialized rule labels distinguish statuses and safety', () => {
  assert.equal(materializedRuleStatusLabel('ACTIVE'), 'Активно');
  assert.equal(materializedRuleStatusLabel('DISABLED'), 'Неактивно');
  assert.equal(
    materializedRuleSafetyLabel({
      safety: { affectsPurchasing: true },
    }),
    'Может влиять на закупку'
  );
  assert.equal(
    materializedRuleSafetyLabel(materializedRuleFixture()),
    'Не влияет на закупку'
  );
  assert.equal(decisionLabel('BUY'), 'Купить');
  assert.equal(decisionLabel('SKIP'), 'Пропустить');
  assert.equal(decisionLabel('DEFER'), 'Отложить');
});

test('materialized rule card uses text nodes and hides ruleId', () => {
  const card = createMaterializedRuleCard(
    fakeDocument(),
    materializedRuleFixture()
  );
  const visible = descendantText(card);
  assert.match(visible, /<img src=x onerror=alert\(1\)>/);
  assert.match(visible, /7177004/);
  assert.match(visible, /Пропустить/);
  assert.match(visible, /Неактивно/);
  assert.match(visible, /Не влияет на закупку/);
  assert.match(visible, /Кандидат Owner Learning/);
  assert.match(visible, /Подробнее/);
  assert.match(
    visible,
    /Текущий кандидат больше не формируется, но созданное правило сохранено\./
  );
  for (const forbidden of [
    'approved-rule-private-id',
    'private-candidate-id',
    'scopeKey',
    'stableItemKey',
  ]) {
    assert.equal(visible.includes(forbidden), false, forbidden);
  }
});

test('materialized rule card handles ACTIVE and nulls safely', () => {
  const parent = fakeElement();
  renderMaterializedRuleCards(fakeDocument(), parent, [
    materializedRuleFixture({
      status: 'ACTIVE',
      displayScope: { primary: null, secondary: null },
      provenance: {
        confidenceScore: null,
        confidenceLevel: null,
        priorityScore: null,
        priorityLevel: null,
        materializedAt: null,
      },
      lifecycle: {
        status: null,
        lastAction: null,
        lastRecordedAt: null,
        reasonCode: null,
      },
      candidateAvailability: { status: 'AVAILABLE' },
      safety: {
        affectsPurchasing: true,
        message: 'Правило активно и может влиять на закупку.',
      },
    }),
  ]);
  const visible = descendantText(parent);
  assert.match(visible, /Активно/);
  assert.match(visible, /Может влиять на закупку/);
  assert.match(visible, /—/);
});

test('materialized rule detail shows allowlisted business fields only', () => {
  const elements = materializedRulesElements();
  renderMaterializedRuleDetail(
    elements,
    materializedRuleFixture()
  );
  assert.equal(
    elements.materializedRuleDetail.name.textContent,
    '<img src=x onerror=alert(1)>'
  );
  assert.equal(
    elements.materializedRuleDetail.sku.textContent,
    '7177004'
  );
  assert.equal(
    elements.materializedRuleDetail.decision.textContent,
    'Пропустить'
  );
  assert.equal(
    elements.materializedRuleDetail.safety.textContent,
    'Правило неактивно и не влияет на закупку.'
  );
  const visible = Object.values(elements.materializedRuleDetail)
    .map(element => element.textContent)
    .join(' ');
  assert.equal(visible.includes('approved-rule-private-id'), false);
  assert.equal(visible.includes('private-candidate-id'), false);
});

test('reset clears every materialized rules filter', () => {
  const elements = materializedRulesElements();
  resetMaterializedRulesFilters(elements);
  for (const name of [
    'materializedRulesStatus',
    'materializedRulesDecision',
    'materializedRulesConfidence',
    'materializedRulesPriority',
    'materializedRulesLifecycle',
    'materializedRulesAvailability',
    'materializedRulesDateFrom',
    'materializedRulesDateTo',
    'materializedRulesSearch',
  ]) {
    assert.equal(elements[name].value, '');
  }
});

test('materialized rules UI has no write endpoint or action labels', () => {
  const script = fs.readFileSync(
    path.join(PUBLIC_ROOT, 'app.js'),
    'utf8'
  );
  const html = fs.readFileSync(
    path.join(PUBLIC_ROOT, 'index.html'),
    'utf8'
  );
  assert.doesNotMatch(
    script,
    /materialized-rules[^'"]*\/(?:activate|disable|delete|edit|apply)/i
  );
  const section = html.match(
    /<section\s+class="materialized-rules card"[\s\S]*?<\/section>/
  )?.[0] || '';
  assert.doesNotMatch(
    section,
    />\s*(Активировать|Выключить|Удалить|Изменить|Применить)\s*</
  );
});
