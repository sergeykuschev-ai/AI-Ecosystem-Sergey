const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  HISTORY_SCHEMA_VERSION,
  OwnerLearningHistoryError,
  buildHistoryRunEntry,
  buildOwnerLearningPatterns,
  buildOwnerLearningPatternsMarkdown,
  buildStableItemKey,
  emptyHistory,
  stableKeyContext,
  updateOwnerLearningHistory,
} = require('../owner_learning/owner_learning_history');

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

function temporaryHistoryPath() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'owner-learning-history-')
  );
  temporaryDirectories.push(directory);
  return path.join(directory, 'owner-learning-history.json');
}

function summary(overrides = {}) {
  return {
    totalItems: 1,
    reviewRequiredItems: 1,
    ownerDecisionsTotal: 1,
    buyCount: 0,
    skipCount: 1,
    deferCount: 0,
    unresolvedCount: 0,
    matchesAgentRecommendation: 1,
    overridesAgentRecommendation: 0,
    agreementRate: 100,
    ...overrides,
  };
}

function learningInput({
  itemId = 'row-1',
  sku = 'SKU-1',
  barcode = '460000000001',
  rowId = itemId,
  name = 'Тестовый товар',
  brand = 'Миска',
  ownerDecision = 'SKIP',
  recommendation = 'DO_NOT_BUY',
} = {}) {
  return {
    items: [{
      itemId,
      sku,
      barcode,
      rowId,
      name,
      brand,
      owner_review_required: true,
    }],
    recommendations: [{ itemId, status: recommendation }],
    ownerDecisions: [{ itemId, decision: ownerDecision }],
  };
}

function runEntry(runId, generatedAt, overrides = {}) {
  return buildHistoryRunEntry({
    runId,
    generatedAt,
    report: summary(overrides.report),
    learningInput: learningInput(overrides.input),
  });
}

function historyWith(entries) {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: entries.at(-1)?.generatedAt || null,
    runs: entries,
  };
}

test('creates a new versioned history file', () => {
  const historyPath = temporaryHistoryPath();
  const result = updateOwnerLearningHistory(
    historyPath,
    runEntry('run-1', '2026-07-23T10:00:00.000Z'),
    { randomSuffix: 'first' }
  );

  assert.equal(result.added, true);
  assert.equal(result.history.schemaVersion, HISTORY_SCHEMA_VERSION);
  assert.equal(result.history.runs.length, 1);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(historyPath, 'utf8')),
    result.history
  );
});

test('adds a second distinct run', () => {
  const historyPath = temporaryHistoryPath();
  updateOwnerLearningHistory(
    historyPath,
    runEntry('run-1', '2026-07-23T10:00:00.000Z')
  );
  const result = updateOwnerLearningHistory(
    historyPath,
    runEntry('run-2', '2026-07-24T10:00:00.000Z')
  );

  assert.equal(result.added, true);
  assert.deepEqual(
    result.history.runs.map(run => run.runId),
    ['run-1', 'run-2']
  );
});

test('does not duplicate an existing runId', () => {
  const historyPath = temporaryHistoryPath();
  const entry = runEntry('run-1', '2026-07-23T10:00:00.000Z');
  updateOwnerLearningHistory(historyPath, entry);
  const before = fs.readFileSync(historyPath, 'utf8');
  const result = updateOwnerLearningHistory(historyPath, entry);

  assert.equal(result.added, false);
  assert.equal(result.history.runs.length, 1);
  assert.equal(fs.readFileSync(historyPath, 'utf8'), before);
});

test('two matching SKIP decisions create a repeated decision', () => {
  const patterns = buildOwnerLearningPatterns(historyWith([
    runEntry('run-1', '2026-07-23T10:00:00.000Z'),
    runEntry('run-2', '2026-07-24T10:00:00.000Z'),
  ]));

  assert.equal(patterns.repeatedItemsCount, 1);
  assert.equal(patterns.ruleCandidatesCount, 0);
  assert.equal(patterns.repeatedDecisions[0].dominantOwnerDecision, 'SKIP');
  assert.equal(patterns.repeatedDecisions[0].dominantDecisionRate, 100);
});

test('one BUY and one SKIP do not create a false rule', () => {
  const patterns = buildOwnerLearningPatterns(historyWith([
    runEntry('run-1', '2026-07-23T10:00:00.000Z', {
      report: {
        buyCount: 1,
        skipCount: 0,
        matchesAgentRecommendation: 0,
        overridesAgentRecommendation: 1,
        agreementRate: 0,
      },
      input: { ownerDecision: 'BUY' },
    }),
    runEntry('run-2', '2026-07-24T10:00:00.000Z'),
  ]));

  assert.equal(patterns.repeatedItemsCount, 0);
  assert.equal(patterns.ruleCandidatesCount, 0);
});

