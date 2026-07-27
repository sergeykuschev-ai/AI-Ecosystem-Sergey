const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  OwnerMaterializedRulesService,
  MATERIALIZATION_HISTORY_WARNING,
  STATUS_HISTORY_WARNING,
} = require('../application/owner_materialized_rules_service');
const {
  mapOwnerMaterializedRules,
} = require('../dto/owner_materialized_rules_mapper');
const {
  createCandidateLifecycleEvent,
  emptyCandidateLifecycle,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_candidate_lifecycle'
);
const {
  createRuleEffectivenessEvent,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_effectiveness'
);
const crypto = require('node:crypto');

const GENERATED_AT = '2026-07-25T08:00:00.000Z';
const CANDIDATE_A = 'a'.repeat(64);
const CANDIDATE_B = 'b'.repeat(64);

function rule(overrides = {}) {
  const {
    provenance: provenanceOverrides = {},
    ...ruleOverrides
  } = overrides;
  const candidateId =
    provenanceOverrides.candidateId || CANDIDATE_A;
  const materializedAt =
    provenanceOverrides.materializedAt ||
    '2026-07-20T10:00:00.000Z';
  const decision = overrides.approvedDecision || 'SKIP';
  return {
    ruleId: 'approved-rule-a',
    proposalId: 'materialization-a',
    stableItemKey: 'sku:7177004',
    name: 'Snapshot registry product',
    brand: null,
    ruleType: 'ITEM_DECISION_OVERRIDE',
    approvedDecision: decision,
    approvedAt: materializedAt,
    status: 'DISABLED',
    createdFromVersion: 'owner-rule-materialization-v0.9.0',
    notes: null,
    scopeType: 'ITEM',
    scopeKey: 'sku:7177004',
    action: {
      decision,
      quantityStrategy: decision === 'BUY'
        ? 'KEEP_AGENT_QUANTITY'
        : 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    source: 'OWNER_LEARNING_CANDIDATE',
    createdAt: materializedAt,
    updatedAt: materializedAt,
    provenance: {
      source: 'OWNER_LEARNING_CANDIDATE',
      candidateId,
      lifecycleEventId: 'lifecycle-a',
      patternType: 'SAME_ITEM_SAME_DECISION',
      confidenceScore: 91,
      confidenceLevel: 'VERY_HIGH',
      priorityScore: 88,
      priorityLevel: 'HIGH',
      eligibilityStatus: 'ELIGIBLE',
      materializedAt,
      materializationVersion: 'v0.9.0',
      ...provenanceOverrides,
    },
    ...ruleOverrides,
  };
}

function legacyRule() {
  return {
    ruleId: 'approved-rule-legacy',
    proposalId: 'proposal-legacy',
    stableItemKey: 'sku:legacy',
    name: 'Legacy',
    brand: null,
    ruleType: 'ITEM_DECISION',
    approvedDecision: 'BUY',
    approvedAt: '2026-06-01T00:00:00.000Z',
    status: 'ACTIVE',
    createdFromVersion: 'owner-rule-proposals-v0.3',
    notes: null,
  };
}

function event(inputRule = rule(), overrides = {}) {
  return {
    schemaVersion: 'owner-learning-rule-materializations-v0.9.0',
    materializationId: inputRule.proposalId,
    recordedAt: inputRule.provenance.materializedAt,
    candidateId: inputRule.provenance.candidateId,
    lifecycleEventId: inputRule.provenance.lifecycleEventId,
    ruleId: inputRule.ruleId,
    resultStatus: 'CREATED',
    ruleStatus: 'DISABLED',
    fingerprint: `fingerprint-${inputRule.ruleId}`,
    snapshot: {
      patternType: 'SAME_ITEM_SAME_DECISION',
      proposedRuleType: 'ITEM_DECISION_OVERRIDE',
      proposedDecision: inputRule.approvedDecision,
      confidenceScore: inputRule.provenance.confidenceScore,
      confidenceLevel: inputRule.provenance.confidenceLevel,
      priorityScore: inputRule.provenance.priorityScore,
      priorityLevel: inputRule.provenance.priorityLevel,
    },
    metadata: {},
    ...overrides,
  };
}

function journal(rules = []) {
  return {
    schemaVersion: 'owner-learning-rule-materializations-v0.9.0',
    updatedAt: rules.at(-1)?.provenance.materializedAt || null,
    events: rules.map(value => event(value)),
  };
}

function candidate(candidateId = CANDIDATE_A, overrides = {}) {
  return {
    candidateId,
    displayScope: {
      primary: 'Current product',
      secondary: 'SKU 7177004',
    },
    ...overrides,
  };
}

function lifecycle(candidateId = CANDIDATE_A) {
  const lifecycleEvent = createCandidateLifecycleEvent({
    recordedAt: '2026-07-19T09:00:00.000Z',
    candidateId,
    fromStatus: 'NEW',
    toStatus: 'APPROVED',
    action: 'APPROVE',
    actor: 'OWNER',
    reasonCode: 'READY_FOR_RULE',
    ownerComment: 'private owner comment',
    candidateSnapshot: {
      patternType: 'SAME_ITEM_SAME_DECISION',
      scopeType: 'ITEM',
      displayScope: {
        primary: 'Lifecycle snapshot product',
        secondary: 'SKU 7177004',
      },
      proposedRuleType: 'ITEM_DECISION_OVERRIDE',
      proposedDecision: 'SKIP',
      confidenceScore: 91,
      confidenceLevel: 'VERY_HIGH',
      priorityScore: 88,
      priorityLevel: 'HIGH',
      eligibilityStatus: 'ELIGIBLE',
    },
    metadata: { source: 'TEST' },
  });
  return {
    schemaVersion: 'owner-learning-candidate-lifecycle-v0.8.5',
    updatedAt: lifecycleEvent.recordedAt,
    events: [lifecycleEvent],
  };
}

function service({
  rules = [],
  candidates = [],
  lifecycleValue = emptyCandidateLifecycle(),
  loadRegistry,
  loadMaterializations,
  loadLifecycle,
  loadStatusEvents,
  loadEffectiveness,
  effectivenessFilePath = null,
  statusEventsFilePath = null,
  candidatesService,
} = {}) {
  return new OwnerMaterializedRulesService({
    approvedRulesFilePath: '/tmp/test-approved-rules.json',
    materializationsFilePath: '/tmp/test-materializations.json',
    candidateLifecycleFilePath: '/tmp/test-lifecycle.json',
    ...(statusEventsFilePath ? { statusEventsFilePath } : {}),
    ...(effectivenessFilePath ? { effectivenessFilePath } : {}),
    now: () => GENERATED_AT,
    logger: { warn() {} },
    loadRegistry: loadRegistry || (() => ({
      schemaVersion: 'owner-approved-rules-v0.4',
      updatedAt: null,
      rules,
    })),
    loadMaterializations:
      loadMaterializations || (() => journal(
        rules.filter(value => value.provenance)
      )),
    loadLifecycle: loadLifecycle || (() => lifecycleValue),
    ...(loadStatusEvents ? { loadStatusEvents } : {}),
    ...(loadEffectiveness ? { loadEffectiveness } : {}),
    candidatesService: candidatesService || {
      getCandidates() {
        return { status: 'AVAILABLE', candidates };
      },
    },
  });
}

function effectivenessEvent(inputRule = rule()) {
  const digest = value => crypto.createHash('sha256')
    .update(value)
    .digest('hex');
  return createRuleEffectivenessEvent({
    recordedAt: '2026-07-24T00:00:00.000Z',
    runId: 'run-effectiveness',
    supplier: 'Валта',
    ruleId: inputRule.ruleId,
    candidateId: inputRule.provenance.candidateId,
    ruleStatus: 'ACTIVE',
    ruleType: 'ITEM_DECISION_OVERRIDE',
    decision: inputRule.approvedDecision,
    evaluationStatus: 'EVALUATED',
    effectStatus: 'APPLIED_EFFECT',
    scopeSnapshot: {
      displayPrimary: inputRule.name,
      displaySecondary: 'SKU 7177004',
      stableItemKeyHash: digest(inputRule.stableItemKey),
    },
    impact: {
      affectedRows: 1,
      decisionChanges: 1,
      quantityChanges: 1,
      quantityBefore: 10,
      quantityAfter: 0,
      quantityDelta: -10,
      orderAmountBefore: 1000,
      orderAmountAfter: 0,
      orderAmountDelta: -1000,
      financialStatusBefore: 'APPROVED',
      financialStatusAfter: 'APPROVED',
      financiallyPermitted: true,
    },
    fallback: { occurred: false, reasonCode: null },
    applicationMode: 'APPLY_SAFE',
    registryFingerprint: digest('registry'),
    runFingerprint: digest('run-effectiveness'),
    metadata: {},
  });
}

test('empty registry is available with zero summary', () => {
  const result = service().listRules();
  assert.equal(result.status, 'AVAILABLE');
  assert.deepEqual(result.summary, {
    totalRules: 0,
    activeRules: 0,
    disabledRules: 0,
    buyRules: 0,
    skipRules: 0,
    deferRules: 0,
    currentCandidateAvailable: 0,
    currentCandidateUnavailable: 0,
  });
  assert.deepEqual(result.rules, []);
});

test('knowledge health snapshot reuses all loaded sources once', () => {
  const materialized = rule();
  const legacy = legacyRule();
  const calls = {
    registry: 0,
    materializations: 0,
    lifecycle: 0,
    statuses: 0,
    effectiveness: 0,
  };
  const instance = service({
    rules: [materialized, legacy],
    lifecycleValue: lifecycle(),
    statusEventsFilePath: '/tmp/statuses.json',
    effectivenessFilePath: '/tmp/effectiveness.json',
    loadRegistry() {
      calls.registry += 1;
      return {
        schemaVersion: 'owner-approved-rules-v0.4',
        updatedAt: null,
        rules: [materialized, legacy],
      };
    },
    loadMaterializations() {
      calls.materializations += 1;
      return journal([materialized]);
    },
    loadLifecycle() {
      calls.lifecycle += 1;
      return lifecycle();
    },
    loadStatusEvents() {
      calls.statuses += 1;
      return { events: [] };
    },
    loadEffectiveness() {
      calls.effectiveness += 1;
      return { events: [effectivenessEvent(materialized)] };
    },
  });
  const result = instance.getKnowledgeHealthSnapshot({
    asOf: GENERATED_AT,
  });
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.rules.length, 2);
  assert.equal(result.materializations.length, 1);
  assert.equal(result.lifecycleStates.length, 1);
  assert.equal(result.effectivenessSummaries.length, 2);
  assert.deepEqual(calls, {
    registry: 1,
    materializations: 1,
    lifecycle: 1,
    statuses: 1,
    effectiveness: 1,
  });
});

