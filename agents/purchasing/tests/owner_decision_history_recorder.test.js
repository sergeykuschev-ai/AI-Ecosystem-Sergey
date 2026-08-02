const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  loadDecisionHistory,
} = require('../owner_learning/owner_decision_history');
const {
  recordOwnerDecisionHistory,
} = require('../owner_learning/owner_decision_history_recorder');
const {
  runOrderAgent,
} = require('../order_agent');

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
    path.join(os.tmpdir(), 'owner-decision-recorder-')
  );
  temporaryDirectories.push(directory);
  return path.join(directory, 'owner-decision-history.json');
}

function recorderInput(overrides = {}) {
  return {
    historyFilePath: temporaryHistoryPath(),
    source: 'OWNER_REVIEW',
    runContext: {
      runId: 'run-1',
      recordedAt: '2026-07-24T10:00:00.000Z',
      applicationMode: 'PREVIEW',
    },
    itemContext: {
      supplier: 'Валта',
      stableItemKey: 'sku:SKU-1',
      sku: 'SKU-1',
      productName: 'Тестовый товар',
      brand: 'Миска',
      category: 'Корм',
    },
    agentDecision: {
      recommendation: 'RECOMMENDED',
      quantity: 4,
    },
    ownerDecision: {
      decision: 'SKIP',
      quantity: 0,
      decidedBy: 'owner-web-ui',
      reasonCode: 'TOO_MUCH_STOCK',
      comment: 'Запаса достаточно.',
    },
    ruleContext: {
      ruleId: null,
    },
    financialContext: {
      analyzerOrderAmount: 100,
      workingOrderAmount: 110,
      appliedWorkingOrderAmount: null,
      financialStatus: 'APPROVED',
      currency: 'RUB',
    },
    inventoryContext: {
      freeStock: 10,
      reserve: 2,
      incomingQuantity: 0,
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
    },
    ...overrides,
  };
}

test('records an OWNER_REVIEW event', () => {
  const input = recorderInput();
  const result = recordOwnerDecisionHistory(input);
  const history = loadDecisionHistory({
    filePath: input.historyFilePath,
  });

  assert.equal(result.status, 'RECORDED');
  assert.equal(result.added, true);
  assert.match(result.decisionId, /^owner-decision-[a-f0-9]{32}$/);
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].source, 'OWNER_REVIEW');
  assert.equal(history.entries[0].agentRecommendation, 'BUY');
  assert.equal(history.entries[0].ownerDecision, 'SKIP');
  assert.equal(history.entries[0].decidedBy, 'owner-web-ui');
});

test('records an APPROVED_RULE event with rule context', () => {
  const input = recorderInput({
    source: 'APPROVED_RULE',
    ruleContext: {
      ruleId: 'approved-rule-1',
    },
    metadata: {
      proposalId: 'proposal-1',
    },
  });
  const result = recordOwnerDecisionHistory(input);
  const [entry] = loadDecisionHistory({
    filePath: input.historyFilePath,
  }).entries;

  assert.equal(result.status, 'RECORDED');
  assert.equal(entry.source, 'APPROVED_RULE');
  assert.equal(entry.ruleId, 'approved-rule-1');
  assert.equal(entry.metadata.proposalId, 'proposal-1');
});

test('returns DUPLICATE for the same event', () => {
  const input = recorderInput();
  const first = recordOwnerDecisionHistory(input);
  const repeated = recordOwnerDecisionHistory(input);

  assert.equal(first.status, 'RECORDED');
  assert.equal(repeated.status, 'DUPLICATE');
  assert.equal(repeated.added, false);
  assert.equal(repeated.decisionId, first.decisionId);
  assert.equal(loadDecisionHistory({
    filePath: input.historyFilePath,
  }).entries.length, 1);
});

