const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  processApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/approved_rule_application'
);
const {
  loadRuleEffectivenessEvents,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_effectiveness'
);
const {
  recordRuleEffectivenessForRun,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_effectiveness_recorder'
);
const {
  OwnerMaterializedRulesService,
} = require('../application/owner_materialized_rules_service');
const {
  OwnerRuleEffectivenessService,
} = require('../application/owner_rule_effectiveness_service');
const {
  mapList,
} = require('../dto/owner_rule_effectiveness_mapper');
const {
  renderRuleEffectivenessRows,
  renderRuleEffectivenessSummary,
} = require('../public/app');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const PRODUCTION_FILES = [
  'owner-approved-rules.json',
  'owner-learning-rule-effectiveness-events.json',
  'owner-learning-rule-status-events.json',
  'owner-learning-rule-activation-previews.json',
  'owner-learning-rule-materializations.json',
  'owner-learning-candidate-lifecycle.json',
  'owner-decision-history.json',
].map(name => path.join(
  REPOSITORY_ROOT,
  'data/purchasing',
  name
));

function sha256(filePath) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function rule(index, status = 'ACTIVE') {
  const sku = `SKU-${index}`;
  const candidateId = String(index).repeat(64);
  const timestamp = '2026-01-01T00:00:00.000Z';
  return {
    ruleId: `materialized-rule-${index}`,
    proposalId: `materialization-${index}`,
    stableItemKey: `sku:${sku}`,
    name: `Товар ${index}`,
    brand: 'Test',
    ruleType: 'ITEM_DECISION_OVERRIDE',
    approvedDecision: 'SKIP',
    approvedAt: timestamp,
    status,
    createdFromVersion: 'owner-rule-materialization-v0.9.0',
    notes: null,
    scopeType: 'ITEM',
    scopeKey: `sku:${sku}`,
    action: {
      decision: 'SKIP',
      quantityStrategy: 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    source: 'OWNER_LEARNING_CANDIDATE',
    createdAt: timestamp,
    updatedAt: timestamp,
    provenance: {
      source: 'OWNER_LEARNING_CANDIDATE',
      candidateId,
      lifecycleEventId: `lifecycle-${index}`,
      patternType: 'SAME_ITEM_SAME_DECISION',
      confidenceScore: 90 - index,
      confidenceLevel: 'VERY_HIGH',
      priorityScore: 80 - index,
      priorityLevel: 'CRITICAL',
      eligibilityStatus: 'ELIGIBLE',
      materializedAt: timestamp,
      materializationVersion: 'owner-rule-materialization-v0.9.0',
    },
  };
}

function agentResult(sku, decision = 'recommended') {
  const quantity = decision === 'recommended' ? 5 : 0;
  const price = 10;
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
        article: sku,
        name: `Товар ${sku}`,
        brand: 'Test',
        priceNum: price,
        workflowStatus: decision === 'recommended'
          ? 'auto_approved'
          : 'confidently_excluded',
        phase2Decision: decision,
        approvedOrderQuantity: quantity,
        approvedLineSum: quantity * price,
        provisionalOrderQuantity: null,
      }],
      autoApprovedLines: quantity > 0 ? 1 : 0,
      autoApprovedSum: quantity * price,
      workingMaximumLines: quantity > 0 ? 1 : 0,
      workingMaximumSum: quantity * price,
      financial_assessment: {
        currency: 'RUB',
        status: 'APPROVED',
        proposed_order_amount: quantity * price,
        available_after_expenses: 1000,
        available_after_order: 1000 - quantity * price,
        minimum_reserve: 100,
        reserve_surplus: 900 - quantity * price,
        maximum_safe_order_amount: 900,
        missing_fields: [],
        financially_permitted: true,
        recommendation: 'Baseline.',
      },
    },
  }];
}

function fakeElement() {
  return {
    children: [],
    className: '',
    textContent: '',
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = [...children];
    },
    addEventListener() {},
    set innerHTML(value) {
      throw new Error(`Unsafe innerHTML: ${value}`);
    },
  };
}

