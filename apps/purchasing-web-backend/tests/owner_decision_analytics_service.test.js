const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, test } = require('node:test');

const {
  OwnerDecisionAnalyticsService,
} = require('../application/owner_decision_analytics_service');
const {
  HISTORY_SCHEMA_VERSION,
  createDecisionHistoryEntry,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);

let temporaryRoot;
let historyFilePath;

function entry(sequence, overrides = {}) {
  return createDecisionHistoryEntry({
    recordedAt: `2026-07-${String(sequence).padStart(2, '0')}T10:00:00.000Z`,
    source: 'OWNER_REVIEW',
    runId: `run-${sequence}`,
    stableItemKey: 'sku:SKU-1',
    sku: 'SKU-1',
    productName: 'Товар',
    brand: 'Alpha',
    category: 'Корм',
    supplier: 'Валта',
    agentRecommendation: 'BUY',
    agentQuantity: 5,
    ownerDecision: 'BUY',
    ownerQuantity: 5,
    reasonCode: 'OTHER',
    ownerComment: 'Не раскрывать',
    ruleId: null,
    applicationMode: 'PREVIEW',
    financialContext: {},
    inventoryContext: {},
    salesContext: {},
    metadata: { privateNote: 'Не раскрывать' },
    ...overrides,
  });
}

function writeHistory(entries = []) {
  fs.writeFileSync(historyFilePath, JSON.stringify({
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: entries.at(-1)?.recordedAt || null,
    entries,
  }, null, 2));
}

function service(options = {}) {
  return new OwnerDecisionAnalyticsService({
    historyFilePath,
    now: () => '2026-07-25T00:00:00.000Z',
    logger: { warn() {} },
    ...options,
  });
}

beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'owner-analytics-service-')
  );
  historyFilePath = path.join(temporaryRoot, 'history.json');
});

afterEach(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('returns AVAILABLE analytics for an absent or empty history', () => {
  const absent = service().getAnalytics();
  assert.equal(absent.status, 'AVAILABLE');
  assert.equal(absent.analytics.population.totalEntries, 0);

  writeHistory([]);
  const empty = service().getAnalytics();
  assert.equal(empty.status, 'AVAILABLE');
  assert.equal(empty.analytics.population.filteredEntries, 0);
});

test('returns AVAILABLE analytics without exposing history entries', () => {
  writeHistory([entry(1), entry(2, {
    ownerDecision: 'SKIP',
    ownerQuantity: 0,
    reasonCode: 'LOW_SALES',
  })]);

  const result = service().getAnalytics({
    filters: { ownerDecision: 'SKIP' },
    options: { minOccurrences: 2, maxItems: 10 },
  });

  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.analytics.population.totalEntries, 2);
  assert.equal(result.analytics.population.filteredEntries, 1);
  assert.equal('entries' in result.analytics, false);
});

test('corrupted journal is fail-safe and logs one short warning', () => {
  fs.writeFileSync(historyFilePath, '{broken');
  const warnings = [];

  const result = service({
    logger: { warn: message => warnings.push(message) },
  }).getAnalytics();

  assert.deepEqual(result, {
    status: 'UNAVAILABLE',
    analytics: null,
    warning: 'OWNER_DECISION_ANALYTICS_UNAVAILABLE',
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].includes(historyFilePath), false);
});

test('unknown history schema is fail-safe', () => {
  fs.writeFileSync(historyFilePath, JSON.stringify({
    schemaVersion: 'future-schema',
    updatedAt: null,
    entries: [],
  }));

  assert.equal(service().getAnalytics().status, 'UNAVAILABLE');
});

test('analytics reads but never changes the journal', () => {
  writeHistory([entry(1)]);
  const before = crypto
    .createHash('sha256')
    .update(fs.readFileSync(historyFilePath))
    .digest('hex');

  service().getAnalytics();

  const after = crypto
    .createHash('sha256')
    .update(fs.readFileSync(historyFilePath))
    .digest('hex');
  assert.equal(after, before);
});

test('detail methods reuse the existing analytics module read-only', () => {
  writeHistory([entry(1)]);
  const analyticsService = service();

  assert.equal(
    analyticsService.getItemAnalytics({
      stableItemKey: 'sku:SKU-1',
    }).analytics.sku,
    'SKU-1'
  );
  assert.equal(
    analyticsService.getBrandAnalytics({ brand: 'Alpha' })
      .analytics.brand,
    'Alpha'
  );
  assert.equal(
    analyticsService.getSupplierAnalytics({ supplier: 'Валта' })
      .analytics.supplier,
    'Валта'
  );
  assert.equal(analyticsService.getReasonAnalytics().analytics.length, 1);
});
