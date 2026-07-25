const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  HISTORY_SCHEMA_VERSION,
  atomicWriteDecisionHistory,
  createDecisionHistoryEntry,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);
const {
  OwnerLearningCandidatesService,
} = require('../application/owner_learning_candidates_service');
const {
  appendCandidateLifecycleEvent,
  createCandidateLifecycleEvent,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_candidate_lifecycle'
);
const {
  MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
  appendMaterializationEvent,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_materialization_journal'
);
const {
  mapOwnerLearningCandidates,
} = require('../dto/owner_learning_candidates_mapper');

const temporaryDirectories = [];
const AS_OF = '2026-07-25T00:00:00.000Z';

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
    path.join(os.tmpdir(), 'owner-learning-candidates-')
  );
  temporaryDirectories.push(directory);
  return path.join(directory, 'history.json');
}

function historyEntry(sequence, overrides = {}) {
  const day = String(sequence).padStart(2, '0');
  return createDecisionHistoryEntry({
    recordedAt: `2026-07-${day}T00:00:00.000Z`,
    source: 'OWNER_REVIEW',
    runId: `run-${sequence}`,
    supplier: 'Валта',
    stableItemKey: 'sku:7177004',
    sku: '7177004',
    productName: 'AWARD Hairball',
    brand: 'AWARD',
    category: 'Корм',
    agentRecommendation: 'BUY',
    agentQuantity: 8,
    ownerDecision: 'SKIP',
    ownerQuantity: 0,
    reasonCode: 'LOW_SALES',
    ownerComment: 'Закрытый комментарий',
    ruleId: null,
    applicationMode: 'PREVIEW',
    financialContext: {},
    inventoryContext: {},
    salesContext: {},
    metadata: { privateNote: 'Закрытые metadata' },
    ...overrides,
  });
}

function writeHistory(filePath, entries = []) {
  atomicWriteDecisionHistory(filePath, {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: entries.at(-1)?.recordedAt || null,
    entries,
  });
}

function service(filePath, overrides = {}) {
  return new OwnerLearningCandidatesService({
    historyFilePath: filePath,
    now: () => AS_OF,
    logger: { warn() {} },
    ...overrides,
  });
}

function sha256(filePath) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

test('empty history is AVAILABLE with a complete zero summary', () => {
  const filePath = temporaryHistoryPath();
  writeHistory(filePath);

  const result = service(filePath).getCandidates();

  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.generatedAt, AS_OF);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.summary, {
    totalCandidates: 0,
    historyEntries: 0,
    patternsFound: 0,
    eligible: 0,
    reviewOnly: 0,
    ineligible: 0,
    highPriority: 0,
    criticalPriority: 0,
    confidenceLevels: {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      VERY_HIGH: 0,
    },
  });
});

test('history patterns pass through analytics, confidence, ranking and explanations', () => {
  const filePath = temporaryHistoryPath();
  writeHistory(filePath, [
    historyEntry(1),
    historyEntry(2),
    historyEntry(3),
    historyEntry(4),
  ]);

  const result = service(filePath).getCandidates();

  assert.equal(result.status, 'AVAILABLE');
  assert.ok(result.candidates.length >= 5);
  assert.equal(result.summary.totalCandidates, result.candidates.length);
  assert.ok(result.candidates.every(candidate =>
    candidate.explanation.headline &&
    candidate.explanation.recommendedOwnerAction
  ));
});

test('service invokes each domain stage once and preserves one analytics object', () => {
  const history = {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: null,
    entries: [],
  };
  const analytics = { repeatedDecisionPatterns: [] };
  const calls = [];
  const result = service('/unused/history.json', {
    loadHistory(input) {
      calls.push(['history', input]);
      return history;
    },
    analyzeHistory(input) {
      calls.push(['analytics', input]);
      assert.equal(input.history, history);
      return analytics;
    },
    evaluateConfidences(input) {
      calls.push(['confidence', input]);
      assert.equal(input.analytics, analytics);
      assert.equal(input.history, history);
      return [];
    },
    buildAndRankCandidates(input) {
      calls.push(['ranking', input]);
      assert.equal(input.analytics, analytics);
      assert.equal(input.history, history.entries);
      return [];
    },
    buildExplanations(candidates) {
      calls.push(['explanations', candidates]);
      return [];
    },
  }).getCandidates();

  assert.equal(result.status, 'AVAILABLE');
  assert.deepEqual(
    calls.map(([name]) => name),
    ['history', 'analytics', 'confidence', 'ranking', 'explanations']
  );
});

