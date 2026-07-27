const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  OwnerRuleMaterializationError,
  createMaterializationFingerprint,
  materializeRuleFromCandidate,
  validateCandidateForMaterialization,
} = require('../owner_learning/owner_rule_materializer');

const NOW = '2026-07-25T04:00:00.000Z';

function candidate(overrides = {}) {
  return {
    candidateId: 'candidate-a',
    patternType: 'SAME_ITEM_SAME_DECISION',
    proposedRuleType: 'ITEM_DECISION_OVERRIDE',
    scopeType: 'ITEM',
    scopeKey: 'sku:7177004',
    displayScope: {
      primary: 'AWARD Hairball',
      secondary: 'SKU 7177004',
    },
    proposedAction: {
      decision: 'SKIP',
      quantityStrategy: 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    confidence: { score: 91, level: 'VERY_HIGH' },
    ranking: {
      priorityScore: 88,
      priorityLevel: 'HIGH',
    },
    eligibility: { status: 'ELIGIBLE' },
    ownerComment: 'private',
    metadata: { token: 'private' },
    evidenceDecisionIds: ['private-id'],
    ...overrides,
  };
}

function lifecycle(overrides = {}) {
  return {
    candidateId: 'candidate-a',
    status: 'APPROVED',
    lastEvent: {
      eventId: 'lifecycle-event-a',
      toStatus: 'APPROVED',
    },
    ...overrides,
  };
}

function materialize(candidateValue = candidate(), state = lifecycle()) {
  return materializeRuleFromCandidate({
    candidate: candidateValue,
    lifecycleState: state,
    options: { materializedAt: NOW },
  });
}

test('valid approved eligible item candidate becomes disabled rule', () => {
  const result = materialize();
  assert.equal(result.ruleDraft.status, 'DISABLED');
  assert.equal(result.ruleDraft.ruleType, 'ITEM_DECISION_OVERRIDE');
  assert.equal(result.ruleDraft.scopeType, 'ITEM');
  assert.equal(result.ruleDraft.stableItemKey, 'sku:7177004');
  assert.equal(result.provenance.lifecycleEventId, 'lifecycle-event-a');
});

for (const [decision, strategy] of [
  ['BUY', 'KEEP_AGENT_QUANTITY'],
  ['SKIP', 'NO_QUANTITY_CHANGE'],
  ['DEFER', 'NO_QUANTITY_CHANGE'],
]) {
  test(`${decision} uses ${strategy} without fixed quantity`, () => {
    const result = materialize(candidate({
      proposedAction: {
        decision,
        quantityStrategy: strategy,
        quantityValue: null,
      },
    }));
    assert.deepEqual(result.ruleDraft.action, {
      decision,
      quantityStrategy: strategy,
      quantityValue: null,
    });
  });
}

for (const status of ['REVIEW_ONLY', 'INELIGIBLE']) {
  test(`${status} candidate is not eligible`, () => {
    assert.throws(
      () => materialize(candidate({
        eligibility: { status },
      })),
      error => error.code === 'CANDIDATE_NOT_ELIGIBLE'
    );
  });
}

for (const status of [
  'NEW',
  'UNDER_REVIEW',
  'REJECTED',
  'POSTPONED',
]) {
  test(`${status} lifecycle is not approved`, () => {
    assert.throws(
      () => materialize(candidate(), lifecycle({ status })),
      error => error.code === 'CANDIDATE_NOT_APPROVED'
    );
  });
}

for (const [name, overrides] of [
  ['brand', { scopeType: 'BRAND' }],
  ['supplier', { scopeType: 'SUPPLIER' }],
  ['reason', { patternType: 'SAME_ITEM_SAME_REASON' }],
  ['disagreement', { patternType: 'AGENT_DISAGREEMENT_REPEAT' }],
]) {
  test(`${name} candidate type is not materializable`, () => {
    assert.throws(
      () => materialize(candidate(overrides)),
      error =>
        error.code === 'CANDIDATE_TYPE_NOT_MATERIALIZABLE'
    );
  });
}

test('low confidence is rejected', () => {
  assert.throws(
    () => materialize(candidate({
      confidence: { score: 25, level: 'LOW' },
    })),
    error => error.code === 'CANDIDATE_NOT_ELIGIBLE'
  );
});

test('missing candidateId and invalid decision are controlled', () => {
  assert.throws(
    () => materialize(candidate({ candidateId: null })),
    error =>
      error.code === 'OWNER_RULE_MATERIALIZATION_INVALID_INPUT'
  );
  assert.throws(
    () => materialize(candidate({
      proposedAction: { decision: 'REVIEW' },
    })),
    error =>
      error.code === 'OWNER_RULE_MATERIALIZATION_INVALID_INPUT'
  );
});

test('invalid and null inputs are controlled', () => {
  for (const value of [null, undefined, [], 'candidate']) {
    assert.throws(
      () => validateCandidateForMaterialization({
        candidate: value,
        lifecycleState: lifecycle(),
      }),
      error => error instanceof OwnerRuleMaterializationError
    );
  }
});

test('materialization and rule identities are deterministic', () => {
  assert.deepEqual(materialize(), materialize());
  assert.match(materialize().materializationId, /^[0-9a-f]{64}$/);
  assert.match(
    materialize().ruleDraft.ruleId,
    /^approved-rule-[0-9a-f]{24}$/
  );
  assert.equal(
    createMaterializationFingerprint({ candidate: candidate() }),
    createMaterializationFingerprint({ candidate: candidate() })
  );
});

test('materialization never mutates input', () => {
  const source = candidate();
  const state = lifecycle();
  const before = structuredClone({ source, state });
  materialize(source, state);
  assert.deepEqual({ source, state }, before);
});

test('private candidate fields never reach result', () => {
  const json = JSON.stringify(materialize());
  for (const forbidden of [
    'ownerComment',
    'metadata',
    'evidenceDecisionIds',
    'private',
  ]) {
    assert.equal(json.includes(forbidden), false);
  }
});