test('knowledge health snapshot is PARTIAL when effectiveness is damaged', () => {
  const result = service({
    rules: [rule()],
    effectivenessFilePath: '/tmp/effectiveness.json',
    loadEffectiveness() {
      throw new Error('corrupted');
    },
  }).getKnowledgeHealthSnapshot({ asOf: GENERATED_AT });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.components.effectiveness, 'UNAVAILABLE');
  assert.deepEqual(result.effectivenessSummaries, []);
});

test('materialized disabled and active rules are listed; legacy is excluded', () => {
  const disabled = rule();
  const active = rule({
    ruleId: 'approved-rule-b',
    proposalId: 'materialization-b',
    stableItemKey: 'sku:2',
    scopeKey: 'sku:2',
    approvedDecision: 'BUY',
    status: 'ACTIVE',
    action: {
      decision: 'BUY',
      quantityStrategy: 'KEEP_AGENT_QUANTITY',
      quantityValue: null,
    },
    provenance: {
      candidateId: CANDIDATE_B,
      lifecycleEventId: 'lifecycle-b',
      confidenceScore: 72,
      confidenceLevel: 'HIGH',
      priorityScore: 60,
      priorityLevel: 'MEDIUM',
      materializedAt: '2026-07-21T10:00:00.000Z',
    },
  });
  const result = service({
    rules: [disabled, active, legacyRule()],
  }).listRules();
  assert.equal(result.summary.totalRules, 2);
  assert.equal(result.summary.activeRules, 1);
  assert.equal(result.summary.disabledRules, 1);
  assert.equal(result.summary.buyRules, 1);
  assert.equal(result.summary.skipRules, 1);
  assert.equal(result.rules[0].ruleId, active.ruleId);
  assert.deepEqual(result.rules.map(value => value.safety), [
    {
      affectsPurchasing: true,
      message: 'Правило активно и может влиять на закупку.',
    },
    {
      affectsPurchasing: false,
      message: 'Правило неактивно и не влияет на закупку.',
    },
  ]);
  assert.deepEqual(result.rules.map(value => value.management), [
    {
      manageable: true,
      availableActions: ['DEACTIVATE'],
      lastStatusChangeAt: null,
      lastStatusAction: null,
      previewRequired: true,
    },
    {
      manageable: true,
      availableActions: ['ACTIVATE'],
      lastStatusChangeAt: null,
      lastStatusAction: null,
      previewRequired: true,
    },
  ]);
});

