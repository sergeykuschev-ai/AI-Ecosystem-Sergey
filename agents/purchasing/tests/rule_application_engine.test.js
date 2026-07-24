const assert = require('node:assert/strict');
const test = require('node:test');

const {
  APPLICATION_STATUS,
  ENGINE_VERSION,
  applyApprovedRule,
} = require('../owner_learning/rule_application_engine');

function match({
  approvedDecision = 'SKIP',
  ruleId = 'rule-1',
  stableItemKey = 'sku:SKU-1',
  status,
} = {}) {
  const result = {
    ruleId,
    stableItemKey,
    approvedDecision,
  };
  if (status !== undefined) result.status = status;
  return result;
}

function apply(
  agentRecommendation,
  approvedDecision,
  agentQuantity = 3
) {
  return applyApprovedRule({
    agentRecommendation,
    agentQuantity,
    previewMatch: match({ approvedDecision }),
  });
}

function assertPreserved(result, recommendation, quantity) {
  assert.equal(result.agentRecommendation, recommendation);
  assert.equal(result.agentQuantity, quantity);
  assert.equal(result.finalRecommendation, recommendation);
  assert.equal(result.finalQuantity, quantity);
  assert.equal(result.ruleApplied, false);
  assert.equal(result.diagnostics.positiveQuantityCreated, false);
}

test('BUY -> BUY is unchanged and preserves quantity', () => {
  const result = apply('BUY', 'BUY', 7);

  assert.equal(result.applicationStatus, APPLICATION_STATUS.UNCHANGED);
  assertPreserved(result, 'BUY', 7);
});

test('BUY -> SKIP applies zero quantity', () => {
  const result = apply('BUY', 'SKIP', 7);

  assert.equal(result.applicationStatus, APPLICATION_STATUS.APPLIED);
  assert.equal(result.ruleApplied, true);
  assert.equal(result.finalRecommendation, 'SKIP');
  assert.equal(result.finalQuantity, 0);
});

test('BUY -> DEFER applies zero quantity', () => {
  const result = apply('BUY', 'DEFER', 7);

  assert.equal(result.applicationStatus, APPLICATION_STATUS.APPLIED);
  assert.equal(result.ruleApplied, true);
  assert.equal(result.finalRecommendation, 'DEFER');
  assert.equal(result.finalQuantity, 0);
});

test('SKIP -> BUY requires manual review without inventing quantity', () => {
  const result = apply('SKIP', 'BUY', 0);

  assert.equal(result.applicationStatus, APPLICATION_STATUS.MANUAL_REVIEW);
  assertPreserved(result, 'SKIP', 0);
});

test('DEFER -> BUY requires manual review without inventing quantity', () => {
  const result = apply('DEFER', 'BUY', 0);

  assert.equal(result.applicationStatus, APPLICATION_STATUS.MANUAL_REVIEW);
  assertPreserved(result, 'DEFER', 0);
});

test('SKIP -> SKIP is unchanged', () => {
  const result = apply('SKIP', 'SKIP', 0);

  assert.equal(result.applicationStatus, APPLICATION_STATUS.UNCHANGED);
  assertPreserved(result, 'SKIP', 0);
});

test('DEFER -> DEFER is unchanged', () => {
  const result = apply('DEFER', 'DEFER', 0);

  assert.equal(result.applicationStatus, APPLICATION_STATUS.UNCHANGED);
  assertPreserved(result, 'DEFER', 0);
});

test('SKIP -> DEFER applies zero quantity', () => {
  const result = apply('SKIP', 'DEFER', 0);

  assert.equal(result.applicationStatus, APPLICATION_STATUS.APPLIED);
  assert.equal(result.finalRecommendation, 'DEFER');
  assert.equal(result.finalQuantity, 0);
});

test('DEFER -> SKIP applies zero quantity', () => {
  const result = apply('DEFER', 'SKIP', 0);

  assert.equal(result.applicationStatus, APPLICATION_STATUS.APPLIED);
  assert.equal(result.finalRecommendation, 'SKIP');
  assert.equal(result.finalQuantity, 0);
});

test('missing rule leaves the normalized agent result unchanged', () => {
  const result = applyApprovedRule({
    agentRecommendation: 'must_buy',
    agentQuantity: 4,
    previewMatch: null,
  });

  assert.equal(result.applicationStatus, APPLICATION_STATUS.UNCHANGED);
  assert.equal(result.reason, 'NO_ACTIVE_RULE');
  assertPreserved(result, 'BUY', 4);
});

