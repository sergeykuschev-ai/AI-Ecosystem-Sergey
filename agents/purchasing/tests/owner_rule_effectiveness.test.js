const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  RULE_EFFECTIVENESS_SCHEMA_VERSION,
  appendRuleEffectivenessEvent,
  createRuleEffectivenessEvent,
  emptyRuleEffectivenessEvents,
  findRuleEffectivenessEvents,
  loadRuleEffectivenessEvents,
  summarizeAllRuleEffectiveness,
  summarizeRuleEffectiveness,
} = require('../owner_learning/owner_rule_effectiveness');

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), {
      recursive: true,
      force: true,
    });
  }
});

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function temporaryFile() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rule-effectiveness-')
  );
  temporaryDirectories.push(directory);
  return path.join(directory, 'events.json');
}

function event(overrides = {}) {
  const runId = overrides.runId || 'run-1';
  const effectStatus = overrides.effectStatus || 'APPLIED_EFFECT';
  const applied = effectStatus === 'APPLIED_EFFECT';
  const fallback = effectStatus === 'FALLBACK_TO_BASELINE';
  return createRuleEffectivenessEvent({
    recordedAt:
      overrides.recordedAt || '2026-01-01T00:00:00.000Z',
    runId,
    supplier: 'Валта',
    ruleId: overrides.ruleId || 'rule-1',
    candidateId: 'candidate-1',
    ruleStatus: 'ACTIVE',
    ruleType: 'ITEM_DECISION_OVERRIDE',
    decision: overrides.decision || 'SKIP',
    evaluationStatus:
      overrides.evaluationStatus || 'EVALUATED',
    effectStatus,
    scopeSnapshot: {
      displayPrimary: '<b>Товар</b>',
      displaySecondary: 'SKU 100',
      stableItemKeyHash: digest('sku:100'),
    },
    impact: {
      affectedRows: applied ? 1 : 0,
      decisionChanges: applied ? 1 : 0,
      quantityChanges: applied ? 1 : 0,
      quantityBefore: 10,
      quantityAfter: applied ? 0 : 10,
      quantityDelta: applied ? -10 : 0,
      orderAmountBefore: 1000,
      orderAmountAfter: applied ? 0 : 1000,
      orderAmountDelta: applied ? -1000 : 0,
      financialStatusBefore: 'APPROVED',
      financialStatusAfter: 'APPROVED',
      financiallyPermitted: true,
      ...(overrides.impact || {}),
    },
    fallback: {
      occurred: fallback,
      reasonCode: fallback ? 'RECALCULATION_FAILED' : null,
    },
    applicationMode: 'APPLY_SAFE',
    registryFingerprint: digest('registry'),
    runFingerprint: digest(
      overrides.runFingerprint || `${runId}:${effectStatus}`
    ),
    metadata: overrides.metadata || { recorderVersion: 'test' },
  });
}

function summary(events, ruleId = 'rule-1', options = {}) {
  return summarizeRuleEffectiveness({
    events,
    ruleId,
    options: {
      asOf: '2026-03-01T00:00:00.000Z',
      ...options,
    },
  });
}

test('empty journal has the v0.9.3 append-only shape', () => {
  assert.deepEqual(emptyRuleEffectivenessEvents(), {
    schemaVersion: RULE_EFFECTIVENESS_SCHEMA_VERSION,
    updatedAt: null,
    events: [],
  });
});

test('creates APPLIED_EFFECT, MATCHED_NO_CHANGE, NO_MATCH and fallback events', () => {
  const statuses = [
    'APPLIED_EFFECT',
    'MATCHED_NO_CHANGE',
    'NO_MATCH',
    'FALLBACK_TO_BASELINE',
  ];
  for (const [index, effectStatus] of statuses.entries()) {
    const created = event({
      runId: `run-${index}`,
      effectStatus,
    });
    assert.equal(created.effectStatus, effectStatus);
    assert.equal(
      created.fallback.occurred,
      effectStatus === 'FALLBACK_TO_BASELINE'
    );
  }
});

test('eventId is deterministic and input is not mutated', () => {
  const first = event();
  const second = event();
  assert.equal(first.eventId, second.eventId);
  const input = {
    runId: 'run-clone',
    effectStatus: 'NO_MATCH',
    impact: { quantityBefore: 8 },
  };
  const before = structuredClone(input);
  event(input);
  assert.deepEqual(input, before);
});

