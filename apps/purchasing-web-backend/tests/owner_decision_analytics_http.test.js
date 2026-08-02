const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { after, before, test } = require('node:test');

const {
  createPurchasingWebServer,
} = require('../server');
const {
  RunQueryService,
} = require('../application/run_query_service');
const {
  FileRunRegistry,
} = require('../storage/file_run_registry');
const {
  HISTORY_SCHEMA_VERSION,
  createDecisionHistoryEntry,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);

let temporaryRoot;
let historyFilePath;
let server;
let baseUrl;
const PROCESSING_RUN_ID = '77777777-7777-4777-8777-777777777777';

function entry(sequence, overrides = {}) {
  const sku = overrides.sku || `SKU-${(sequence % 3) + 1}`;
  return createDecisionHistoryEntry({
    recordedAt: `2026-07-${String(sequence).padStart(2, '0')}T10:00:00.000Z`,
    source: 'OWNER_REVIEW',
    runId: `run-${sequence}`,
    stableItemKey: `sku:${sku}`,
    sku,
    productName: `Товар ${sku}`,
    brand: sequence % 2 === 0 ? 'Alpha' : 'Beta',
    category: 'Корм',
    supplier: sequence % 2 === 0 ? 'Валта' : 'Зоостандарт',
    agentRecommendation: 'BUY',
    agentQuantity: 5,
    ownerDecision: sequence % 2 === 0 ? 'BUY' : 'SKIP',
    ownerQuantity: sequence % 2 === 0 ? 5 : 0,
    decidedBy: 'owner-web-ui',
    reasonCode: sequence % 2 === 0 ? 'OTHER' : 'LOW_SALES',
    ownerComment: '<script>private</script>',
    ruleId: null,
    applicationMode: 'PREVIEW',
    financialContext: {},
    inventoryContext: {},
    salesContext: {},
    metadata: { privateNote: 'private metadata' },
    ...overrides,
  });
}

async function json(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return { response, body: await response.json() };
}

before(async () => {
  temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'owner-analytics-http-')
  );
  historyFilePath = path.join(temporaryRoot, 'history.json');
  const entries = Array.from({ length: 12 }, (_, index) =>
    entry(index + 1)
  );
  fs.writeFileSync(historyFilePath, JSON.stringify({
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: entries.at(-1).recordedAt,
    entries,
  }, null, 2));
  const registry = new FileRunRegistry({
    runsRoot: path.join(temporaryRoot, 'runs'),
  });
  registry.createProcessingRun({
    runId: PROCESSING_RUN_ID,
    createdAt: '2026-07-25T00:00:00.000Z',
    source: { original_name: 'fixture.xlsx' },
  });
  server = createPurchasingWebServer({
    registry,
    queryService: new RunQueryService(registry),
    ownerDecisionHistoryFilePath: historyFilePath,
    now: () => '2026-07-25T00:00:00.000Z',
    logger: { warn() {} },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    server.close();
    await once(server, 'close');
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('analytics endpoint returns compact AVAILABLE data', async () => {
  const result = await json(
    '/api/v1/owner-learning/decision-history/analytics'
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.api_version, 'v1');
  assert.equal(result.body.data.status, 'AVAILABLE');
  assert.equal(result.body.data.data.population.totalEntries, 12);
  assert.equal(result.body.data.data.decisionHistory.length, 12);
  assert.equal(
    result.body.data.data.decisionHistory[0].decidedBy,
    'owner-web-ui'
  );
  assert.equal(
    result.body.data.data.decisionHistory[0].ownerComment,
    '<script>private</script>'
  );
  assert.equal(
    result.body.data.data.itemAnalytics[0].latestOwnerDecision,
    'BUY'
  );
  assert.equal(
    result.body.data.data.itemAnalytics[0].latestReasonCode,
    'OTHER'
  );
  assert.equal(
    result.body.data.data.itemAnalytics[0].latestOwnerComment,
    '<script>private</script>'
  );
  const serialized = JSON.stringify(result.body);
  for (const forbidden of [
    'metadata',
    'decisionId',
    'evidenceDecisionIds',
    '/Users/',
    'stack',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('endpoint passes filters and options to existing analytics', async () => {
  const result = await json(
    '/api/v1/owner-learning/decision-history/analytics' +
    '?supplier=%D0%92%D0%B0%D0%BB%D1%82%D0%B0' +
    '&ownerDecision=BUY&minOccurrences=2' +
    '&dominantShareThreshold=0.5&maxItems=1'
  );
  const data = result.body.data.data;

  assert.equal(result.response.status, 200);
  assert.equal(data.filtersApplied.supplier, 'Валта');
  assert.equal(data.filtersApplied.ownerDecision, 'BUY');
  assert.equal(data.population.filteredEntries, 6);
  assert.equal(data.itemAnalytics.length, 1);
  assert.ok(data.repeatedDecisionPatterns.length > 0);
});

for (const [name, query] of [
  ['invalid dateFrom', 'dateFrom=not-a-date'],
  ['invalid threshold', 'dominantShareThreshold=1.1'],
  ['negative maxItems', 'maxItems=-1'],
  ['maxItems over limit', 'maxItems=101'],
]) {
  test(`${name} returns safe 400`, async () => {
    const result = await json(
      `/api/v1/owner-learning/decision-history/analytics?${query}`
    );
    assert.equal(result.response.status, 400);
    assert.equal(
      result.body.error.code,
      'OWNER_DECISION_ANALYTICS_INVALID_INPUT'
    );
    assert.equal(JSON.stringify(result.body).includes('/Users/'), false);
  });
}

test('unavailable journal returns 200 and does not break static pages', async () => {
  fs.writeFileSync(historyFilePath, '{broken');
  const analytics = await json(
    '/api/v1/owner-learning/decision-history/analytics'
  );
  const page = await fetch(`${baseUrl}/`);
  const runStatus = await json(`/api/v1/runs/${PROCESSING_RUN_ID}`);

  assert.equal(analytics.response.status, 200);
  assert.deepEqual(analytics.body.data, {
    status: 'UNAVAILABLE',
    data: null,
    warning: 'OWNER_DECISION_ANALYTICS_UNAVAILABLE',
  });
  assert.equal(page.status, 200);
  assert.equal(runStatus.response.status, 200);
  assert.equal(runStatus.body.data.status, 'processing');
});
