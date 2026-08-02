const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  HISTORY_SCHEMA_VERSION,
  OWNER_REVIEW_REASON_CODES,
  OwnerDecisionHistoryError,
  appendDecisionHistoryEntry,
  createDecisionHistoryEntry,
  emptyDecisionHistory,
  findDecisionHistoryByStableItemKey,
  loadDecisionHistory,
  summarizeDecisionHistory,
} = require('../owner_learning/owner_decision_history');

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), {
      recursive: true,
      force: true,
    });
  }
});

function temporaryHistoryPath() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'owner-decision-journal-')
  );
  temporaryDirectories.push(directory);
  return path.join(directory, 'owner-decision-history.json');
}

function entryInput(overrides = {}) {
  return {
    recordedAt: '2026-07-24T10:00:00.000Z',
    source: 'OWNER_REVIEW',
    runId: 'run-1',
    supplier: 'Валта',
    stableItemKey: 'sku:SKU-1',
    sku: 'SKU-1',
    productName: 'Тестовый товар',
    brand: 'Миска',
    category: 'Корм',
    agentRecommendation: 'recommended',
    agentQuantity: 5,
    ownerDecision: 'SKIP',
    ownerQuantity: 0,
    decidedBy: 'owner-web-ui',
    reasonCode: 'TOO_MUCH_STOCK',
    ownerComment: 'Запаса достаточно.',
    ruleId: null,
    applicationMode: 'PREVIEW',
    financialContext: {
      analyzerOrderAmount: 100,
      workingOrderAmount: 110,
      appliedWorkingOrderAmount: null,
      financialStatus: 'approved',
      currency: 'rub',
    },
    inventoryContext: {
      freeStock: 10,
      reserve: 2,
      incomingQuantity: 1,
      daysOfStock: 30,
    },
    salesContext: {
      sales7d: 1,
      sales14d: 2,
      sales30d: 4,
      averageDailySales: 0.13,
    },
    metadata: {
      channel: 'web',
      flags: ['reviewed'],
    },
    ...overrides,
  };
}

function historyWith(entries) {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: entries.at(-1)?.recordedAt || null,
    entries,
  };
}

test('creates a complete normalized decision history entry', () => {
  const entry = createDecisionHistoryEntry(entryInput());

  assert.equal(entry.schemaVersion, HISTORY_SCHEMA_VERSION);
  assert.match(entry.decisionId, /^owner-decision-[a-f0-9]{32}$/);
  assert.equal(entry.agentRecommendation, 'BUY');
  assert.equal(entry.ownerDecision, 'SKIP');
  assert.equal(entry.reasonCode, 'TOO_MUCH_STOCK');
  assert.equal(entry.decidedBy, 'owner-web-ui');
  assert.equal(entry.financialContext.currency, 'RUB');
  assert.equal(entry.financialContext.financialStatus, 'APPROVED');
  assert.deepEqual(entry.metadata, {
    channel: 'web',
    flags: ['reviewed'],
  });
});

test('normalizes every absent optional field consistently', () => {
  const entry = createDecisionHistoryEntry({
    recordedAt: '2026-07-24T10:00:00.000Z',
    source: 'MANUAL_OVERRIDE',
    stableItemKey: 'sku:SKU-1',
    ownerDecision: 'REVIEW',
  });

  for (const field of [
    'runId',
    'supplier',
    'sku',
    'productName',
    'brand',
    'category',
    'agentRecommendation',
    'agentQuantity',
    'ownerQuantity',
    'decidedBy',
    'ownerComment',
    'ruleId',
    'applicationMode',
  ]) {
    assert.equal(entry[field], null);
  }
  assert.equal(entry.reasonCode, 'NOT_SPECIFIED');
  assert.deepEqual(entry.financialContext, {
    analyzerOrderAmount: null,
    workingOrderAmount: null,
    appliedWorkingOrderAmount: null,
    financialStatus: null,
    currency: null,
  });
  assert.deepEqual(entry.inventoryContext, {
    freeStock: null,
    reserve: null,
    incomingQuantity: null,
    daysOfStock: null,
  });
  assert.deepEqual(entry.salesContext, {
    sales7d: null,
    sales14d: null,
    sales30d: null,
    averageDailySales: null,
  });
  assert.deepEqual(entry.metadata, {});
});

test('exports the fixed Arthur Learning v1 reason codes', () => {
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
});

test('decisionId is deterministic and changes for another event', () => {
  const first = createDecisionHistoryEntry(entryInput());
  const repeated = createDecisionHistoryEntry(entryInput());
  const later = createDecisionHistoryEntry(entryInput({
    recordedAt: '2026-07-24T11:00:00.000Z',
  }));
  const anotherReason = createDecisionHistoryEntry(entryInput({
    reasonCode: 'LOW_DEMAND',
    ownerComment: 'Спрос снизился.',
  }));

  assert.equal(repeated.decisionId, first.decisionId);
  assert.notEqual(later.decisionId, first.decisionId);
  assert.notEqual(anotherReason.decisionId, first.decisionId);
});