test('status journal enriches management overlay', () => {
  const statusRule = rule({ status: 'ACTIVE' });
  const result = service({
    rules: [statusRule],
    statusEventsFilePath: '/tmp/test-status-events.json',
    loadStatusEvents() {
      return {
        schemaVersion: 'owner-learning-rule-status-events-v0.9.2',
        updatedAt: '2026-07-25T07:00:00.000Z',
        events: [{
          eventId: 'event-1',
          recordedAt: '2026-07-25T07:00:00.000Z',
          ruleId: statusRule.ruleId,
          action: 'ACTIVATE',
        }],
      };
    },
  }).listRules();
  assert.deepEqual(result.rules[0].management, {
    manageable: true,
    availableActions: ['DEACTIVATE'],
    lastStatusChangeAt: '2026-07-25T07:00:00.000Z',
    lastStatusAction: 'ACTIVATE',
    previewRequired: true,
  });
});

test('status journal unavailable keeps rules and actions available', () => {
  const result = service({
    rules: [rule()],
    statusEventsFilePath: '/tmp/test-status-events.json',
    loadStatusEvents() {
      throw new Error('corrupted');
    },
  }).listRules();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.warning, STATUS_HISTORY_WARNING);
  assert.deepEqual(result.rules[0].management, {
    manageable: true,
    availableActions: ['ACTIVATE'],
    lastStatusChangeAt: null,
    lastStatusAction: null,
    previewRequired: true,
  });
});