test('corrupted history is unavailable and is not overwritten', () => {
  const input = recorderInput();
  const warnings = [];
  input.logger = {
    warn(message) { warnings.push(message); },
  };
  fs.writeFileSync(input.historyFilePath, '{ damaged', 'utf8');
  const before = fs.readFileSync(input.historyFilePath, 'utf8');

  const result = recordOwnerDecisionHistory(input);

  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.warning.code, 'DECISION_HISTORY_CORRUPTED');
  assert.equal(fs.readFileSync(input.historyFilePath, 'utf8'), before);
  assert.equal(warnings.length, 1);
});

test('unknown schemaVersion is unavailable and is not overwritten', () => {
  const input = recorderInput();
  input.logger = { warn() {} };
  fs.writeFileSync(input.historyFilePath, JSON.stringify({
    schemaVersion: 'owner-decision-history-v999',
    updatedAt: null,
    entries: [],
  }), 'utf8');
  const before = fs.readFileSync(input.historyFilePath, 'utf8');

  const result = recordOwnerDecisionHistory(input);

  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(
    result.warning.code,
    'DECISION_HISTORY_SCHEMA_UNSUPPORTED'
  );
  assert.equal(fs.readFileSync(input.historyFilePath, 'utf8'), before);
});

test('write failure returns safe UNAVAILABLE diagnostics', () => {
  const input = recorderInput();
  const warnings = [];
  input.logger = {
    warn(message) { warnings.push(message); },
  };
  const result = recordOwnerDecisionHistory(input, {
    appendEntry() {
      const error = new Error(
        `/private/tmp/secret/${path.basename(input.historyFilePath)}`
      );
      error.code = 'DECISION_HISTORY_WRITE_FAILED';
      throw error;
    },
  });

  assert.deepEqual(result, {
    status: 'UNAVAILABLE',
    decisionId: null,
    added: false,
    warning: {
      code: 'DECISION_HISTORY_WRITE_FAILED',
      message: 'Историю решения временно не удалось сохранить.',
    },
  });
  assert.equal(warnings.length, 1);
  assert.equal(JSON.stringify(result).includes('/private/'), false);
  assert.equal(JSON.stringify(result).includes('stack'), false);
});

test('missing required context is skipped without creating storage', () => {
  const input = recorderInput({
    ownerDecision: {
      decision: null,
    },
  });

  const result = recordOwnerDecisionHistory(input);

  assert.equal(result.status, 'SKIPPED');
  assert.equal(result.added, false);
  assert.equal(fs.existsSync(input.historyFilePath), false);
});

test('recorder does not mutate nested input objects', () => {
  const input = recorderInput();
  const snapshot = structuredClone(input);

  recordOwnerDecisionHistory(input);

  assert.deepEqual(input, snapshot);
});

test('diagnostics never expose paths, payloads, or stack traces', () => {
  const input = recorderInput();
  const warnings = [];
  input.logger = {
    warn(message) { warnings.push(message); },
  };
  const result = recordOwnerDecisionHistory(input, {
    appendEntry() {
      const error = new Error('/Users/owner/private-history.json');
      error.code = '/Users/owner/private-history.json';
      error.stack = 'secret stack';
      throw error;
    },
  });
  const serialized = JSON.stringify({ result, warnings });

  assert.equal(result.warning.code, 'DECISION_HISTORY_UNAVAILABLE');
  assert.equal(serialized.includes('/Users/'), false);
  assert.equal(serialized.includes('secret stack'), false);
  assert.equal(serialized.includes('Запаса достаточно'), false);
});

test('ordinary agent run does not create decision history', () => {
  const filePath = temporaryHistoryPath();

  const result = runOrderAgent([{
    json: {
      Наименование: 'Synthetic product',
      Артикул: 'SYNTHETIC-1',
      'Основной поставщик': 'Synthetic Supplier',
      Цена: 10,
      'Заказать у поставщика': 2,
      'Свободный остаток': 0,
    },
  }]);

  assert.equal(result[0].json.preliminary_order_sum, 20);
  assert.equal(fs.existsSync(filePath), false);
});