test('appends the first entry to a new journal', () => {
  const filePath = temporaryHistoryPath();
  const entry = createDecisionHistoryEntry(entryInput());
  const result = appendDecisionHistoryEntry({
    filePath,
    entry,
    randomSuffix: 'first',
  });

  assert.equal(result.added, true);
  assert.deepEqual(result.history.entries, [entry]);
  assert.deepEqual(loadDecisionHistory({ filePath }), result.history);
});

test('appends a second event without changing the first entry', () => {
  const filePath = temporaryHistoryPath();
  const first = createDecisionHistoryEntry(entryInput());
  const firstSnapshot = structuredClone(first);
  const second = createDecisionHistoryEntry(entryInput({
    recordedAt: '2026-07-25T10:00:00.000Z',
    runId: 'run-2',
    ownerDecision: 'BUY',
    ownerQuantity: 3,
    reasonCode: 'STRATEGIC_ITEM',
  }));
  appendDecisionHistoryEntry({ filePath, entry: first });
  const result = appendDecisionHistoryEntry({
    filePath,
    entry: second,
  });

  assert.equal(result.added, true);
  assert.deepEqual(result.history.entries, [firstSnapshot, second]);
  assert.deepEqual(result.history.entries[0], firstSnapshot);
});

test('does not append the same event twice', () => {
  const filePath = temporaryHistoryPath();
  const entry = createDecisionHistoryEntry(entryInput());
  appendDecisionHistoryEntry({ filePath, entry });
  const before = fs.readFileSync(filePath, 'utf8');
  const result = appendDecisionHistoryEntry({ filePath, entry });

  assert.equal(result.added, false);
  assert.equal(result.history.entries.length, 1);
  assert.equal(fs.readFileSync(filePath, 'utf8'), before);
});

test('finds all decisions by exact stableItemKey', () => {
  const matching = [
    createDecisionHistoryEntry(entryInput()),
    createDecisionHistoryEntry(entryInput({
      recordedAt: '2026-07-25T10:00:00.000Z',
      ownerDecision: 'BUY',
    })),
  ];
  const other = createDecisionHistoryEntry(entryInput({
    recordedAt: '2026-07-26T10:00:00.000Z',
    stableItemKey: 'sku:SKU-2',
    sku: 'SKU-2',
  }));

  assert.deepEqual(findDecisionHistoryByStableItemKey({
    history: historyWith([...matching, other]),
    stableItemKey: 'sku:SKU-1',
  }), matching);
});

test('summarizes decisions, reasons, sources and repeated items', () => {
  const entries = [
    createDecisionHistoryEntry(entryInput()),
    createDecisionHistoryEntry(entryInput({
      recordedAt: '2026-07-25T10:00:00.000Z',
      source: 'APPROVED_RULE',
      ownerDecision: 'BUY',
      ownerQuantity: 3,
      reasonCode: 'STRATEGIC_ITEM',
      ruleId: 'rule-1',
      applicationMode: 'APPLY_SAFE',
    })),
    createDecisionHistoryEntry(entryInput({
      recordedAt: '2026-07-23T10:00:00.000Z',
      source: 'IMPORTED_HISTORY',
      runId: null,
      stableItemKey: 'sku:SKU-2',
      sku: 'SKU-2',
      ownerDecision: 'DEFER',
      ownerQuantity: null,
      reasonCode: 'NOT_SPECIFIED',
      applicationMode: null,
    })),
  ];
  const summary = summarizeDecisionHistory(historyWith(entries));

  assert.equal(summary.totalEntries, 3);
  assert.equal(summary.uniqueItems, 2);
  assert.deepEqual(summary.decisionsByType, {
    BUY: 1,
    SKIP: 1,
    DEFER: 1,
    REVIEW: 0,
  });
  assert.equal(summary.decisionsByReason.TOO_MUCH_STOCK, 1);
  assert.equal(summary.decisionsByReason.STRATEGIC_ITEM, 1);
  assert.equal(summary.decisionsByReason.NOT_SPECIFIED, 1);
  assert.equal(summary.decisionsBySource.OWNER_REVIEW, 1);
  assert.equal(summary.decisionsBySource.APPROVED_RULE, 1);
  assert.equal(summary.decisionsBySource.IMPORTED_HISTORY, 1);
  assert.deepEqual(summary.itemsWithRepeatedDecisions, [{
    stableItemKey: 'sku:SKU-1',
    decisionsCount: 2,
  }]);
  assert.equal(summary.firstRecordedAt, '2026-07-23T10:00:00.000Z');
  assert.equal(summary.lastRecordedAt, '2026-07-25T10:00:00.000Z');
});

