const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');

const {
  createRuleEffectivenessEvent,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_effectiveness'
);
const {
  OwnerRuleEffectivenessService,
} = require('../application/owner_rule_effectiveness_service');
const {
  mapDetail,
  mapEvents,
  mapList,
} = require('../dto/owner_rule_effectiveness_mapper');

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function rule(overrides = {}) {
  return {
    ruleId: 'rule-1',
    stableItemKey: 'sku:100',
    name: '<img src=x onerror=alert(1)>',
    approvedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'ACTIVE',
    ruleType: 'ITEM_DECISION_OVERRIDE',
    approvedDecision: 'SKIP',
    action: {
      decision: 'SKIP',
      quantityStrategy: 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    source: 'OWNER_LEARNING_CANDIDATE',
    provenance: {
      source: 'OWNER_LEARNING_CANDIDATE',
      candidateId: 'private-candidate',
      confidenceScore: 90,
      confidenceLevel: 'VERY_HIGH',
      priorityScore: 80,
      priorityLevel: 'CRITICAL',
    },
    scopeKey: 'private-scope',
    ownerComment: 'private',
    ...overrides,
  };
}

function event(overrides = {}) {
  const runId = overrides.runId || 'run-1';
  const applied = (overrides.effectStatus || 'APPLIED_EFFECT') ===
    'APPLIED_EFFECT';
  return createRuleEffectivenessEvent({
    recordedAt:
      overrides.recordedAt || '2026-02-01T00:00:00.000Z',
    runId,
    supplier: 'Валта',
    ruleId: overrides.ruleId || 'rule-1',
    candidateId: 'private-candidate',
    ruleStatus: overrides.ruleStatus || 'ACTIVE',
    ruleType: 'ITEM_DECISION_OVERRIDE',
    decision: overrides.decision || 'SKIP',
    evaluationStatus: 'EVALUATED',
    effectStatus: overrides.effectStatus || 'APPLIED_EFFECT',
    scopeSnapshot: {
      displayPrimary: 'Товар',
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
    },
    fallback: { occurred: false, reasonCode: null },
    applicationMode: 'APPLY_SAFE',
    registryFingerprint: digest('registry'),
    runFingerprint: digest(`${runId}:${overrides.ruleId || 'rule-1'}`),
    metadata: { recorderVersion: 'test' },
  });
}

function service(options = {}) {
  const rules = options.rules === undefined ? [rule()] : options.rules;
  const events = options.events === undefined ? [event()] : options.events;
  return new OwnerRuleEffectivenessService({
    effectivenessFilePath: '/unused/effectiveness.json',
    approvedRulesFilePath: '/unused/rules.json',
    now: () => new Date('2026-03-01T00:00:00.000Z'),
    logger: { warn() {} },
    loadRegistry: options.loadRegistry || (() => ({ rules })),
    loadEvents: options.loadEvents || (() => ({ events })),
  });
}

test('list is available for empty registry and empty journal', () => {
  const result = service({ rules: [], events: [] })
    .listRuleEffectiveness();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.summary.totalRules, 0);
  assert.deepEqual(result.rules, []);
});

test('one materialized rule is joined with effectiveness', () => {
  const result = service().listRuleEffectiveness();
  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0].effectiveness.effects.appliedEffectRuns, 1);
  assert.equal(
    result.rules[0].effectiveness.impact.totalOrderAmountDelta,
    -1000
  );
  assert.equal(result.summary.appliedRules, 1);
  assert.equal(result.summary.totalOrderAmountDelta, -1000);
});

test('rule without events is exposed as insufficient data', () => {
  const result = service({ events: [] }).listRuleEffectiveness();
  assert.equal(
    result.rules[0].effectiveness.classification,
    'INSUFFICIENT_DATA'
  );
  assert.equal(result.rules[0].effectiveness.population.totalEvents, 0);
});