test('conflicting rules are blocked without changing the agent result', () => {
  const result = applyApprovedRule({
    agentRecommendation: 'BUY',
    agentQuantity: 5,
    previewMatch: {
      stableItemKey: 'sku:SKU-1',
      reason: 'CONFLICTING_ACTIVE_RULES',
      approvedDecisions: ['SKIP', 'BUY'],
      ruleIds: ['rule-2', 'rule-1'],
    },
  });

  assert.equal(
    result.applicationStatus,
    APPLICATION_STATUS.BLOCKED_CONFLICT
  );
  assertPreserved(result, 'BUY', 5);
  assert.deepEqual(
    result.diagnostics.conflictRuleIds,
    ['rule-1', 'rule-2']
  );
});

test('inactive rule is treated as no active rule', () => {
  const result = applyApprovedRule({
    agentRecommendation: 'BUY',
    agentQuantity: 2,
    previewMatch: match({
      approvedDecision: 'SKIP',
      status: 'DISABLED',
    }),
  });

  assert.equal(result.applicationStatus, APPLICATION_STATUS.UNCHANGED);
  assert.equal(result.reason, 'RULE_NOT_ACTIVE');
  assertPreserved(result, 'BUY', 2);
});

test('unknown agent recommendation blocks an active rule', () => {
  const result = apply('manual_review', 'SKIP', 2);

  assert.equal(
    result.applicationStatus,
    APPLICATION_STATUS.BLOCKED_UNKNOWN_RECOMMENDATION
  );
  assertPreserved(result, 'UNKNOWN', 2);
});

test('unknown rule recommendation is blocked', () => {
  const result = apply('BUY', 'HOLD', 2);

  assert.equal(
    result.applicationStatus,
    APPLICATION_STATUS.BLOCKED_INVALID_RULE
  );
  assert.equal(result.reason, 'INVALID_RULE_RECOMMENDATION');
  assertPreserved(result, 'BUY', 2);
});

test('missing ruleId is blocked', () => {
  const result = applyApprovedRule({
    agentRecommendation: 'BUY',
    agentQuantity: 2,
    previewMatch: match({ ruleId: null }),
  });

  assert.equal(
    result.applicationStatus,
    APPLICATION_STATUS.BLOCKED_INVALID_RULE
  );
  assert.equal(result.reason, 'MISSING_RULE_ID');
  assertPreserved(result, 'BUY', 2);
});

test('quantity zero remains a valid quantity', () => {
  const result = apply('BUY', 'BUY', 0);

  assert.equal(result.applicationStatus, APPLICATION_STATUS.UNCHANGED);
  assert.equal(result.diagnostics.quantityInputValid, true);
  assertPreserved(result, 'BUY', 0);
});

test('invalid quantities are blocked and represented only as null', () => {
  for (const agentQuantity of [-1, Number.NaN, Infinity, '3']) {
    const result = applyApprovedRule({
      agentRecommendation: 'BUY',
      agentQuantity,
      previewMatch: match(),
    });

    assert.equal(
      result.applicationStatus,
      APPLICATION_STATUS.BLOCKED_INVALID_QUANTITY
    );
    assert.equal(result.agentQuantity, null);
    assert.equal(result.finalQuantity, null);
    assert.equal(result.ruleApplied, false);
    assert.equal(result.diagnostics.quantityInputValid, false);
  }
});

test('null quantity is preserved without inventing a value', () => {
  const result = applyApprovedRule({
    agentRecommendation: 'SKIP',
    agentQuantity: null,
    previewMatch: null,
  });

  assert.equal(result.applicationStatus, APPLICATION_STATUS.UNCHANGED);
  assertPreserved(result, 'SKIP', null);
});

test('engine never mutates preview or caller-owned input', () => {
  const previewMatch = match({ approvedDecision: 'SKIP' });
  const input = {
    agentRecommendation: 'BUY',
    agentQuantity: 8,
    previewMatch,
  };
  const snapshot = structuredClone(input);

  applyApprovedRule(input);

  assert.deepEqual(input, snapshot);
  assert.deepEqual(previewMatch, snapshot.previewMatch);
});

test('identical input produces a deterministic result', () => {
  const input = {
    agentRecommendation: 'recommended',
    agentQuantity: 8,
    previewMatch: match({ approvedDecision: 'SKIP' }),
  };

  const first = applyApprovedRule(input);
  const second = applyApprovedRule(structuredClone(input));

  assert.deepEqual(first, second);
  assert.equal(first.diagnostics.engineVersion, ENGINE_VERSION);
});
