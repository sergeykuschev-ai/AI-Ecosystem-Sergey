const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  loadRuleEffectivenessEvents,
} = require('../owner_learning/owner_rule_effectiveness');
const {
  recordRuleEffectivenessForRun,
} = require(
  '../owner_learning/owner_rule_effectiveness_recorder'
);

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), {
      recursive: true,
      force: true,
    });
  }
});

function filePath() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'effectiveness-recorder-')
  );
  temporaryDirectories.push(directory);
  return path.join(directory, 'events.json');
}

function rule(overrides = {}) {
  return {
    ruleId: 'rule-1',
    stableItemKey: 'sku:100',
    name: '<img src=x onerror=alert(1)>',
    brand: 'Brand',
    status: 'ACTIVE',
    ruleType: 'ITEM_DECISION_OVERRIDE',
    approvedDecision: 'SKIP',
    action: {
      decision: 'SKIP',
      quantityStrategy: 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    source: 'OWNER_LEARNING_CANDIDATE',
    scopeType: 'ITEM',
    provenance: {
      source: 'OWNER_LEARNING_CANDIDATE',
      candidateId: 'candidate-1',
    },
    ...overrides,
  };
}

function application(overrides = {}) {
  return {
    rowIdentity: 'row-1',
    agentRecommendation: 'BUY',
    agentQuantity: 10,
    finalRecommendation: 'SKIP',
    finalQuantity: 0,
    applicationStatus: 'APPLIED',
    ruleApplied: true,
    ruleId: 'rule-1',
    stableItemKey: 'sku:100',
    diagnostics: {
      matchedActiveRule: true,
      conflictRuleIds: [],
    },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    effectivenessFilePath: filePath(),
    runContext: {
      runId: 'run-1',
      recordedAt: '2026-01-01T00:00:00.000Z',
      supplier: 'Валта',
      applicationMode: 'APPLY_SAFE',
    },
    registry: {
      schemaVersion: 'owner-approved-rules-v0.4',
      updatedAt: '2026-01-01T00:00:00.000Z',
      rules: [rule()],
    },
    applicationResult: {
      mode: 'APPLY_SAFE',
      status: 'APPLIED',
      amountBefore: 1000,
      amountAfter: 0,
      financialStatusBefore: 'APPROVED',
      financialStatusAfter: 'APPROVED',
      appliedWorkingOrderFinancialAssessment: {
        financiallyPermitted: true,
      },
      applications: [application()],
    },
    financialContext: {
      workingOrderProducts: [{
        rowIdentity: 'row-1',
        priceNum: 100,
      }],
    },
    logger: { warn() {} },
    ...overrides,
  };
}

test('records an active applied materialized rule', () => {
  const source = input();
  const result = recordRuleEffectivenessForRun(source);
  const events = loadRuleEffectivenessEvents({
    filePath: source.effectivenessFilePath,
  }).events;
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.recorded, 1);
  assert.equal(events[0].effectStatus, 'APPLIED_EFFECT');
  assert.equal(events[0].impact.quantityDelta, -10);
  assert.equal(events[0].impact.orderAmountDelta, -1000);
});

test('records matched no change and no match semantics', () => {
  const matched = input();
  matched.applicationResult.applications = [application({
    agentRecommendation: 'SKIP',
    finalRecommendation: 'SKIP',
    agentQuantity: 0,
    finalQuantity: 0,
    applicationStatus: 'UNCHANGED',
    ruleApplied: false,
  })];
  recordRuleEffectivenessForRun(matched);
  assert.equal(
    loadRuleEffectivenessEvents({
      filePath: matched.effectivenessFilePath,
    }).events[0].effectStatus,
    'MATCHED_NO_CHANGE'
  );

  const unmatched = input();
  unmatched.applicationResult.applications = [];
  recordRuleEffectivenessForRun(unmatched);
  assert.equal(
    loadRuleEffectivenessEvents({
      filePath: unmatched.effectivenessFilePath,
    }).events[0].effectStatus,
    'NO_MATCH'
  );
});

test('records fallback for every active materialized rule', () => {
  const source = input();
  source.applicationResult.status = 'FALLBACK_TO_BASELINE';
  source.applicationResult.errorCode = 'FINANCIAL_RECALCULATION_INCOMPLETE';
  source.applicationResult.applications = [];
  recordRuleEffectivenessForRun(source);
  const saved = loadRuleEffectivenessEvents({
    filePath: source.effectivenessFilePath,
  }).events[0];
  assert.equal(saved.effectStatus, 'FALLBACK_TO_BASELINE');
  assert.equal(saved.fallback.occurred, true);
  assert.equal(
    saved.fallback.reasonCode,
    'FINANCIAL_RECALCULATION_INCOMPLETE'
  );
});

test('disabled, legacy, OFF, PREVIEW and no active rules are skipped', () => {
  for (const source of [
    input({
      registry: {
        rules: [rule({ status: 'DISABLED' })],
      },
    }),
    input({
      registry: {
        rules: [rule({
          source: undefined,
          provenance: undefined,
        })],
      },
    }),
    input({
      runContext: {
        runId: 'run-1',
        recordedAt: '2026-01-01T00:00:00.000Z',
        applicationMode: 'OFF',
      },
    }),
    input({
      runContext: {
        runId: 'run-1',
        recordedAt: '2026-01-01T00:00:00.000Z',
        applicationMode: 'PREVIEW',
      },
    }),
  ]) {
    assert.equal(recordRuleEffectivenessForRun(source).status, 'SKIPPED');
    assert.equal(fs.existsSync(source.effectivenessFilePath), false);
  }
});

test('duplicate retry is idempotent', () => {
  const source = input();
  assert.equal(recordRuleEffectivenessForRun(source).recorded, 1);
  const duplicate = recordRuleEffectivenessForRun(source);
  assert.equal(duplicate.status, 'RECORDED');
  assert.equal(duplicate.duplicates, 1);
  assert.equal(
    loadRuleEffectivenessEvents({
      filePath: source.effectivenessFilePath,
    }).events.length,
    1
  );
});

test('journal failure never throws and writes one safe warning', () => {
  const source = input();
  const warnings = [];
  source.logger = { warn(message) { warnings.push(message); } };
  const result = recordRuleEffectivenessForRun(source, {
    append() {
      throw new Error('/private/path stack secret');
    },
  });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.failed, 1);
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0], /private|stack|secret/i);
});

test('partial recording is reported without throwing', () => {
  const source = input();
  source.registry.rules.push(rule({
    ruleId: 'rule-2',
    stableItemKey: 'sku:200',
    provenance: {
      source: 'OWNER_LEARNING_CANDIDATE',
      candidateId: 'candidate-2',
    },
  }));
  let calls = 0;
  const result = recordRuleEffectivenessForRun(source, {
    append() {
      calls += 1;
      if (calls === 2) throw new Error('failure');
      return { added: true };
    },
  });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.recorded, 1);
  assert.equal(result.failed, 1);
});

test('event contains no raw stable key, order payload, paths or fingerprints in metadata', () => {
  const source = input();
  const applicationBefore = structuredClone(source.applicationResult);
  recordRuleEffectivenessForRun(source);
  const saved = loadRuleEffectivenessEvents({
    filePath: source.effectivenessFilePath,
  }).events[0];
  const serialized = JSON.stringify(saved);
  assert.doesNotMatch(serialized, /sku:100/);
  assert.doesNotMatch(serialized, /workingOrderProducts/);
  assert.doesNotMatch(serialized, /effectivenessFilePath/);
  assert.deepEqual(source.applicationResult, applicationBefore);
});