function fakeDocument() {
  return {
    createElement() {
      return fakeElement();
    },
  };
}

test('practical eight-run effectiveness scenario is read-only and fail-soft', () => {
  const productionBefore = Object.fromEntries(
    PRODUCTION_FILES.map(filePath => [filePath, sha256(filePath)])
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rule-effectiveness-practical-')
  );
  const effectivenessPath = path.join(directory, 'effectiveness.json');
  const registryPath = path.join(directory, 'approved-rules.json');
  const materializationsPath = path.join(
    directory,
    'materializations.json'
  );
  const lifecyclePath = path.join(directory, 'lifecycle.json');
  const resultArtifactPath = path.join(directory, 'result.json');
  const rules = [rule(1), rule(2), rule(3, 'DISABLED')];
  const registry = {
    schemaVersion: 'owner-approved-rules-v0.4',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rules,
  };
  try {
    fs.writeFileSync(
      registryPath,
      `${JSON.stringify(registry, null, 2)}\n`
    );
    fs.writeFileSync(materializationsPath, JSON.stringify({
      schemaVersion: 'owner-learning-rule-materializations-v0.9.0',
      updatedAt: null,
      events: [],
    }));
    fs.writeFileSync(lifecyclePath, JSON.stringify({
      schemaVersion: 'owner-learning-candidate-lifecycle-v0.8.5',
      updatedAt: null,
      events: [],
    }));
    fs.writeFileSync(resultArtifactPath, '{"baseline":true}\n');
    const resultArtifactBefore = sha256(resultArtifactPath);

    const scenarios = [
      ['SKU-1', 'recommended'],
      ['SKU-1', 'recommended'],
      ['SKU-1', 'recommended'],
      ['SKU-2', 'confidently_excluded'],
      ['SKU-2', 'confidently_excluded'],
      ['SKU-X', 'recommended'],
      ['SKU-X', 'recommended'],
      ['SKU-X', 'recommended'],
    ];
    let retryInput = null;
    for (const [index, [sku, decision]] of scenarios.entries()) {
      const generatedAt =
        `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`;
      const baseline = agentResult(sku, decision);
      const application = processApprovedRules({
        agentResult: baseline,
        approvedRuleMode: 'APPLY_SAFE',
        approvedRules: registry,
        generatedAt,
      }, index === 7 ? {
        recalculate() {
          return {
            recalculationStatus: 'PARTIAL',
            reason: 'PRACTICAL_FALLBACK',
          };
        },
      } : {});
      const recorderInput = {
        effectivenessFilePath: effectivenessPath,
        runContext: {
          runId: `practical-run-${index + 1}`,
          recordedAt: generatedAt,
          supplier: 'Валта',
          applicationMode: 'APPLY_SAFE',
        },
        registry,
        applicationResult: application.approvedRuleApplications,
        financialContext: {
          workingOrderProducts:
            application.agentResult[0].json.workingOrderProducts,
        },
        logger: { warn() {} },
      };
      const recorded = recordRuleEffectivenessForRun(recorderInput);
      assert.equal(recorded.status, 'RECORDED');
      assert.equal(recorded.recorded, 2);
      if (index === 0) retryInput = recorderInput;
    }

    const duplicate = recordRuleEffectivenessForRun(retryInput);
    assert.equal(duplicate.recorded, 0);
    assert.equal(duplicate.duplicates, 2);

    const journal = loadRuleEffectivenessEvents({
      filePath: effectivenessPath,
    });
    assert.equal(journal.events.length, 16);
    assert.equal(
      journal.events.filter(
        event => event.effectStatus === 'APPLIED_EFFECT'
      ).length,
      3
    );
    assert.equal(
      journal.events.filter(
        event => event.effectStatus === 'MATCHED_NO_CHANGE'
      ).length,
      2
    );
    assert.equal(
      journal.events.filter(
        event => event.effectStatus === 'FALLBACK_TO_BASELINE'
      ).length,
      2
    );
    assert.equal(
      journal.events.some(
        event => event.ruleId === 'materialized-rule-3'
      ),
      false
    );

    const analytics = new OwnerRuleEffectivenessService({
      effectivenessFilePath: effectivenessPath,
      approvedRulesFilePath: registryPath,
      now: () => new Date('2026-01-10T00:00:00.000Z'),
      logger: { warn() {} },
    }).listRuleEffectiveness();
    const first = analytics.rules.find(
      value => value.ruleId === 'materialized-rule-1'
    );
    const second = analytics.rules.find(
      value => value.ruleId === 'materialized-rule-2'
    );
    const disabled = analytics.rules.find(
      value => value.ruleId === 'materialized-rule-3'
    );
    assert.equal(first.effectiveness.effects.appliedEffectRuns, 3);
    assert.equal(first.effectiveness.impact.totalQuantityDelta, -15);
    assert.equal(first.effectiveness.impact.totalOrderAmountDelta, -150);
    assert.equal(
      first.effectiveness.activity.lastAppliedAt,
      '2026-01-03T00:00:00.000Z'
    );
    assert.equal(
      first.effectiveness.activity.consecutiveNoEffectRuns,
      5
    );
    assert.equal(second.effectiveness.effects.matchedNoChangeRuns, 2);
    assert.equal(disabled.effectiveness.population.totalEvents, 0);
    assert.equal(first.effectiveness.classification, 'REVIEW_RECOMMENDED');

    const overlay = new OwnerMaterializedRulesService({
      approvedRulesFilePath: registryPath,
      materializationsFilePath: materializationsPath,
      candidateLifecycleFilePath: lifecyclePath,
      effectivenessFilePath: effectivenessPath,
      candidatesService: {
        getCandidates() {
          return { status: 'AVAILABLE', candidates: [] };
        },
      },
      logger: { warn() {} },
      now: () => '2026-01-10T00:00:00.000Z',
    }).listRules();
    assert.equal(overlay.status, 'AVAILABLE');
    assert.equal(
      overlay.rules.find(
        value => value.ruleId === 'materialized-rule-1'
      ).effectiveness.status,
      'AVAILABLE'
    );
    assert.equal(
      overlay.rules.find(
        value => value.ruleId === 'materialized-rule-3'
      ).effectiveness.status,
      'NO_DATA'
    );

    const mapped = mapList(analytics);
    const summaryElements = {
      ruleEffectivenessSummary: Object.fromEntries(
        ['total', 'applied', 'noEffect', 'stale', 'review', 'amountDelta']
          .map(name => [name, fakeElement()])
      ),
    };
    renderRuleEffectivenessSummary(
      summaryElements,
      mapped.summary
    );
    const body = fakeElement();
    renderRuleEffectivenessRows(
      fakeDocument(),
      body,
      mapped.rules
    );
    assert.equal(body.children.length, 3);
    assert.equal(
      summaryElements.ruleEffectivenessSummary.total.textContent,
      '3'
    );

    const corruptedPath = path.join(directory, 'corrupted.json');
    fs.writeFileSync(corruptedPath, '{');
    let warnings = 0;
    const unavailable = recordRuleEffectivenessForRun({
      ...retryInput,
      effectivenessFilePath: corruptedPath,
      runContext: {
        ...retryInput.runContext,
        runId: 'corrupted-journal-run',
      },
      logger: { warn() { warnings += 1; } },
    });
    assert.equal(unavailable.status, 'UNAVAILABLE');
    assert.equal(warnings, 1);
    assert.equal(sha256(resultArtifactPath), resultArtifactBefore);

    const productionAfter = Object.fromEntries(
      PRODUCTION_FILES.map(filePath => [filePath, sha256(filePath)])
    );
    assert.deepEqual(productionAfter, productionBefore);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