test('effectiveness overlay supports AVAILABLE, NO_DATA and UNAVAILABLE', () => {
  const sourceRule = rule({ status: 'ACTIVE' });
  const available = service({
    rules: [sourceRule],
    effectivenessFilePath: '/tmp/effectiveness.json',
    loadEffectiveness() {
      return { events: [effectivenessEvent(sourceRule)] };
    },
  }).listRules();
  assert.deepEqual(available.rules[0].effectiveness, {
    status: 'AVAILABLE',
    classification: 'INSUFFICIENT_DATA',
    evaluatedRuns: 1,
    appliedEffectRuns: 1,
    effectRate: 1,
    totalOrderAmountDelta: -1000,
    lastAppliedAt: '2026-07-24T00:00:00.000Z',
    daysSinceLastApplied: 1,
  });

  const noData = service({
    rules: [sourceRule],
    effectivenessFilePath: '/tmp/effectiveness.json',
    loadEffectiveness() {
      return { events: [] };
    },
  }).listRules();
  assert.equal(noData.rules[0].effectiveness.status, 'NO_DATA');

  const unavailable = service({
    rules: [sourceRule],
    effectivenessFilePath: '/tmp/effectiveness.json',
    loadEffectiveness() {
      throw new Error('corrupted');
    },
  }).listRules();
  assert.equal(unavailable.status, 'AVAILABLE');
  assert.equal(
    unavailable.rules[0].effectiveness.status,
    'UNAVAILABLE'
  );
  assert.equal(
    unavailable.warning,
    'OWNER_RULE_EFFECTIVENESS_UNAVAILABLE'
  );
  assert.equal(unavailable.rules[0].management.manageable, true);
});

