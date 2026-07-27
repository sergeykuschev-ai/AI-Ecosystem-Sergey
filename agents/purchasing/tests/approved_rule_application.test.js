const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeApprovedRuleMode,
  processApprovedRules,
} = require('../owner_learning/approved_rule_application');
const {
  buildApprovedRulePreview,
} = require('../owner_learning/approved_rule_preview');
const {
  applyApprovedRule,
} = require('../owner_learning/rule_application_engine');
const {
  recalculateFinancialSummary,
} = require('../owner_learning/financial_recalculation');

const GENERATED_AT = '2026-07-24T00:00:00.000Z';

function agentResult({
  decision = 'recommended',
  quantity = 5,
  price = 10,
  financialAmount = quantity * price,
} = {}) {
  const lineSum = quantity * price;
  return [{
    json: {
      product_rows_count: 1,
      decisions: [{
        rowIdentity: 'row-1',
        decision,
        approvedOrderQuantity: quantity,
      }],
      workingOrderProducts: [{
        rowIdentity: 'row-1',
        rowNumber: 2,
        article: 'SKU-1',
        name: 'Test product',
        brand: 'Test brand',
        priceNum: price,
        workflowStatus: decision === 'recommended'
          ? 'auto_approved'
          : decision === 'postpone'
            ? 'postponed'
            : 'confidently_excluded',
        phase2Decision: decision,
        approvedOrderQuantity: quantity,
        approvedLineSum: lineSum,
        provisionalOrderQuantity: null,
      }],
      autoApprovedLines: decision === 'recommended' ? 1 : 0,
      autoApprovedSum: decision === 'recommended' ? lineSum : 0,
      workingMaximumLines: decision === 'recommended' ? 1 : 0,
      workingMaximumSum: decision === 'recommended' ? lineSum : 0,
      financial_assessment: {
        currency: 'RUB',
        status: 'APPROVED_WITH_WARNING',
        proposed_order_amount: financialAmount,
        available_after_expenses: 200,
        available_after_order: 200 - financialAmount,
        minimum_reserve: 100,
        reserve_surplus: 100 - financialAmount,
        maximum_safe_order_amount: 100,
        missing_fields: [],
        financially_permitted: true,
        recommendation: 'Baseline recommendation.',
      },
    },
  }];
}

function rule(approvedDecision = 'SKIP', overrides = {}) {
  return {
    ruleId: 'rule-1',
    proposalId: 'proposal-1',
    stableItemKey: 'sku:SKU-1',
    name: 'Test product',
    brand: 'Test brand',
    ruleType: 'ITEM_DECISION',
    approvedDecision,
    status: 'ACTIVE',
    ...overrides,
  };
}

function registry(rules = []) {
  return {
    schemaVersion: 'owner-approved-rules-v0.4',
    rules,
  };
}

function process(input = {}, dependencies = {}) {
  return processApprovedRules({
    agentResult: input.agentResult || agentResult(),
    approvedRuleMode: input.approvedRuleMode,
    approvedRules: Object.hasOwn(input, 'approvedRules')
      ? input.approvedRules
      : registry(),
    generatedAt: GENERATED_AT,
    ...input,
  }, dependencies);
}

test('default mode is PREVIEW', () => {
  assert.deepEqual(normalizeApprovedRuleMode(), {
    requestedMode: null,
    mode: 'PREVIEW',
    warnings: [],
  });
  assert.equal(process().mode, 'PREVIEW');
});

test('unknown mode falls back to PREVIEW with a diagnostic warning', () => {
  const result = process({ approvedRuleMode: 'unsafe' });

  assert.equal(result.mode, 'PREVIEW');
  assert.equal(result.requestedMode, 'UNSAFE');
  assert.deepEqual(
    result.warnings.map(warning => warning.code),
    ['UNKNOWN_APPROVED_RULE_MODE']
  );
});

test('OFF calls no approved-rule dependency', () => {
  const source = agentResult();
  const unexpected = () => {
    throw new Error('must not be called');
  };
  const result = processApprovedRules({
    agentResult: source,
    approvedRuleMode: 'OFF',
    loadApprovedRules: unexpected,
  }, {
    buildPreview: unexpected,
    applyRule: unexpected,
    recalculate: unexpected,
  });

  assert.equal(result.mode, 'OFF');
  assert.equal(result.agentResult, source);
  assert.equal(result.approvedRulePreview, null);
  assert.equal(result.approvedRuleApplications, null);
});

test('PREVIEW calls Preview only and preserves the baseline result', () => {
  const source = agentResult();
  const snapshot = structuredClone(source);
  let previewCalls = 0;
  const unexpected = () => {
    throw new Error('must not be called');
  };
  const result = process({
    agentResult: source,
    approvedRuleMode: 'PREVIEW',
    approvedRules: registry([rule()]),
  }, {
    buildPreview(input) {
      previewCalls += 1;
      return buildApprovedRulePreview(input);
    },
    applyRule: unexpected,
    recalculate: unexpected,
  });

  assert.equal(previewCalls, 1);
  assert.equal(result.agentResult, source);
  assert.deepEqual(result.agentResult, snapshot);
  assert.equal(result.approvedRulePreview.matchedRulesCount, 1);
});