test('now dependency supplies the same analytics generatedAt and confidence asOf', () => {
  let nowCalls = 0;
  let analyticsGeneratedAt;
  let confidenceAsOf;
  const result = service('/unused/history.json', {
    now() {
      nowCalls += 1;
      return AS_OF;
    },
    loadHistory() {
      return { entries: [] };
    },
    analyzeHistory(input) {
      analyticsGeneratedAt = input.options.generatedAt;
      return { repeatedDecisionPatterns: [] };
    },
    evaluateConfidences(input) {
      confidenceAsOf = input.options.asOf;
      return [];
    },
    buildAndRankCandidates() {
      return [];
    },
    buildExplanations() {
      return [];
    },
  }).getCandidates();

  assert.equal(result.status, 'AVAILABLE');
  assert.equal(nowCalls, 1);
  assert.equal(analyticsGeneratedAt, AS_OF);
  assert.equal(confidenceAsOf, AS_OF);
});

test('explicit asOf is deterministic and forwarded to both stages', () => {
  const explicit = '2026-07-20T10:00:00.000Z';
  const forwarded = [];
  const result = service('/unused/history.json', {
    loadHistory() {
      return { entries: [] };
    },
    analyzeHistory(input) {
      forwarded.push(input.options.generatedAt);
      return { repeatedDecisionPatterns: [] };
    },
    evaluateConfidences(input) {
      forwarded.push(input.options.asOf);
      return [];
    },
    buildAndRankCandidates() {
      return [];
    },
    buildExplanations() {
      return [];
    },
  }).getCandidates({
    confidenceOptions: { asOf: explicit },
  });

  assert.equal(result.generatedAt, explicit);
  assert.deepEqual(forwarded, [explicit, explicit]);
});

test('ITEM, BRAND and SUPPLIER display scopes use safe business names', () => {
  const filePath = temporaryHistoryPath();
  writeHistory(filePath, [
    historyEntry(1),
    historyEntry(2),
    historyEntry(3),
    historyEntry(4),
  ]);

  const result = service(filePath).getCandidates();
  const item = result.candidates.find(value => value.scopeType === 'ITEM');
  const brand = result.candidates.find(value => value.scopeType === 'BRAND');
  const supplier = result.candidates.find(
    value => value.scopeType === 'SUPPLIER'
  );

  assert.deepEqual(item.displayScope, {
    primary: 'AWARD Hairball',
    secondary: 'SKU 7177004',
  });
  assert.deepEqual(brand.displayScope, {
    primary: 'AWARD',
    secondary: null,
  });
  assert.deepEqual(supplier.displayScope, {
    primary: 'Валта',
    secondary: null,
  });
});

test('corrupted and unknown-schema journals fail safe with one warning', () => {
  for (const source of [
    '{bad-json',
    JSON.stringify({
      schemaVersion: 'owner-decision-history-v999',
      updatedAt: null,
      entries: [],
    }),
  ]) {
    const filePath = temporaryHistoryPath();
    fs.writeFileSync(filePath, source);
    const warnings = [];
    const result = service(filePath, {
      logger: { warn(message) { warnings.push(message); } },
    }).getCandidates();

    assert.deepEqual(result, {
      status: 'UNAVAILABLE',
      generatedAt: null,
      summary: null,
      candidates: [],
      warning: 'OWNER_LEARNING_CANDIDATES_UNAVAILABLE',
    });
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings[0], /history\.json|at\s+\w+|ownerComment/);
  }
});

