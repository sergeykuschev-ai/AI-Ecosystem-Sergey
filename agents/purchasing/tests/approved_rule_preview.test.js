const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PREVIEW_WARNING,
  buildApprovedRulePreview,
  buildApprovedRulePreviewMarkdown,
} = require('../owner_learning/approved_rule_preview');

const GENERATED_AT = '2026-07-24T10:00:00.000Z';

function agentResult({
  sku = 'SKU-1',
  name = 'Тестовый товар',
  decision = 'do_not_buy',
  quantity = 0,
} = {}) {
  return [{
    json: {
      workingOrderProducts: [{
        rowIdentity: 'row-1',
        article: sku,
        barcode: '460000000001',
        name,
        approvedOrderQuantity: quantity,
      }],
      decisions: [{
        rowIdentity: 'row-1',
        decision,
        approvedOrderQuantity: quantity,
        calculatedOrderQuantity: quantity,
      }],
    },
  }];
}

function rule({
  ruleId = 'rule-1',
  proposalId = 'proposal-1',
  stableItemKey = 'sku:SKU-1',
  name = 'Тестовый товар',
  brand = 'Миска',
  ruleType = 'ITEM_DECISION',
  approvedDecision = 'SKIP',
  status = 'ACTIVE',
} = {}) {
  return {
    ruleId,
    proposalId,
    stableItemKey,
    name,
    brand,
    ruleType,
    approvedDecision,
    approvedAt: GENERATED_AT,
    status,
    createdFromVersion: 'owner-rule-proposals-v0.3',
    notes: null,
  };
}

function registry(rules = []) {
  return {
    schemaVersion: 'owner-approved-rules-v0.4',
    updatedAt: GENERATED_AT,
    rules,
  };
}

function preview(rules = [], agentOptions = {}) {
  return buildApprovedRulePreview({
    agentResult: agentResult(agentOptions),
    approvedRules: registry(rules),
    generatedAt: GENERATED_AT,
  });
}

test('empty registry creates an empty preview', () => {
  const result = preview();

  assert.equal(result.reportVersion, 'approved-rule-preview-v0.5');
  assert.equal(result.activeRulesCount, 0);
  assert.equal(result.matchedRulesCount, 0);
  assert.equal(result.wouldChangeDecisionCount, 0);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.unmatchedRules, []);
  assert.deepEqual(result.conflicts, []);
});

test('inactive rule is ignored', () => {
  const result = preview([rule({ status: 'DISABLED' })]);

  assert.equal(result.activeRulesCount, 0);
  assert.equal(result.ignoredInactiveRulesCount, 1);
  assert.equal(result.matchedRulesCount, 0);
});

test('SKIP matching SKIP produces NO_CHANGE', () => {
  const result = preview([rule()]);
  const match = result.matches[0];

  assert.equal(match.currentAgentDecision, 'SKIP');
  assert.equal(match.approvedDecision, 'SKIP');
  assert.equal(match.effect, 'NO_CHANGE');
  assert.equal(match.wouldChangeDecision, false);
  assert.equal(result.wouldKeepDecisionCount, 1);
});

test('SKIP against BUY produces OVERRIDE', () => {
  const result = preview([rule()], {
    decision: 'must_buy',
    quantity: 3,
  });

  assert.equal(result.matches[0].currentAgentDecision, 'BUY');
  assert.equal(result.matches[0].approvedDecision, 'SKIP');
  assert.equal(result.matches[0].effect, 'OVERRIDE');
  assert.equal(result.wouldChangeDecisionCount, 1);
});

test('BUY against SKIP produces OVERRIDE', () => {
  const result = preview([rule({ approvedDecision: 'BUY' })]);

  assert.equal(result.matches[0].currentAgentDecision, 'SKIP');
  assert.equal(result.matches[0].approvedDecision, 'BUY');
  assert.equal(result.matches[0].effect, 'OVERRIDE');
});

test('DEFER is supported', () => {
  const result = preview([rule({ approvedDecision: 'DEFER' })], {
    decision: 'postpone',
  });

  assert.equal(result.matches[0].currentAgentDecision, 'DEFER');
  assert.equal(result.matches[0].effect, 'NO_CHANGE');
});

test('unknown agent recommendation produces UNSUPPORTED', () => {
  const result = preview([rule()], { decision: 'manual_review' });

  assert.equal(result.matches[0].currentAgentDecision, 'UNKNOWN');
  assert.equal(result.matches[0].effect, 'UNSUPPORTED');
  assert.equal(result.matches[0].wouldChangeDecision, false);
  assert.equal(result.wouldKeepDecisionCount, 0);
});

test('unknown approvedDecision is ignored', () => {
  const result = preview([rule({ approvedDecision: 'HOLD' })]);

  assert.equal(result.activeRulesCount, 1);
  assert.equal(result.ignoredInvalidRulesCount, 1);
  assert.equal(result.matchedRulesCount, 0);
});