test('append writes first and second events atomically', () => {
  const filePath = temporaryFile();
  const first = appendRuleEffectivenessEvent({
    filePath,
    event: event(),
    randomSuffix: 'first',
  });
  const second = appendRuleEffectivenessEvent({
    filePath,
    event: event({
      runId: 'run-2',
      effectStatus: 'NO_MATCH',
      recordedAt: '2026-01-02T00:00:00.000Z',
    }),
    randomSuffix: 'second',
  });
  assert.equal(first.added, true);
  assert.equal(second.added, true);
  assert.equal(loadRuleEffectivenessEvents({ filePath }).events.length, 2);
  assert.deepEqual(
    fs.readdirSync(path.dirname(filePath)).filter(name =>
      name.endsWith('.tmp')
    ),
    []
  );
});

test('duplicate append does not rewrite journal', () => {
  const filePath = temporaryFile();
  const created = event();
  appendRuleEffectivenessEvent({ filePath, event: created });
  const before = fs.statSync(filePath).mtimeMs;
  const duplicate = appendRuleEffectivenessEvent({
    filePath,
    event: created,
  });
  assert.equal(duplicate.added, false);
  assert.equal(fs.statSync(filePath).mtimeMs, before);
  assert.equal(duplicate.journal.events.length, 1);
});

test('load rejects corrupted JSON and unsupported schema', () => {
  const corrupted = temporaryFile();
  fs.writeFileSync(corrupted, '{', 'utf8');
  assert.throws(
    () => loadRuleEffectivenessEvents({ filePath: corrupted }),
    error => error.code ===
      'OWNER_RULE_EFFECTIVENESS_STORAGE_CORRUPTED'
  );
  const unsupported = temporaryFile();
  fs.writeFileSync(unsupported, JSON.stringify({
    schemaVersion: 'future',
    updatedAt: null,
    events: [],
  }));
  assert.throws(
    () => loadRuleEffectivenessEvents({ filePath: unsupported }),
    error => error.code ===
      'OWNER_RULE_EFFECTIVENESS_SCHEMA_UNSUPPORTED'
  );
});

test('unsafe metadata and absolute paths are rejected', () => {
  assert.throws(
    () => event({ metadata: { stableItemKey: 'sku:100' } }),
    error => error.code === 'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT'
  );
  assert.throws(
    () => event({ metadata: { nested: { outputPath: '/tmp/x' } } }),
    error => error.code === 'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT'
  );
});

test('find filters by rule, effect status and dates', () => {
  const events = [
    event(),
    event({
      ruleId: 'rule-2',
      runId: 'run-2',
      effectStatus: 'NO_MATCH',
    }),
    event({
      runId: 'run-3',
      effectStatus: 'MATCHED_NO_CHANGE',
      recordedAt: '2026-02-01T00:00:00.000Z',
    }),
  ];
  const found = findRuleEffectivenessEvents({
    events,
    ruleId: 'rule-1',
    filters: {
      effectStatus: 'MATCHED_NO_CHANGE',
      dateFrom: '2026-01-15T00:00:00.000Z',
      dateTo: '2026-02-02T00:00:00.000Z',
    },
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].runId, 'run-3');
});

test('empty summary is deterministic and has null rates', () => {
  const first = summary([]);
  const second = summary([]);
  assert.deepEqual(first, second);
  assert.equal(first.population.totalEvents, 0);
  assert.equal(first.effects.effectRate, null);
  assert.equal(first.effects.matchRate, null);
  assert.equal(first.classification, 'INSUFFICIENT_DATA');
});

test('summary calculates rates, quantity and amount totals', () => {
  const events = [
    event(),
    event({
      runId: 'run-2',
      effectStatus: 'MATCHED_NO_CHANGE',
      recordedAt: '2026-01-02T00:00:00.000Z',
    }),
    event({
      runId: 'run-3',
      effectStatus: 'NO_MATCH',
      recordedAt: '2026-01-03T00:00:00.000Z',
    }),
  ];
  const value = summary(events);
  assert.equal(value.effects.effectRate, 0.3333);
  assert.equal(value.effects.matchRate, 0.6667);
  assert.equal(value.impact.totalAffectedRows, 1);
  assert.equal(value.impact.totalQuantityChanges, 1);
  assert.equal(value.impact.totalQuantityDelta, -10);
  assert.equal(value.impact.totalOrderAmountDelta, -1000);
  assert.equal(value.impact.negativeAmountDeltaRuns, 1);
});