test('any downstream failure returns UNAVAILABLE without throwing', () => {
  const stages = [
    'analyzeHistory',
    'evaluateConfidences',
    'buildAndRankCandidates',
    'buildExplanations',
  ];
  for (const stage of stages) {
    const dependencies = {
      loadHistory() {
        return { entries: [] };
      },
      analyzeHistory() {
        return { repeatedDecisionPatterns: [] };
      },
      evaluateConfidences() {
        return [];
      },
      buildAndRankCandidates() {
        return [];
      },
      buildExplanations() {
        return [];
      },
    };
    dependencies[stage] = () => {
      throw new Error(`private failure in ${stage}`);
    };
    const result = service('/unused/history.json', dependencies)
      .getCandidates();
    assert.equal(result.status, 'UNAVAILABLE');
    assert.deepEqual(result.candidates, []);
  }
});

test('candidate read never changes the journal bytes', () => {
  const filePath = temporaryHistoryPath();
  writeHistory(filePath, [
    historyEntry(1),
    historyEntry(2),
    historyEntry(3),
  ]);
  const before = sha256(filePath);

  service(filePath).getCandidates();

  assert.equal(sha256(filePath), before);
});

test('DTO allowlist excludes all private and technical fields', () => {
  const filePath = temporaryHistoryPath();
  writeHistory(filePath, [
    historyEntry(1),
    historyEntry(2),
    historyEntry(3),
  ]);
  const response = mapOwnerLearningCandidates(
    service(filePath).getCandidates()
  );
  const serialized = JSON.stringify(response);

  for (const forbidden of [
    'scopeKey',
    'decisionId',
    'evidenceDecisionIds',
    'ownerComment',
    'metadata',
    'supportingDecisionIds',
    'ranking.components',
    'Закрытый комментарий',
    'Закрытые metadata',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.ok(response.candidates.every(candidate =>
    Object.keys(candidate.ranking).length === 3
  ));
});

test('candidate lifecycle defaults to NEW when there are no events', () => {
  const historyPath = temporaryHistoryPath();
  const lifecycleFilePath = `${historyPath}.lifecycle`;
  writeHistory(historyPath, [
    historyEntry(1),
    historyEntry(2),
    historyEntry(3),
    historyEntry(4),
  ]);
  const result = service(historyPath, {
    lifecycleFilePath,
  }).getCandidates();

  assert.equal(result.status, 'AVAILABLE');
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every(value =>
    value.lifecycle.status === 'NEW' &&
    value.lifecycle.lastAction === null &&
    value.lifecycle.lastRecordedAt === null &&
    value.lifecycle.reasonCode === null
  ));
});

test('candidate lifecycle overlays the latest status', () => {
  const historyPath = temporaryHistoryPath();
  const lifecycleFilePath = `${historyPath}.lifecycle`;
  writeHistory(historyPath, [
    historyEntry(1),
    historyEntry(2),
    historyEntry(3),
    historyEntry(4),
  ]);
  const initial = service(historyPath, {
    lifecycleFilePath,
  }).getCandidates();
  const candidateId = initial.candidates[0].candidateId;
  appendCandidateLifecycleEvent({
    filePath: lifecycleFilePath,
    event: createCandidateLifecycleEvent({
      recordedAt: AS_OF,
      candidateId,
      fromStatus: 'NEW',
      toStatus: 'APPROVED',
      action: 'APPROVE',
      actor: 'OWNER',
      reasonCode: 'READY_FOR_RULE',
      candidateSnapshot: {
        patternType: initial.candidates[0].patternType,
        scopeType: initial.candidates[0].scopeType,
        displayScope: initial.candidates[0].displayScope,
        proposedRuleType:
          initial.candidates[0].proposedRuleType,
        proposedDecision:
          initial.candidates[0].proposedAction.decision,
        confidenceScore:
          initial.candidates[0].confidence.score,
        confidenceLevel:
          initial.candidates[0].confidence.level,
        priorityScore:
          initial.candidates[0].ranking.priorityScore,
        priorityLevel:
          initial.candidates[0].ranking.priorityLevel,
        eligibilityStatus:
          initial.candidates[0].eligibility.status,
      },
    }),
  });

  const result = service(historyPath, {
    lifecycleFilePath,
  }).getCandidates();
  assert.deepEqual(result.candidates[0].lifecycle, {
    status: 'APPROVED',
    lastAction: 'APPROVE',
    lastRecordedAt: AS_OF,
    reasonCode: 'READY_FOR_RULE',
  });
});

test('unavailable lifecycle falls back to NEW without hiding candidates', () => {
  const historyPath = temporaryHistoryPath();
  const lifecycleFilePath = `${historyPath}.lifecycle`;
  writeHistory(historyPath, [
    historyEntry(1),
    historyEntry(2),
    historyEntry(3),
    historyEntry(4),
  ]);
  fs.writeFileSync(lifecycleFilePath, '{broken', 'utf8');

  const result = service(historyPath, {
    lifecycleFilePath,
  }).getCandidates();
  assert.equal(result.status, 'AVAILABLE');
  assert.ok(result.candidates.length > 0);
  assert.equal(
    result.lifecycleWarning,
    'OWNER_LEARNING_LIFECYCLE_UNAVAILABLE'
  );
  assert.ok(result.candidates.every(value =>
    value.lifecycle.status === 'NEW'
  ));
  assert.equal(fs.readFileSync(lifecycleFilePath, 'utf8'), '{broken');
});

test('candidate materialization defaults to NOT_MATERIALIZED', () => {
  const historyPath = temporaryHistoryPath();
  const materializationsFilePath = `${historyPath}.materializations`;
  writeHistory(historyPath, [
    historyEntry(1),
    historyEntry(2),
    historyEntry(3),
    historyEntry(4),
  ]);
  const result = service(historyPath, {
    materializationsFilePath,
  }).getCandidates();
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every(value =>
    value.materialization.status === 'NOT_MATERIALIZED' &&
    value.materialization.ruleId === null
  ));
});