test('legacy-shaped materialized source is not manageable', () => {
  const damaged = rule({ ruleType: 'ITEM_DECISION' });
  const result = service({ rules: [damaged] }).listRules();
  assert.deepEqual(result.rules[0].management, {
    manageable: false,
    availableActions: [],
    lastStatusChangeAt: null,
    lastStatusAction: null,
    previewRequired: true,
  });
});

test('registry unavailable is fail-safe HTTP-200-ready result', () => {
  const result = service({
    loadRegistry() {
      throw new Error('corrupted');
    },
  }).listRules();
  assert.deepEqual(result, {
    status: 'UNAVAILABLE',
    generatedAt: null,
    summary: null,
    rules: [],
    warning: 'OWNER_MATERIALIZED_RULES_UNAVAILABLE',
  });
});

test('journal unavailable keeps registry rules and provenance time', () => {
  const result = service({
    rules: [rule()],
    loadMaterializations() {
      throw new Error('corrupted');
    },
  }).listRules();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.rules.length, 1);
  assert.equal(
    result.rules[0].provenance.materializedAt,
    '2026-07-20T10:00:00.000Z'
  );
  assert.equal(result.warning, MATERIALIZATION_HISTORY_WARNING);
});

test('current candidate and lifecycle context enrich display and state', () => {
  const result = service({
    rules: [rule()],
    candidates: [candidate()],
    lifecycleValue: lifecycle(),
  }).listRules();
  const value = result.rules[0];
  assert.deepEqual(value.displayScope, {
    primary: 'Current product',
    secondary: '7177004',
  });
  assert.equal(value.candidateAvailability.status, 'AVAILABLE');
  assert.deepEqual(value.lifecycle, {
    status: 'APPROVED',
    lastAction: 'APPROVE',
    lastRecordedAt: '2026-07-19T09:00:00.000Z',
    reasonCode: 'READY_FOR_RULE',
  });
});

test('missing current candidate uses lifecycle snapshot and registry SKU', () => {
  const result = service({
    rules: [rule()],
    lifecycleValue: lifecycle(),
  }).listRules();
  assert.deepEqual(result.rules[0].displayScope, {
    primary: 'Lifecycle snapshot product',
    secondary: '7177004',
  });
  assert.equal(
    result.rules[0].candidateAvailability.status,
    'UNAVAILABLE'
  );
  assert.equal(result.summary.currentCandidateUnavailable, 1);
});

test('unavailable candidate and lifecycle sources keep rules readable', () => {
  const result = service({
    rules: [rule()],
    candidatesService: {
      getCandidates() {
        throw new Error('unavailable');
      },
    },
    loadLifecycle() {
      throw new Error('unavailable');
    },
  }).listRules();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.rules[0].displayScope.primary, 'Snapshot registry product');
  assert.equal(result.rules[0].lifecycle.status, null);
  assert.equal(
    result.rules[0].candidateAvailability.status,
    'UNAVAILABLE'
  );
});

test('enum, availability, lifecycle, date and search filters work', () => {
  const value = rule();
  const instance = service({
    rules: [value],
    candidates: [candidate()],
    lifecycleValue: lifecycle(),
  });
  const matching = [
    { status: 'DISABLED' },
    { decision: 'SKIP' },
    { confidenceLevel: 'VERY_HIGH' },
    { priorityLevel: 'HIGH' },
    { lifecycleStatus: 'APPROVED' },
    { candidateAvailability: 'AVAILABLE' },
    { dateFrom: '2026-07-20', dateTo: '2026-07-20' },
    { search: 'current product' },
    { search: '7177004' },
    { search: 'approved-rule-a' },
  ];
  for (const filters of matching) {
    assert.equal(instance.listRules({ filters }).rules.length, 1);
  }
  for (const filters of [
    { status: 'ACTIVE' },
    { decision: 'BUY' },
    { dateFrom: '2026-07-21' },
    { search: 'missing' },
  ]) {
    assert.equal(instance.listRules({ filters }).rules.length, 0);
  }
});