test('three consecutive SKIP decisions create a rule candidate', () => {
  const patterns = buildOwnerLearningPatterns(historyWith([
    runEntry('run-1', '2026-07-23T10:00:00.000Z'),
    runEntry('run-2', '2026-07-24T10:00:00.000Z'),
    runEntry('run-3', '2026-07-25T10:00:00.000Z'),
  ]));

  assert.equal(patterns.ruleCandidatesCount, 1);
  assert.equal(
    patterns.ruleCandidates[0].consecutiveSameDecisionCount,
    3
  );
  assert.equal(patterns.ruleCandidates[0].dominantDecisionRate, 100);
  const markdown = buildOwnerLearningPatternsMarkdown(patterns);
  assert.match(markdown, /Решение: Не заказывать/);
  assert.match(markdown, /Обычно совпадало с агентом: да \(100\.00%\)/);
});

test('unknown agent recommendation remains non-comparable', () => {
  const entry = runEntry('run-1', '2026-07-23T10:00:00.000Z', {
    report: {
      matchesAgentRecommendation: 0,
      agreementRate: null,
    },
    input: { recommendation: 'UNKNOWN' },
  });
  const patterns = buildOwnerLearningPatterns(historyWith([entry]));

  assert.equal(entry.items[0].normalizedAgentRecommendation, null);
  assert.equal(entry.items[0].isAgreement, null);
  assert.equal(patterns.accumulatedOwnerDecisions, 1);
});

test('equal names with different SKU are never merged', () => {
  const items = [
    { sku: 'SKU-1', name: 'Одинаковое имя', brand: 'Бренд' },
    { sku: 'SKU-2', name: 'Одинаковое имя', brand: 'Бренд' },
  ];
  const context = stableKeyContext(items);

  assert.equal(buildStableItemKey(items[0], context), 'sku:SKU-1');
  assert.equal(buildStableItemKey(items[1], context), 'sku:SKU-2');
});

test('rowId is used when SKU and barcode are not uniquely usable', () => {
  const items = [
    { sku: 'DUPLICATE', rowId: 'row-1', name: 'Товар' },
    { sku: 'DUPLICATE', rowId: 'row-2', name: 'Товар' },
  ];
  const context = stableKeyContext(items);

  assert.equal(buildStableItemKey(items[0], context), 'row:row-1');
  assert.equal(buildStableItemKey(items[1], context), 'row:row-2');
});

test('unique barcode precedes rowId and normalized brand plus name is last', () => {
  const barcodeItem = {
    sku: 'DUPLICATE',
    barcode: '460000000001',
    rowId: 'row-1',
    name: 'Товар',
  };
  const context = stableKeyContext([
    barcodeItem,
    {
      sku: 'DUPLICATE',
      barcode: '460000000002',
      rowId: 'row-2',
      name: 'Товар',
    },
  ]);
  const nameItem = { brand: '  Миска ', name: ' Товар   Один ' };

  assert.equal(
    buildStableItemKey(barcodeItem, context),
    'barcode:460000000001'
  );
  assert.equal(
    buildStableItemKey(nameItem),
    'brand-name:миска|товар один'
  );
});

test('ambiguous name-only products are rejected instead of being merged', () => {
  const items = [
    { brand: 'Бренд', name: 'Одинаковый товар' },
    { brand: 'Бренд', name: 'Одинаковый товар' },
  ];
  const context = stableKeyContext(items);

  assert.throws(
    () => buildStableItemKey(items[0], context),
    error =>
      error instanceof OwnerLearningHistoryError &&
      error.code === 'AMBIGUOUS_ITEM_IDENTITY'
  );
});

test('corrupted history is reported and never overwritten', () => {
  const historyPath = temporaryHistoryPath();
  fs.writeFileSync(historyPath, '{ damaged', 'utf8');
  const before = fs.readFileSync(historyPath, 'utf8');

  assert.throws(
    () => updateOwnerLearningHistory(
      historyPath,
      runEntry('run-1', '2026-07-23T10:00:00.000Z')
    ),
    error =>
      error instanceof OwnerLearningHistoryError &&
      error.code === 'HISTORY_INVALID'
  );
  assert.equal(fs.readFileSync(historyPath, 'utf8'), before);
});

test('empty history produces no repeated decisions', () => {
  const patterns = buildOwnerLearningPatterns(emptyHistory());

  assert.equal(patterns.historyRunsCount, 0);
  assert.equal(patterns.accumulatedOwnerDecisions, 0);
  assert.deepEqual(patterns.repeatedDecisions, []);
  assert.deepEqual(patterns.ruleCandidates, []);
  assert.match(
    buildOwnerLearningPatternsMarkdown(patterns),
    /Пока недостаточно повторяющихся решений/
  );
});

test('history publication uses atomic rename and leaves no temp file', () => {
  const historyPath = temporaryHistoryPath();
  let renameCalls = 0;
  const fsModule = {
    ...fs,
    renameSync(...args) {
      renameCalls += 1;
      return fs.renameSync(...args);
    },
  };

  updateOwnerLearningHistory(
    historyPath,
    runEntry('run-1', '2026-07-23T10:00:00.000Z'),
    { fsModule, randomSuffix: 'atomic' }
  );

  assert.equal(renameCalls, 1);
  assert.deepEqual(
    fs.readdirSync(path.dirname(historyPath)),
    ['owner-learning-history.json']
  );
});
