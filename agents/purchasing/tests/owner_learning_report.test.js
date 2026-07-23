const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildOwnerLearningMarkdown,
  buildOwnerLearningReport,
  normalizeAgentRecommendation,
} = require('../owner_learning/owner_learning_report');

function report({
  reviewRequired = false,
  recommendation = null,
  ownerDecision = null,
} = {}) {
  return buildOwnerLearningReport({
    generatedAt: '2026-07-23T12:00:00.000Z',
    items: [{
      itemId: 'row-1',
      owner_review_required: reviewRequired,
    }],
    recommendations: recommendation === null
      ? []
      : [{ itemId: 'row-1', status: recommendation }],
    ownerDecisions: ownerDecision === null
      ? []
      : [{ itemId: 'row-1', decision: ownerDecision }],
  });
}

test('agent recommendation normalization uses only explicit mappings', () => {
  assert.equal(normalizeAgentRecommendation('must_buy'), 'BUY');
  assert.equal(normalizeAgentRecommendation('recommended'), 'BUY');
  assert.equal(normalizeAgentRecommendation('do_not_buy'), 'SKIP');
  assert.equal(normalizeAgentRecommendation('postpone'), 'DEFER');
  assert.equal(normalizeAgentRecommendation('manual_review'), null);
  assert.equal(normalizeAgentRecommendation('unknown'), null);
});

test('all automatically handled items need no owner decision', () => {
  const result = buildOwnerLearningReport({
    items: [
      { itemId: 'row-1', owner_review_required: false },
      { itemId: 'row-2', owner_review_required: false },
    ],
    recommendations: [
      { itemId: 'row-1', status: 'must_buy' },
      { itemId: 'row-2', status: 'do_not_buy' },
    ],
    ownerDecisions: [],
  });
  assert.equal(result.totalItems, 2);
  assert.equal(result.automaticItems, 2);
  assert.equal(result.reviewRequiredItems, 0);
  assert.equal(result.unresolvedCount, 0);
  assert.equal(result.agreementRate, null);
});

test('BUY matches an explicit BUY recommendation', () => {
  const result = report({
    recommendation: 'recommended',
    ownerDecision: 'BUY',
  });
  assert.equal(result.buyCount, 1);
  assert.equal(result.matchesAgentRecommendation, 1);
  assert.equal(result.overridesAgentRecommendation, 0);
  assert.equal(result.agreementRate, 100);
});

test('SKIP overrides an explicit BUY recommendation', () => {
  const result = report({
    recommendation: 'must_buy',
    ownerDecision: 'SKIP',
  });
  assert.equal(result.skipCount, 1);
  assert.equal(result.matchesAgentRecommendation, 0);
  assert.equal(result.overridesAgentRecommendation, 1);
  assert.equal(result.agreementRate, 0);
});

test('DEFER is counted and compared only to an explicit recommendation', () => {
  const result = report({
    reviewRequired: true,
    recommendation: 'postpone',
    ownerDecision: 'DEFER',
  });
  assert.equal(result.deferCount, 1);
  assert.equal(result.ownerDecisionsTotal, 1);
  assert.equal(result.unresolvedCount, 0);
  assert.equal(result.matchesAgentRecommendation, 1);
});

test('review-required item without a decision remains unresolved', () => {
  const result = report({
    reviewRequired: true,
    recommendation: 'manual_review',
  });
  assert.equal(result.reviewRequiredItems, 1);
  assert.equal(result.ownerDecisionsTotal, 0);
  assert.equal(result.unresolvedCount, 1);
});

test('missing agent recommendation is not treated as agreement', () => {
  const result = report({ ownerDecision: 'BUY' });
  assert.equal(result.ownerDecisionsTotal, 1);
  assert.equal(result.matchesAgentRecommendation, 0);
  assert.equal(result.overridesAgentRecommendation, 0);
  assert.equal(result.agreementRate, null);
  assert.match(
    buildOwnerLearningMarkdown(result),
    /Недостаточно данных для расчёта/
  );
});

test('empty input creates a valid zero report', () => {
  const result = buildOwnerLearningReport({
    items: [],
    recommendations: [],
    ownerDecisions: [],
  });
  assert.equal(result.totalItems, 0);
  assert.equal(result.automaticItems, 0);
  assert.equal(result.reviewRequiredItems, 0);
  assert.equal(result.agreementRate, null);
});

test('unknown status never creates a false match', () => {
  const result = report({
    recommendation: 'UNKNOWN_STATUS',
    ownerDecision: 'BUY',
  });
  assert.equal(result.matchesAgentRecommendation, 0);
  assert.equal(result.overridesAgentRecommendation, 0);
  assert.equal(result.agreementRate, null);
});