test('candidate materialization overlays journal state', () => {
  const historyPath = temporaryHistoryPath();
  const materializationsFilePath = `${historyPath}.materializations`;
  writeHistory(historyPath, [
    historyEntry(1),
    historyEntry(2),
    historyEntry(3),
    historyEntry(4),
  ]);
  const initial = service(historyPath, {
    materializationsFilePath,
  }).getCandidates();
  const source = initial.candidates[0];
  appendMaterializationEvent({
    filePath: materializationsFilePath,
    event: {
      schemaVersion: MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
      materializationId: 'materialization-a',
      recordedAt: AS_OF,
      candidateId: source.candidateId,
      lifecycleEventId: 'lifecycle-a',
      ruleId: 'approved-rule-a',
      resultStatus: 'CREATED',
      ruleStatus: 'DISABLED',
      fingerprint: 'fingerprint-a',
      snapshot: {
        patternType: source.patternType,
        proposedRuleType: source.proposedRuleType,
        proposedDecision: source.proposedAction.decision,
        confidenceScore: source.confidence.score,
        confidenceLevel: source.confidence.level,
        priorityScore: source.ranking.priorityScore,
        priorityLevel: source.ranking.priorityLevel,
      },
      metadata: {},
    },
  });
  const result = service(historyPath, {
    materializationsFilePath,
  }).getCandidates();
  assert.deepEqual(result.candidates[0].materialization, {
    status: 'MATERIALIZED',
    ruleId: 'approved-rule-a',
    ruleStatus: 'DISABLED',
    materializedAt: AS_OF,
  });
});

test('unavailable materialization overlay does not hide candidates', () => {
  const historyPath = temporaryHistoryPath();
  const materializationsFilePath = `${historyPath}.materializations`;
  writeHistory(historyPath, [
    historyEntry(1),
    historyEntry(2),
    historyEntry(3),
    historyEntry(4),
  ]);
  fs.writeFileSync(materializationsFilePath, '{broken', 'utf8');
  const result = service(historyPath, {
    materializationsFilePath,
  }).getCandidates();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(
    result.materializationWarning,
    'RULE_MATERIALIZATION_STORAGE_UNAVAILABLE'
  );
  assert.ok(result.candidates.every(value =>
    value.materialization.status === 'UNAVAILABLE'
  ));
});