test('APPLY_SAFE with an empty registry preserves the complete baseline', () => {
  const source = agentResult({ financialAmount: 47 });
  const snapshot = structuredClone(source);
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: registry(),
  });

  assert.equal(result.approvedRuleApplications.applied, 0);
  assert.equal(result.agentResult, source);
  assert.deepEqual(result.agentResult, snapshot);
  assert.equal(
    result.agentResult[0].json.financial_assessment
      .proposed_order_amount,
    47
  );
});

test('APPLY_SAFE with an unmatched active rule preserves baseline', () => {
  const source = agentResult({ financialAmount: 47 });
  const snapshot = structuredClone(source);
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: registry([
      rule('SKIP', {
        stableItemKey: 'sku:OTHER',
        name: 'Other product',
      }),
    ]),
  });

  assert.equal(result.approvedRulePreview.activeRulesCount, 1);
  assert.equal(result.approvedRulePreview.matchedRulesCount, 0);
  assert.equal(result.approvedRuleApplications.applied, 0);
  assert.equal(result.agentResult, source);
  assert.deepEqual(result.agentResult, snapshot);
});

test('APPLY_SAFE with an unchanged match preserves baseline', () => {
  const source = agentResult({ financialAmount: 47 });
  const snapshot = structuredClone(source);
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: registry([rule('BUY')]),
  });

  assert.equal(result.approvedRuleApplications.applied, 0);
  assert.equal(result.approvedRuleApplications.unchanged, 1);
  assert.equal(result.agentResult, source);
  assert.deepEqual(result.agentResult, snapshot);
});

test('APPLY_SAFE BUY -> SKIP updates quantity and aggregates', () => {
  const source = agentResult({ financialAmount: 47 });
  const legacyFinancialAssessment = structuredClone(
    source[0].json.financial_assessment
  );
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: registry([rule('SKIP')]),
  });
  const agent = result.agentResult[0].json;
  const application = result.approvedRuleApplications;

  assert.equal(application.status, 'APPLIED');
  assert.equal(application.applied, 1);
  assert.equal(application.amountBefore, 50);
  assert.equal(application.amountAfter, 0);
  assert.equal(application.skuBefore, 1);
  assert.equal(application.skuAfter, 0);
  assert.equal(application.unitsBefore, 5);
  assert.equal(application.unitsAfter, 0);
  assert.equal(agent.workingOrderProducts[0].approvedOrderQuantity, 0);
  assert.equal(agent.decisions[0].approvedOrderQuantity, 0);
  assert.equal(agent.autoApprovedSum, 0);
  assert.deepEqual(
    agent.financial_assessment,
    legacyFinancialAssessment
  );
  assert.deepEqual(
    application.appliedWorkingOrderFinancialAssessment,
    {
      amountBefore: 50,
      amountAfter: 0,
      skuBefore: 1,
      skuAfter: 0,
      unitsBefore: 5,
      unitsAfter: 0,
      availableAfterOrder: 200,
      reserveSurplus: 100,
      maximumSafeOrderAmount: 100,
      financialStatus: 'APPROVED_WITH_WARNING',
      financiallyPermitted: true,
      recalculationStatus: 'COMPLETE',
    }
  );
});

test('APPLY_SAFE BUY -> DEFER safely zeroes the final quantity', () => {
  const source = agentResult({ financialAmount: 47 });
  const legacyFinancialAssessment = structuredClone(
    source[0].json.financial_assessment
  );
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: registry([rule('DEFER')]),
  });
  const application = result.approvedRuleApplications.applications[0];

  assert.equal(application.applicationStatus, 'APPLIED');
  assert.equal(application.finalRecommendation, 'DEFER');
  assert.equal(application.finalQuantity, 0);
  assert.equal(result.approvedRuleApplications.amountAfter, 0);
  assert.deepEqual(
    result.agentResult[0].json.financial_assessment,
    legacyFinancialAssessment
  );
  assert.equal(
    result.approvedRuleApplications
      .appliedWorkingOrderFinancialAssessment.amountAfter,
    0
  );
});

test('APPLY_SAFE SKIP -> BUY remains MANUAL_REVIEW with zero quantity', () => {
  const source = agentResult({
    decision: 'do_not_buy',
    quantity: 0,
  });
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: registry([rule('BUY')]),
  });
  const application = result.approvedRuleApplications.applications[0];

  assert.equal(application.applicationStatus, 'MANUAL_REVIEW');
  assert.equal(application.ruleApplied, false);
  assert.equal(application.finalRecommendation, 'SKIP');
  assert.equal(application.finalQuantity, 0);
  assert.equal(
    result.agentResult[0].json.workingOrderProducts[0]
      .approvedOrderQuantity,
    0
  );
});