test('corrupted JSON is logged, rejected and never overwritten', () => {
  const filePath = temporaryHistoryPath();
  const messages = [];
  fs.writeFileSync(filePath, '{ damaged', 'utf8');
  const before = fs.readFileSync(filePath, 'utf8');

  assert.throws(
    () => appendDecisionHistoryEntry({
      filePath,
      entry: createDecisionHistoryEntry(entryInput()),
      logger: { error(message) { messages.push(message); } },
    }),
    error =>
      error instanceof OwnerDecisionHistoryError &&
      error.code === 'DECISION_HISTORY_CORRUPTED'
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), before);
  assert.match(messages[0], /DECISION_HISTORY_CORRUPTED/);
  assert.doesNotMatch(messages[0], new RegExp(filePath));
});

test('unknown schemaVersion blocks append without overwriting', () => {
  const filePath = temporaryHistoryPath();
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 'owner-decision-history-v99',
    updatedAt: null,
    entries: [],
  }), 'utf8');
  const before = fs.readFileSync(filePath, 'utf8');

  assert.throws(
    () => appendDecisionHistoryEntry({
      filePath,
      entry: createDecisionHistoryEntry(entryInput()),
      logger: { error() {} },
    }),
    error =>
      error instanceof OwnerDecisionHistoryError &&
      error.code === 'DECISION_HISTORY_SCHEMA_UNSUPPORTED'
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), before);
});

test('append uses fsync and atomic rename without stale temp files', () => {
  const filePath = temporaryHistoryPath();
  let renameCalls = 0;
  let fsyncCalls = 0;
  const fsModule = {
    ...fs,
    renameSync(...args) {
      renameCalls += 1;
      return fs.renameSync(...args);
    },
    fsyncSync(...args) {
      fsyncCalls += 1;
      return fs.fsyncSync(...args);
    },
  };

  appendDecisionHistoryEntry({
    filePath,
    entry: createDecisionHistoryEntry(entryInput()),
    fsModule,
    randomSuffix: 'atomic',
  });

  assert.equal(renameCalls, 1);
  assert.ok(fsyncCalls >= 2);
  assert.deepEqual(
    fs.readdirSync(path.dirname(filePath)),
    ['owner-decision-history.json']
  );
});

test('creation and append do not mutate caller-owned objects', () => {
  const filePath = temporaryHistoryPath();
  const input = entryInput();
  const inputSnapshot = structuredClone(input);
  const entry = createDecisionHistoryEntry(input);
  const entrySnapshot = structuredClone(entry);

  appendDecisionHistoryEntry({ filePath, entry });

  assert.deepEqual(input, inputSnapshot);
  assert.deepEqual(entry, entrySnapshot);
});

test('identical inputs and histories produce deterministic output', () => {
  const input = entryInput();
  const first = createDecisionHistoryEntry(input);
  const second = createDecisionHistoryEntry(input);
  const history = historyWith([first]);

  assert.deepEqual(second, first);
  assert.deepEqual(
    summarizeDecisionHistory(history),
    summarizeDecisionHistory(structuredClone(history))
  );
});

test('empty history is valid and has a zero summary', () => {
  const filePath = temporaryHistoryPath();
  const history = loadDecisionHistory({ filePath });
  const summary = summarizeDecisionHistory(history);

  assert.deepEqual(history, emptyDecisionHistory());
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(summary.totalEntries, 0);
  assert.equal(summary.uniqueItems, 0);
  assert.deepEqual(summary.itemsWithRepeatedDecisions, []);
  assert.equal(summary.firstRecordedAt, null);
  assert.equal(summary.lastRecordedAt, null);
});

test('negative, NaN and infinite quantities are blocked safely', () => {
  for (const overrides of [
    { agentQuantity: -1 },
    { ownerQuantity: Number.NaN },
    { financialContext: { analyzerOrderAmount: Number.POSITIVE_INFINITY } },
    { inventoryContext: { freeStock: -1 } },
    { salesContext: { averageDailySales: Number.NaN } },
  ]) {
    assert.throws(
      () => createDecisionHistoryEntry(entryInput(overrides)),
      error =>
        error instanceof OwnerDecisionHistoryError &&
        error.code === 'DECISION_HISTORY_ENTRY_INVALID'
    );
  }
});

test('metadata cannot store secrets or absolute local paths', () => {
  assert.throws(
    () => createDecisionHistoryEntry(entryInput({
      metadata: { accessToken: 'secret' },
    })),
    error =>
      error instanceof OwnerDecisionHistoryError &&
      error.code === 'DECISION_HISTORY_UNSAFE_DATA'
  );
  assert.throws(
    () => createDecisionHistoryEntry(entryInput({
      metadata: { inputPath: '/Users/private/source.xlsx' },
    })),
    error =>
      error instanceof OwnerDecisionHistoryError &&
      error.code === 'DECISION_HISTORY_UNSAFE_DATA'
  );
});
