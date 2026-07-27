const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  materializeRuleFromCandidate,
} = require('../owner_learning/owner_rule_materializer');
const {
  buildApprovedRulePreview,
} = require('../owner_learning/approved_rule_preview');
const {
  processApprovedRules,
} = require('../owner_learning/approved_rule_application');
const {
  emptyApprovedRulesRegistry,
  loadApprovedRules,
  saveApprovedRules,
} = require('../owner_learning/owner_rule_registry');

const directories = [];
const NOW = '2026-07-25T04:00:00.000Z';
afterEach(() => {
  while (directories.length) {
    fs.rmSync(directories.pop(), { recursive: true, force: true });
  }
});

function disabledRule() {
  return materializeRuleFromCandidate({
    candidate: {
      candidateId: 'candidate-a',
      patternType: 'SAME_ITEM_SAME_DECISION',
      proposedRuleType: 'ITEM_DECISION_OVERRIDE',
      scopeType: 'ITEM',
      scopeKey: 'sku:SKU-1',
      displayScope: { primary: 'Test product', secondary: 'SKU SKU-1' },
      proposedAction: {
        decision: 'SKIP',
        quantityStrategy: 'NO_QUANTITY_CHANGE',
        quantityValue: null,
      },
      confidence: { score: 91, level: 'VERY_HIGH' },
      ranking: { priorityScore: 88, priorityLevel: 'HIGH' },
      eligibility: { status: 'ELIGIBLE' },
    },
    lifecycleState: {
      candidateId: 'candidate-a',
      status: 'APPROVED',
      lastEvent: {
        eventId: 'lifecycle-a',
        toStatus: 'APPROVED',
      },
    },
    options: { materializedAt: NOW },
  }).ruleDraft;
}

function activeRule() {
  return {
    ruleId: 'active-rule',
    proposalId: 'active-proposal',
    stableItemKey: 'sku:SKU-1',
    name: 'Test product',
    brand: null,
    ruleType: 'ITEM_DECISION',
    approvedDecision: 'SKIP',
    approvedAt: NOW,
    status: 'ACTIVE',
    createdFromVersion: 'owner-rule-proposals-v0.3',
    notes: null,
  };
}

function agentResult() {
  return [{
    json: {
      decisions: [{
        rowIdentity: 'row-1',
        decision: 'recommended',
        approvedOrderQuantity: 5,
      }],
      workingOrderProducts: [{
        rowIdentity: 'row-1',
        article: 'SKU-1',
        name: 'Test product',
        priceNum: 10,
        workflowStatus: 'auto_approved',
        phase2Decision: 'recommended',
        approvedOrderQuantity: 5,
        approvedLineSum: 50,
        provisionalOrderQuantity: null,
      }],
      autoApprovedLines: 1,
      autoApprovedSum: 50,
      workingMaximumLines: 1,
      workingMaximumSum: 50,
      financial_assessment: {
        currency: 'RUB',
        status: 'APPROVED_WITH_WARNING',
        proposed_order_amount: 50,
        available_after_expenses: 200,
        available_after_order: 150,
        minimum_reserve: 100,
        reserve_surplus: 50,
        missing_fields: [],
        financially_permitted: true,
      },
    },
  }];
}

test('legacy registry and disabled materialized rule share v0.4 safely', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'materialized-registry-')
  );
  directories.push(directory);
  const options = {
    registryPath: path.join(directory, 'rules.json'),
    markdownPath: path.join(directory, 'rules.md'),
    logger: { error() {} },
  };
  saveApprovedRules({
    ...emptyApprovedRulesRegistry(),
    updatedAt: NOW,
    rules: [activeRule(), disabledRule()],
  }, options);
  const loaded = loadApprovedRules(options);
  assert.equal(loaded.rules[0].status, 'ACTIVE');
  assert.equal(loaded.rules[1].status, 'DISABLED');
  assert.equal(
    loaded.rules[1].provenance.candidateId,
    'candidate-a'
  );
});

test('preview ignores the newly materialized disabled rule', () => {
  const preview = buildApprovedRulePreview({
    agentResult: agentResult(),
    approvedRules: {
      schemaVersion: 'owner-approved-rules-v0.4',
      rules: [disabledRule()],
    },
    generatedAt: NOW,
  });
  assert.equal(preview.activeRulesCount, 0);
  assert.equal(preview.ignoredInactiveRulesCount, 1);
  assert.equal(preview.matchedRulesCount, 0);
});

test('APPLY_SAFE preserves order, working products and finance', () => {
  const source = agentResult();
  const before = structuredClone(source);
  const result = processApprovedRules({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: {
      schemaVersion: 'owner-approved-rules-v0.4',
      rules: [disabledRule()],
    },
    generatedAt: NOW,
  });
  assert.equal(result.approvedRuleApplications.activeRules, 0);
  assert.deepEqual(result.agentResult, before);
  assert.deepEqual(
    result.agentResult[0].json.workingOrderProducts,
    before[0].json.workingOrderProducts
  );
  assert.deepEqual(
    result.agentResult[0].json.financial_assessment,
    before[0].json.financial_assessment
  );
});

test('existing ACTIVE rule still applies beside disabled rule', () => {
  const result = processApprovedRules({
    agentResult: agentResult(),
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: {
      schemaVersion: 'owner-approved-rules-v0.4',
      rules: [disabledRule(), activeRule()],
    },
    generatedAt: NOW,
  });
  assert.equal(result.approvedRulePreview.activeRulesCount, 1);
  assert.equal(result.approvedRulePreview.ignoredInactiveRulesCount, 1);
  assert.equal(result.approvedRuleApplications.applied, 1);
  assert.equal(
    result.agentResult[0].json.workingOrderProducts[0]
      .approvedOrderQuantity,
    0
  );
});