test('conflicting rules leave the matching order line unchanged', () => {
  const source = agentResult();
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: registry([
      rule('SKIP'),
      rule('BUY', {
        ruleId: 'rule-2',
        proposalId: 'proposal-2',
      }),
    ]),
  });

  assert.equal(result.approvedRuleApplications.blockedConflicts, 1);
  assert.equal(result.approvedRuleApplications.applied, 0);
  assert.equal(
    result.agentResult[0].json.workingOrderProducts[0]
      .approvedOrderQuantity,
    5
  );
});

test('invalid active rule is counted and does not change the order', () => {
  const source = agentResult();
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: registry([rule('SKIP', { ruleId: null })]),
  });

  assert.equal(result.approvedRuleApplications.blockedInvalid, 1);
  assert.equal(result.approvedRuleApplications.applied, 0);
  assert.equal(
    result.agentResult[0].json.workingOrderProducts[0]
      .approvedOrderQuantity,
    5
  );
});

test('registry failure falls back to the unchanged baseline', () => {
  const source = agentResult();
  const result = processApprovedRules({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    generatedAt: GENERATED_AT,
    loadApprovedRules() {
      const error = new Error('damaged registry');
      error.code = 'RULE_REGISTRY_CORRUPTED';
      throw error;
    },
  });

  assert.equal(result.agentResult, source);
  assert.equal(result.approvedRulePreview.status, 'unavailable');
  assert.equal(
    result.approvedRuleApplications.status,
    'FALLBACK_TO_BASELINE'
  );
  assert.equal(
    result.approvedRuleApplications.errorCode,
    'RULE_REGISTRY_CORRUPTED'
  );
});

test('Preview failure falls back to the unchanged baseline', () => {
  const source = agentResult();
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
  }, {
    buildPreview() {
      throw new Error('preview failed');
    },
  });

  assert.equal(result.agentResult, source);
  assert.equal(result.approvedRulePreview.status, 'unavailable');
  assert.equal(
    result.approvedRuleApplications.status,
    'FALLBACK_TO_BASELINE'
  );
});

test('Rule Application failure publishes no partial changes', () => {
  const source = agentResult();
  const snapshot = structuredClone(source);
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: registry([rule()]),
  }, {
    applyRule() {
      throw new Error('application failed');
    },
  });

  assert.equal(result.agentResult, source);
  assert.deepEqual(result.agentResult, snapshot);
  assert.equal(
    result.approvedRuleApplications.status,
    'FALLBACK_TO_BASELINE'
  );
});

test('Financial Recalculation failure publishes no partial changes', () => {
  const source = agentResult();
  const snapshot = structuredClone(source);
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: registry([rule()]),
  }, {
    recalculate() {
      throw new Error('recalculation failed');
    },
  });

  assert.equal(result.agentResult, source);
  assert.deepEqual(result.agentResult, snapshot);
  assert.equal(
    result.approvedRuleApplications.status,
    'FALLBACK_TO_BASELINE'
  );
});

test('blocked or partial recalculation falls back to baseline', () => {
  const source = agentResult();
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: registry([rule()]),
  }, {
    recalculate() {
      return {
        recalculationStatus: 'BLOCKED_INVALID_ORDER',
        reason: 'INVALID_ORDER_LINE',
      };
    },
  });

  assert.equal(result.agentResult, source);
  assert.equal(
    result.approvedRuleApplications.errorCode,
    'INVALID_ORDER_LINE'
  );
});

test('APPLY_SAFE does not mutate agent result, registry, or Preview data', () => {
  const source = agentResult();
  const approvedRules = registry([rule()]);
  const sourceSnapshot = structuredClone(source);
  const registrySnapshot = structuredClone(approvedRules);
  let previewSnapshot;
  const result = process({
    agentResult: source,
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules,
  }, {
    applyRule(input) {
      previewSnapshot = structuredClone(input.previewMatch);
      const application = applyApprovedRule(input);
      assert.deepEqual(input.previewMatch, previewSnapshot);
      return application;
    },
    recalculate: recalculateFinancialSummary,
  });

  assert.notEqual(result.agentResult, source);
  assert.deepEqual(source, sourceSnapshot);
  assert.deepEqual(approvedRules, registrySnapshot);
  assert.deepEqual(
    result.approvedRulePreview.matches[0],
    previewSnapshot
  );
});

test('APPLY_SAFE is deterministic for identical inputs', () => {
  const input = {
    agentResult: agentResult(),
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: registry([rule()]),
    generatedAt: GENERATED_AT,
  };

  assert.deepEqual(
    processApprovedRules(input),
    processApprovedRules(input)
  );
});