test('unknown ruleType is ignored', () => {
  const result = preview([rule({ ruleType: 'CATEGORY_DECISION' })]);

  assert.equal(result.activeRulesCount, 1);
  assert.equal(result.ignoredInvalidRulesCount, 1);
  assert.equal(result.matchedRulesCount, 0);
});

test('rule without a current item is listed as unmatched', () => {
  const sourceRule = rule({
    stableItemKey: 'sku:SKU-2',
    name: 'Другой товар',
  });
  const result = preview([sourceRule]);

  assert.equal(result.unmatchedRulesCount, 1);
  assert.equal(
    result.unmatchedRules[0].reason,
    'ITEM_NOT_FOUND_IN_CURRENT_RUN'
  );
  assert.equal(result.unmatchedRules[0].ruleId, sourceRule.ruleId);
});

test('exact stableItemKey is matched', () => {
  const result = preview([rule({ stableItemKey: 'sku:SKU-1' })]);

  assert.equal(result.matchedRulesCount, 1);
  assert.equal(result.matches[0].stableItemKey, 'sku:SKU-1');
});

test('equal name with a different SKU is not matched', () => {
  const result = preview([rule({
    stableItemKey: 'sku:SKU-2',
    name: 'Тестовый товар',
  })]);

  assert.equal(result.matchedRulesCount, 0);
  assert.equal(result.unmatchedRulesCount, 1);
});

test('conflicting active rules are isolated without choosing one', () => {
  const result = preview([
    rule({ ruleId: 'rule-buy', approvedDecision: 'BUY' }),
    rule({
      ruleId: 'rule-skip',
      proposalId: 'proposal-2',
      approvedDecision: 'SKIP',
    }),
  ]);

  assert.equal(result.conflictingRulesCount, 1);
  assert.equal(result.matchedRulesCount, 0);
  assert.deepEqual(
    result.conflicts[0].approvedDecisions,
    ['BUY', 'SKIP']
  );
  assert.deepEqual(
    result.conflicts[0].ruleIds,
    ['rule-buy', 'rule-skip']
  );
});

test('identical duplicate rules count as one logical match', () => {
  const result = preview([
    rule({ ruleId: 'rule-1' }),
    rule({ ruleId: 'rule-2', proposalId: 'proposal-2' }),
  ]);

  assert.equal(result.activeRulesCount, 2);
  assert.equal(result.matchedRulesCount, 1);
  assert.equal(result.wouldKeepDecisionCount, 1);
  assert.deepEqual(result.matches[0].duplicateRuleIds, ['rule-2']);
});

test('input objects are never mutated', () => {
  const sourceAgentResult = agentResult();
  const sourceRegistry = registry([rule()]);
  const agentSnapshot = structuredClone(sourceAgentResult);
  const registrySnapshot = structuredClone(sourceRegistry);

  buildApprovedRulePreview({
    agentResult: sourceAgentResult,
    approvedRules: sourceRegistry,
    generatedAt: GENERATED_AT,
  });

  assert.deepEqual(sourceAgentResult, agentSnapshot);
  assert.deepEqual(sourceRegistry, registrySnapshot);
});

test('previewQuantity is always null', () => {
  for (const result of [
    preview([rule()], { quantity: 0 }),
    preview([rule()], { decision: 'recommended', quantity: 5 }),
    preview([rule()], { decision: 'manual_review', quantity: 2 }),
  ]) {
    assert.equal(result.matches[0].previewQuantity, null);
  }
});

test('Markdown with empty registry contains the warning and empty state', () => {
  const markdown = buildApprovedRulePreviewMarkdown(preview());

  assert.match(
    markdown,
    /^# Предварительный просмотр утверждённых правил/m
  );
  assert.ok(markdown.includes(PREVIEW_WARNING));
  assert.match(
    markdown,
    /Пока нет активных утверждённых правил для предварительного просмотра/
  );
});

test('Markdown describes an OVERRIDE', () => {
  const markdown = buildApprovedRulePreviewMarkdown(preview([rule()], {
    decision: 'recommended',
    quantity: 4,
  }));

  assert.match(markdown, /## Правила, которые изменили бы решение/);
  assert.match(markdown, /Текущее решение агента: Заказать \(BUY\)/);
  assert.match(
    markdown,
    /Утверждённое решение владельца: Не заказывать \(SKIP\)/
  );
});

test('Markdown describes a conflict', () => {
  const markdown = buildApprovedRulePreviewMarkdown(preview([
    rule({ ruleId: 'rule-buy', approvedDecision: 'BUY' }),
    rule({
      ruleId: 'rule-skip',
      proposalId: 'proposal-2',
      approvedDecision: 'SKIP',
    }),
  ]));

  assert.match(markdown, /## Конфликты/);
  assert.match(markdown, /Решения: BUY, SKIP/);
  assert.match(markdown, /CONFLICTING_ACTIVE_RULES/);
});