test('summary reports last applied, days and consecutive no-effect runs', () => {
  const value = summary([
    event({ recordedAt: '2026-01-01T00:00:00.000Z' }),
    event({
      runId: 'run-2',
      effectStatus: 'NO_MATCH',
      recordedAt: '2026-01-02T00:00:00.000Z',
    }),
    event({
      runId: 'run-3',
      effectStatus: 'MATCHED_NO_CHANGE',
      recordedAt: '2026-01-03T00:00:00.000Z',
    }),
  ]);
  assert.equal(value.activity.lastAppliedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(value.activity.daysSinceLastApplied, 59);
  assert.equal(value.activity.consecutiveNoEffectRuns, 2);
});

test('classifies EFFECTIVE and OCCASIONAL', () => {
  const effective = summary([
    event({ runId: 'a', recordedAt: '2026-02-01T00:00:00.000Z' }),
    event({ runId: 'b', recordedAt: '2026-02-02T00:00:00.000Z' }),
    event({
      runId: 'c',
      effectStatus: 'NO_MATCH',
      recordedAt: '2026-02-03T00:00:00.000Z',
    }),
  ]);
  assert.equal(effective.classification, 'EFFECTIVE');
  const occasional = summary([
    event({ runId: 'a', recordedAt: '2026-02-01T00:00:00.000Z' }),
    event({
      runId: 'b',
      effectStatus: 'NO_MATCH',
      recordedAt: '2026-02-02T00:00:00.000Z',
    }),
    event({
      runId: 'c',
      effectStatus: 'NO_MATCH',
      recordedAt: '2026-02-03T00:00:00.000Z',
    }),
  ]);
  assert.equal(occasional.classification, 'OCCASIONAL');
});

test('classifies NO_EFFECT_YET, STALE and INSUFFICIENT_DATA', () => {
  const noEffect = summary([
    event({ runId: 'a', effectStatus: 'NO_MATCH' }),
    event({ runId: 'b', effectStatus: 'MATCHED_NO_CHANGE' }),
    event({ runId: 'c', effectStatus: 'NO_MATCH' }),
  ]);
  assert.equal(noEffect.classification, 'NO_EFFECT_YET');
  const stale = summary([
    event({
      runId: 'a',
      recordedAt: '2025-01-01T00:00:00.000Z',
    }),
    event({
      runId: 'b',
      effectStatus: 'NO_MATCH',
      recordedAt: '2025-01-02T00:00:00.000Z',
    }),
    event({
      runId: 'c',
      effectStatus: 'NO_MATCH',
      recordedAt: '2025-01-03T00:00:00.000Z',
    }),
  ]);
  assert.equal(stale.classification, 'STALE');
  assert.equal(summary([event()]).classification, 'INSUFFICIENT_DATA');
});

test('fallback, long no-effect streak and data quality recommend review', () => {
  const fallback = summary([
    event({ runId: 'a', effectStatus: 'FALLBACK_TO_BASELINE' }),
  ]);
  assert.equal(fallback.classification, 'REVIEW_RECOMMENDED');
  const noEffect = Array.from({ length: 5 }, (_, index) => event({
    runId: `no-effect-${index}`,
    effectStatus: 'NO_MATCH',
    recordedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
  }));
  assert.equal(summary(noEffect).classification, 'REVIEW_RECOMMENDED');
  const missing = event({
    impact: { orderAmountDelta: null },
  });
  assert.equal(summary([missing]).classification, 'REVIEW_RECOMMENDED');
});

test('summary counts duplicate and invalid events as quality issues', () => {
  const valid = event();
  const invalid = { ...event({ runId: 'invalid' }), eventId: 'bad' };
  const value = summary([valid, valid, invalid]);
  assert.equal(value.quality.duplicateEvents, 1);
  assert.equal(value.quality.invalidEvents, 1);
  assert.equal(value.classification, 'REVIEW_RECOMMENDED');
});

test('explanation codes are fixed enums and observational', () => {
  const value = summary([
    event(),
    event({ runId: 'b', effectStatus: 'MATCHED_NO_CHANGE' }),
    event({ runId: 'c', effectStatus: 'NO_MATCH' }),
  ]);
  assert.ok(value.explanationCodes.includes('RULE_CHANGED_ORDER'));
  assert.ok(
    value.explanationCodes.includes('RULE_MATCHED_WITHOUT_CHANGE')
  );
  assert.ok(value.explanationCodes.includes('RULE_DID_NOT_MATCH'));
  assert.equal(
    value.explanationCodes.at(-1),
    'EFFECTIVENESS_IS_OBSERVATIONAL_ONLY'
  );
});

test('asOf is mandatory and invalid dates are rejected', () => {
  assert.throws(
    () => summarizeRuleEffectiveness({
      events: [],
      ruleId: 'rule-1',
      options: {},
    }),
    error => error.code === 'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT'
  );
});

test('summarizeAll returns deterministic ruleId order', () => {
  const values = summarizeAllRuleEffectiveness({
    events: [
      event({ ruleId: 'rule-b' }),
      event({ ruleId: 'rule-a', runId: 'other' }),
    ],
    options: { asOf: '2026-03-01T00:00:00.000Z' },
  });
  assert.deepEqual(values.map(value => value.ruleId), [
    'rule-a',
    'rule-b',
  ]);
});
