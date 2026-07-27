const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AUTOMATION_NOTICE,
  PROPOSAL_WARNING,
  buildOwnerRuleProposals,
  buildOwnerRuleProposalsMarkdown,
  buildProposalId,
  usuallyAgreesWithAgent,
} = require('../owner_learning/owner_rule_proposals');

function candidate(decision = 'SKIP', overrides = {}) {
  return {
    stableItemKey: 'sku:SKU-1',
    name: 'Тестовый товар',
    brand: 'Миска',
    totalOwnerDecisions: 4,
    buyCount: decision === 'BUY' ? 4 : 0,
    skipCount: decision === 'SKIP' ? 4 : 0,
    deferCount: decision === 'DEFER' ? 4 : 0,
    agreementCount: 1,
    overrideCount: 3,
    dominantOwnerDecision: decision,
    dominantDecisionRate: 100,
    consecutiveSameDecisionCount: 4,
    latestOwnerDecision: decision,
    ...overrides,
  };
}

function patterns(ruleCandidates = [], overrides = {}) {
  return {
    reportVersion: 'owner-learning-patterns-v0.2',
    generatedAt: '2026-07-24T00:00:00.000Z',
    repeatedDecisions: [],
    ruleCandidates,
    ...overrides,
  };
}

test('empty ruleCandidates creates an empty proposals report', () => {
  const result = buildOwnerRuleProposals(patterns());

  assert.equal(result.reportVersion, 'owner-rule-proposals-v0.3');
  assert.equal(result.sourcePatternsVersion, 'owner-learning-patterns-v0.2');
  assert.equal(result.candidatesCount, 0);
  assert.equal(result.proposalsCount, 0);
  assert.equal(result.skippedInvalidCandidates, 0);
  assert.deepEqual(result.proposals, []);
});

test('valid SKIP candidate creates a pending item decision proposal', () => {
  const result = buildOwnerRuleProposals(patterns([candidate()]));
  const proposal = result.proposals[0];

  assert.equal(result.proposalsCount, 1);
  assert.equal(proposal.proposedDecision, 'SKIP');
  assert.equal(proposal.ruleType, 'ITEM_DECISION');
  assert.equal(proposal.status, 'PENDING');
  assert.equal(proposal.evidence.totalOwnerDecisions, 4);
  assert.equal(proposal.evidence.usuallyAgreesWithAgent, false);
  assert.match(proposal.explanation, /выбрал SKIP 4 раза подряд/);
  assert.match(proposal.explanation, /переопределяло рекомендацию агента/);
  assert.equal(proposal.warning, PROPOSAL_WARNING);
});

test('BUY candidate is represented without invented business reasons', () => {
  const proposal = buildOwnerRuleProposals(
    patterns([candidate('BUY')])
  ).proposals[0];

  assert.equal(proposal.proposedDecision, 'BUY');
  assert.match(proposal.explanation, /Решение BUY составляет 100%/);
  for (const unsupportedFact of [
    'остат',
    'продаж',
    'запас',
    'цен',
    'марж',
  ]) {
    assert.equal(proposal.explanation.toLowerCase().includes(
      unsupportedFact
    ), false);
  }
});

test('DEFER candidate is supported', () => {
  const proposal = buildOwnerRuleProposals(
    patterns([candidate('DEFER')])
  ).proposals[0];

  assert.equal(proposal.proposedDecision, 'DEFER');
  assert.match(proposal.explanation, /выбрал DEFER/);
});

test('repeatedDecisions without ruleCandidates creates no proposal', () => {
  const result = buildOwnerRuleProposals(patterns([], {
    repeatedDecisions: [candidate('BUY')],
  }));

  assert.equal(result.candidatesCount, 0);
  assert.equal(result.proposalsCount, 0);
});

test('unknown decision is skipped and counted', () => {
  const result = buildOwnerRuleProposals(
    patterns([candidate('UNKNOWN')])
  );

  assert.equal(result.proposalsCount, 0);
  assert.equal(result.skippedInvalidCandidates, 1);
});

test('damaged candidate does not prevent another valid proposal', () => {
  const result = buildOwnerRuleProposals(patterns([
    { stableItemKey: 'sku:damaged' },
    candidate('SKIP'),
  ]));

  assert.equal(result.candidatesCount, 2);
  assert.equal(result.proposalsCount, 1);
  assert.equal(result.skippedInvalidCandidates, 1);
});

test('identical proposal input always creates the same proposalId', () => {
  const first = buildProposalId('sku:SKU-1', 'SKIP', 'ITEM_DECISION');
  const second = buildProposalId('sku:SKU-1', 'SKIP', 'ITEM_DECISION');
  const fromDifferentRun = buildOwnerRuleProposals(
    patterns([candidate()], {
      generatedAt: '2030-01-01T00:00:00.000Z',
    })
  ).proposals[0].proposalId;

  assert.equal(first, second);
  assert.equal(first, fromDifferentRun);
});

test('different decisions for one item create different proposalId', () => {
  assert.notEqual(
    buildProposalId('sku:SKU-1', 'BUY', 'ITEM_DECISION'),
    buildProposalId('sku:SKU-1', 'SKIP', 'ITEM_DECISION')
  );
});

test('usuallyAgreesWithAgent returns true only for a strict majority', () => {
  assert.equal(usuallyAgreesWithAgent(3, 1), true);
  assert.equal(usuallyAgreesWithAgent(1, 3), false);
  assert.equal(usuallyAgreesWithAgent(2, 2), null);
  assert.equal(usuallyAgreesWithAgent(0, 0), null);
});

test('evidence exposes true, false, and null agreement states', () => {
  const result = buildOwnerRuleProposals(patterns([
    candidate('BUY', {
      stableItemKey: 'sku:BUY',
      agreementCount: 3,
      overrideCount: 1,
    }),
    candidate('SKIP', {
      stableItemKey: 'sku:SKIP',
      agreementCount: 1,
      overrideCount: 3,
    }),
    candidate('DEFER', {
      stableItemKey: 'sku:DEFER',
      agreementCount: 0,
      overrideCount: 0,
    }),
  ]));
  const states = new Map(result.proposals.map(proposal => [
    proposal.proposedDecision,
    proposal.evidence.usuallyAgreesWithAgent,
  ]));

  assert.equal(states.get('BUY'), true);
  assert.equal(states.get('SKIP'), false);
  assert.equal(states.get('DEFER'), null);
});

test('builder does not mutate the patterns report', () => {
  const input = patterns([candidate()]);
  const before = structuredClone(input);

  buildOwnerRuleProposals(input);

  assert.deepEqual(input, before);
});

test('Markdown without proposals explains the evidence threshold', () => {
  const markdown = buildOwnerRuleProposalsMarkdown(
    buildOwnerRuleProposals(patterns())
  );

  assert.match(markdown, /^# Предложения правил владельца/m);
  assert.match(markdown, new RegExp(AUTOMATION_NOTICE));
  assert.match(markdown, /Пока нет предложений правил/);
  assert.match(markdown, /минимум три последовательных/);
});

test('Markdown renders a proposal as pending owner confirmation', () => {
  const markdown = buildOwnerRuleProposalsMarkdown(
    buildOwnerRuleProposals(patterns([candidate()]))
  );

  assert.match(markdown, /### Тестовый товар/);
  assert.match(markdown, /Предлагаемое решение: Не заказывать \(SKIP\)/);
  assert.match(markdown, /Статус: ожидает подтверждения/);
  assert.match(markdown, /ID предложения: owner-rule-/);
  assert.match(markdown, new RegExp(PROPOSAL_WARNING));
});