test('journal or registry unavailable returns safe HTTP-200-ready payload', () => {
  for (const loader of ['loadRegistry', 'loadEvents']) {
    const result = service({
      [loader]() {
        throw new Error('/private/path secret stack');
      },
    }).listRuleEffectiveness();
    assert.deepEqual(result, {
      status: 'UNAVAILABLE',
      generatedAt: null,
      summary: null,
      rules: [],
      warning: 'OWNER_RULE_EFFECTIVENESS_UNAVAILABLE',
    });
  }
});

test('filters, sorting and limit are applied deterministically', () => {
  const rules = [
    rule(),
    rule({
      ruleId: 'rule-2',
      stableItemKey: 'sku:200',
      name: 'Второй товар',
      status: 'DISABLED',
      approvedDecision: 'BUY',
      action: {
        decision: 'BUY',
        quantityStrategy: 'KEEP_AGENT_QUANTITY',
        quantityValue: null,
      },
      provenance: {
        source: 'OWNER_LEARNING_CANDIDATE',
        candidateId: 'candidate-2',
        confidenceScore: 40,
        confidenceLevel: 'LOW',
        priorityScore: 20,
        priorityLevel: 'LOW',
      },
    }),
  ];
  const events = [
    event(),
    event({
      ruleId: 'rule-2',
      runId: 'run-2',
      decision: 'BUY',
      ruleStatus: 'DISABLED',
      effectStatus: 'NO_MATCH',
    }),
  ];
  const result = service({ rules, events }).listRuleEffectiveness({
    filters: {
      ruleStatus: 'disabled',
      decision: 'buy',
      confidenceLevel: 'low',
      priorityLevel: 'low',
      search: 'второй',
    },
    options: {
      sortBy: 'effectRate',
      sortDirection: 'asc',
      limit: 1,
    },
  });
  assert.deepEqual(result.rules.map(value => value.ruleId), ['rule-2']);
});

test('invalid filters, options and asOf are controlled', () => {
  for (const input of [
    { filters: { ruleStatus: 'BROKEN' } },
    { options: { limit: 101 } },
    { options: { sortBy: 'private' } },
    { options: { asOf: 'today' } },
  ]) {
    assert.throws(
      () => service().listRuleEffectiveness(input),
      error =>
        error.code === 'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT'
    );
  }
});

test('detail, not found and latest events are supported', () => {
  const instance = service({
    events: [
      event(),
      event({
        runId: 'run-2',
        effectStatus: 'NO_MATCH',
        recordedAt: '2026-02-02T00:00:00.000Z',
      }),
    ],
  });
  const detail = instance.getRuleEffectiveness({ ruleId: 'rule-1' });
  assert.equal(detail.status, 'AVAILABLE');
  assert.equal(detail.effectiveness.population.evaluatedRuns, 2);
  const events = instance.getRuleEffectivenessEvents({
    ruleId: 'rule-1',
    options: { limit: 1 },
  });
  assert.equal(events.events.length, 1);
  assert.equal(events.events[0].runId, 'run-2');
  assert.throws(
    () => instance.getRuleEffectiveness({ ruleId: 'missing' }),
    error =>
      error.code === 'OWNER_RULE_EFFECTIVENESS_RULE_NOT_FOUND'
  );
});

test('DTO is allowlist-only and events omit technical identifiers', () => {
  const instance = service();
  const list = mapList(instance.listRuleEffectiveness());
  const detail = mapDetail(
    instance.getRuleEffectiveness({ ruleId: 'rule-1' })
  );
  const events = mapEvents(
    instance.getRuleEffectivenessEvents({ ruleId: 'rule-1' })
  );
  const serialized = JSON.stringify({ list, detail, events });
  for (const forbidden of [
    'stableItemKey',
    'scopeKey',
    'eventId',
    'registryFingerprint',
    'runFingerprint',
    'candidateId',
    'ownerComment',
    'metadata',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'));
  }
  assert.equal(events.events[0].runId, 'run-1');
});