test('sorting, deterministic ruleId tie-break and limit are applied', () => {
  const rules = [
    rule({
      ruleId: 'rule-c',
      proposalId: 'm-c',
      provenance: {
        candidateId: 'c'.repeat(64),
        lifecycleEventId: 'lifecycle-c',
      },
    }),
    rule({
      ruleId: 'rule-a',
      proposalId: 'm-a',
      provenance: {
        candidateId: 'd'.repeat(64),
        lifecycleEventId: 'lifecycle-d',
      },
    }),
    rule({
      ruleId: 'rule-b',
      proposalId: 'm-b',
      provenance: {
        candidateId: CANDIDATE_B,
        lifecycleEventId: 'lifecycle-b',
        confidenceScore: 70,
        materializedAt: '2026-07-21T00:00:00.000Z',
      },
    }),
  ];
  const instance = service({ rules });
  assert.deepEqual(
    instance.listRules({
      options: {
        sortBy: 'materializedAt',
        sortDirection: 'desc',
        limit: 3,
      },
    }).rules.map(value => value.ruleId),
    ['rule-b', 'rule-a', 'rule-c']
  );
  assert.deepEqual(
    instance.listRules({
      options: {
        sortBy: 'confidenceScore',
        sortDirection: 'asc',
        limit: 2,
      },
    }).rules.map(value => value.ruleId),
    ['rule-b', 'rule-a']
  );
});

test('invalid enum, date, option and limit are rejected', () => {
  const instance = service();
  for (const input of [
    { filters: { status: 'BROKEN' } },
    { filters: { dateFrom: '2026-02-30' } },
    { filters: { dateFrom: '2026-07-21', dateTo: '2026-07-20' } },
    { options: { sortBy: 'name' } },
    { options: { sortDirection: 'sideways' } },
    { options: { limit: 0 } },
    { options: { limit: 101 } },
  ]) {
    assert.throws(
      () => instance.listRules(input),
      error =>
        error.code === 'OWNER_MATERIALIZED_RULES_INVALID_INPUT'
    );
  }
});

test('detail returns rule by id and not found is controlled', () => {
  const instance = service({ rules: [rule()] });
  assert.equal(
    instance.getRule({ ruleId: 'approved-rule-a' }).rule.ruleId,
    'approved-rule-a'
  );
  assert.throws(
    () => instance.getRule({ ruleId: 'missing-rule' }),
    error => error.code === 'OWNER_MATERIALIZED_RULE_NOT_FOUND'
  );
});

test('DTO allowlist excludes internal and private fields', () => {
  const source = service({
    rules: [rule()],
    candidates: [candidate()],
    lifecycleValue: lifecycle(),
  }).listRules();
  source.rules[0].scopeKey = 'private-scope';
  source.rules[0].stableItemKey = 'private-stable-key';
  source.rules[0].fingerprint = 'private-fingerprint';
  source.rules[0].metadata = { private: true };
  source.rules[0].ownerComment = 'private comment';
  source.rules[0].provenance.lifecycleEventId = 'private-event';
  const mapped = mapOwnerMaterializedRules(source);
  const json = JSON.stringify(mapped);
  for (const forbidden of [
    'scopeKey',
    'stableItemKey',
    'fingerprint',
    'metadata',
    'ownerComment',
    'lifecycleEventId',
    'evidenceDecisionIds',
  ]) {
    assert.equal(json.includes(forbidden), false, forbidden);
  }
  assert.equal(mapped.rules[0].ruleId, 'approved-rule-a');
});

test('rendering is deterministic and does not mutate source data', () => {
  const sourceRule = rule();
  const before = structuredClone(sourceRule);
  const instance = service({ rules: [sourceRule] });
  assert.deepEqual(instance.listRules(), instance.listRules());
  assert.deepEqual(sourceRule, before);
});
