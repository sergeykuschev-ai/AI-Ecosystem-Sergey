'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  strictItemProposalForAutoApproval,
} = require('../storage/file_run_registry');

function proposal(overrides = {}) {
  return {
    proposalId: 'owner-rule-test',
    stableItemKey: 'sku:TEST-1',
    name: 'Test',
    brand: null,
    proposedDecision: 'SKIP',
    ruleType: 'ITEM_DECISION',
    status: 'PENDING',
    evidence: {
      totalOwnerDecisions: 4,
      dominantDecisionRate: 100,
      consecutiveSameDecisionCount: 4,
      agreementCount: 4,
      overrideCount: 0,
      usuallyAgreesWithAgent: true,
    },
    ...overrides,
  };
}

test('strict auto approval accepts only repeated item-level decisions', () => {
  assert.equal(strictItemProposalForAutoApproval(proposal()), true);
  assert.equal(strictItemProposalForAutoApproval(proposal({ proposedDecision: 'BUY' })), true);
  assert.equal(strictItemProposalForAutoApproval(proposal({ proposedDecision: 'DEFER' })), true);
});

test('strict auto approval rejects insufficient or contradictory history', () => {
  for (const evidence of [
    { totalOwnerDecisions: 3 },
    { dominantDecisionRate: 99 },
    { consecutiveSameDecisionCount: 3 },
    { overrideCount: 1 },
    { usuallyAgreesWithAgent: false },
  ]) {
    assert.equal(strictItemProposalForAutoApproval(proposal({
      evidence: { ...proposal().evidence, ...evidence },
    })), false);
  }
});

test('strict auto approval rejects broad, non-SKU and non-pending rules', () => {
  assert.equal(strictItemProposalForAutoApproval(proposal({
    ruleType: 'BRAND_DECISION_GUIDANCE',
  })), false);
  assert.equal(strictItemProposalForAutoApproval(proposal({
    stableItemKey: 'name:test',
  })), false);
  assert.equal(strictItemProposalForAutoApproval(proposal({ status: 'APPROVED' })), false);
});
