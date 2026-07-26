const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  materializeRuleFromCandidate,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_materializer'
);
const {
  emptyApprovedRulesRegistry,
  loadApprovedRules,
  saveApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_registry'
);
const {
  loadRuleStatusEvents,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_status_manager'
);
const {
  processApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/approved_rule_application'
);
const {
  OwnerMaterializedRulesService,
  STATUS_HISTORY_WARNING,
} = require('../application/owner_materialized_rules_service');
const {
  OwnerRuleActivationPreviewService,
} = require('../application/owner_rule_activation_preview_service');
const {
  OwnerRuleStatusService,
} = require('../application/owner_rule_status_service');

const directories = [];
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = '2026-07-26T04:00:00.000Z';
const PREVIEW_AT = '2026-07-26T04:01:00.000Z';
const CHANGE_AT = '2026-07-26T04:02:00.000Z';

afterEach(() => {
  while (directories.length) {
    fs.rmSync(directories.pop(), { recursive: true, force: true });
  }
});

function materializedRule(status = 'DISABLED', decision = 'SKIP') {
  const candidateId = 'candidate-safe-rule';
  const result = materializeRuleFromCandidate({
    candidate: {
      candidateId,
      patternType: 'SAME_ITEM_SAME_DECISION',
      proposedRuleType: 'ITEM_DECISION_OVERRIDE',
      scopeType: 'ITEM',
      scopeKey: 'sku:SKU-1',
      displayScope: {
        primary: 'Тестовый товар',
        secondary: 'SKU SKU-1',
      },
      proposedAction: {
        decision,
        quantityStrategy: decision === 'BUY'
          ? 'KEEP_AGENT_QUANTITY'
          : 'NO_QUANTITY_CHANGE',
        quantityValue: null,
      },
      confidence: { score: 91, level: 'VERY_HIGH' },
      ranking: { priorityScore: 88, priorityLevel: 'HIGH' },
      eligibility: { status: 'ELIGIBLE' },
    },
    lifecycleState: {
      candidateId,
      status: 'APPROVED',
      lastEvent: {
        eventId: 'lifecycle-safe-rule',
        toStatus: 'APPROVED',
      },
    },
    options: { materializedAt: CREATED_AT },
  });
  return { ...result.ruleDraft, status };
}

function agentResult({
  quantity = 5,
  available = 200,
  reserve = 100,
} = {}) {
  return [{
    json: {
      decisions: [{
        rowIdentity: 'row-1',
        decision: 'recommended',
        approvedOrderQuantity: quantity,
      }],
      workingOrderProducts: [{
        rowIdentity: 'row-1',
        article: 'SKU-1',
        name: '<img src=x onerror=alert(1)>',
        priceNum: 10,
        workflowStatus: 'auto_approved',
        phase2Decision: 'recommended',
        approvedOrderQuantity: quantity,
        approvedLineSum: quantity * 10,
        provisionalOrderQuantity: null,
      }],
      autoApprovedLines: 1,
      autoApprovedSum: quantity * 10,
      workingMaximumLines: 1,
      workingMaximumSum: quantity * 10,
      financial_assessment: {
        currency: 'RUB',
        status: 'APPROVED',
        proposed_order_amount: quantity * 10,
        available_after_expenses: available,
        available_after_order: available - quantity * 10,
        minimum_reserve: reserve,
        reserve_surplus: available - quantity * 10 - reserve,
        missing_fields: [],
        financially_permitted: true,
      },
    },
  }];
}

function fixture({
  status = 'DISABLED',
  result = agentResult(),
  rules = null,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-status-service-'));
  directories.push(root);
  const registryPath = path.join(root, 'owner-approved-rules.json');
  const markdownPath = path.join(root, 'owner-approved-rules.md');
  const eventsPath = path.join(root, 'status-events.json');
  const previewsPath = path.join(root, 'previews.json');
  const runsRoot = path.join(root, 'runs');
  const resultPath = path.join(
    runsRoot,
    RUN_ID,
    'artifacts',
    'result.json'
  );
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  const rule = materializedRule(status);
  saveApprovedRules({
    ...emptyApprovedRulesRegistry(),
    updatedAt: CREATED_AT,
    rules: rules || [rule],
  }, {
    registryPath,
    markdownPath,
    logger: { error() {} },
  });
  const previewService = new OwnerRuleActivationPreviewService({
    approvedRulesFilePath: registryPath,
    previewStorageFilePath: previewsPath,
    runsRoot,
    now: () => new Date(PREVIEW_AT),
  });
  const statusService = new OwnerRuleStatusService({
    approvedRulesFilePath: registryPath,
    approvedRulesMarkdownPath: markdownPath,
    statusEventsFilePath: eventsPath,
    previewStorageFilePath: previewsPath,
    previewService,
    now: () => new Date(CHANGE_AT),
  });
  return {
    root,
    registryPath,
    markdownPath,
    eventsPath,
    previewsPath,
    resultPath,
    rule,
    previewService,
    statusService,
  };
}

function changeInput(rule, preview, overrides = {}) {
  return {
    ruleId: rule.ruleId,
    targetStatus: preview.rule.targetStatus,
    previewId: preview.previewId,
    confirmation: true,
    reasonCode: preview.rule.targetStatus === 'ACTIVE'
      ? 'READY_TO_APPLY'
      : 'TEMPORARILY_DISABLE',
    ownerComment: 'Проверено',
    ...overrides,
  };
}

test('activation preview is read-only and reports APPLY_SAFE impact', () => {
  const context = fixture();
  const registryBefore = fs.readFileSync(context.registryPath, 'utf8');
  const resultBefore = fs.readFileSync(context.resultPath, 'utf8');
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  assert.equal(preview.status, 'AVAILABLE');
  assert.equal(preview.impact.orderAmountBefore, 50);
  assert.equal(preview.impact.orderAmountAfter, 0);
  assert.equal(preview.impact.orderAmountDelta, -50);
  assert.equal(preview.impact.unitsDelta, -5);
  assert.equal(preview.impact.decisionChanges, 1);
  assert.equal(preview.changedItems.length, 1);
  assert.equal(fs.readFileSync(context.registryPath, 'utf8'), registryBefore);
  assert.equal(fs.readFileSync(context.resultPath, 'utf8'), resultBefore);
  assert.equal(fs.existsSync(context.eventsPath), false);
});

test('deactivation preview shows the inverse impact', () => {
  const context = fixture({ status: 'ACTIVE' });
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'DISABLED',
    runId: RUN_ID,
  });
  assert.equal(preview.impact.orderAmountBefore, 0);
  assert.equal(preview.impact.orderAmountAfter, 50);
  assert.equal(preview.impact.orderAmountDelta, 50);
  assert.equal(preview.impact.unitsDelta, 5);
});

test('valid preview activates exactly one rule and appends audit event', () => {
  const other = {
    ...materializedRule('DISABLED'),
    ruleId: 'rule-other',
    proposalId: 'proposal-other',
    stableItemKey: 'sku:SKU-2',
    scopeKey: 'sku:SKU-2',
    name: 'Other',
    provenance: {
      ...materializedRule().provenance,
      candidateId: 'candidate-other',
    },
  };
  const selected = materializedRule('DISABLED');
  const context = fixture({ rules: [selected, other] });
  context.rule = selected;
  const preview = context.statusService.previewStatusChange({
    ruleId: selected.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  const result = context.statusService.changeStatus(
    changeInput(selected, preview)
  );
  assert.equal(result.status, 'CHANGED');
  const registry = loadApprovedRules({
    registryPath: context.registryPath,
  });
  assert.equal(registry.rules[0].status, 'ACTIVE');
  assert.equal(registry.rules[1].status, 'DISABLED');
  const journal = loadRuleStatusEvents({
    filePath: context.eventsPath,
  });
  assert.equal(journal.events.length, 1);
  assert.equal(journal.events[0].action, 'ACTIVATE');
  assert.equal(journal.events[0].ownerComment, 'Проверено');
  assert.equal(journal.events[0].ruleSnapshot.stableItemKey, undefined);
});

test('valid preview deactivates an active rule', () => {
  const context = fixture({ status: 'ACTIVE' });
  const preview = context.statusService.previewStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'DISABLED',
    runId: RUN_ID,
  });
  const result = context.statusService.changeStatus(
    changeInput(context.rule, preview)
  );
  assert.equal(result.rule.previousStatus, 'ACTIVE');
  assert.equal(result.rule.currentStatus, 'DISABLED');
});

test('confirmation and preview are mandatory', () => {
  const context = fixture();
  assert.throws(
    () => context.statusService.changeStatus({
      ruleId: context.rule.ruleId,
      targetStatus: 'ACTIVE',
      previewId: 'missing',
      confirmation: false,
    }),
    { code: 'OWNER_RULE_STATUS_CONFIRMATION_REQUIRED' }
  );
  assert.throws(
    () => context.statusService.changeStatus({
      ruleId: context.rule.ruleId,
      targetStatus: 'ACTIVE',
      previewId: 'missing',
      confirmation: true,
    }),
    { code: 'PREVIEW_REQUIRED' }
  );
});

test('deactivation requires a meaningful reason', () => {
  const context = fixture({ status: 'ACTIVE' });
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'DISABLED',
    runId: RUN_ID,
  });
  assert.throws(
    () => context.statusService.changeStatus(changeInput(
      context.rule,
      preview,
      { reasonCode: 'NOT_SPECIFIED' }
    )),
    { code: 'OWNER_RULE_STATUS_INVALID_INPUT' }
  );
  assert.equal(
    loadApprovedRules({
      registryPath: context.registryPath,
    }).rules[0].status,
    'ACTIVE'
  );
});

test('invalid reason and long comment never change registry', () => {
  for (const overrides of [
    { reasonCode: 'UNKNOWN_REASON' },
    { ownerComment: 'x'.repeat(1001) },
  ]) {
    const context = fixture();
    const preview = context.previewService.previewRuleStatusChange({
      ruleId: context.rule.ruleId,
      targetStatus: 'ACTIVE',
      runId: RUN_ID,
    });
    assert.throws(
      () => context.statusService.changeStatus(changeInput(
        context.rule,
        preview,
        overrides
      )),
      { code: 'OWNER_RULE_STATUS_INVALID_INPUT' }
    );
    assert.equal(
      loadApprovedRules({
        registryPath: context.registryPath,
      }).rules[0].status,
      'DISABLED'
    );
  }
});

test('expired preview is rejected', () => {
  const context = fixture();
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  context.statusService.now =
    () => new Date('2026-07-26T04:16:00.000Z');
  assert.throws(
    () => context.statusService.changeStatus(
      changeInput(context.rule, preview)
    ),
    { code: 'PREVIEW_EXPIRED' }
  );
});

test('registry or run change makes preview stale', () => {
  const context = fixture();
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  const registry = loadApprovedRules({
    registryPath: context.registryPath,
  });
  saveApprovedRules({
    ...registry,
    updatedAt: '2026-07-26T04:01:30.000Z',
  }, {
    registryPath: context.registryPath,
    markdownPath: context.markdownPath,
    logger: { error() {} },
  });
  assert.throws(
    () => context.statusService.changeStatus(
      changeInput(context.rule, preview)
    ),
    { code: 'PREVIEW_STALE' }
  );

  const second = fixture();
  const secondPreview = second.previewService.previewRuleStatusChange({
    ruleId: second.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  fs.appendFileSync(second.resultPath, ' ');
  assert.throws(
    () => second.statusService.changeStatus(
      changeInput(second.rule, secondPreview)
    ),
    { code: 'PREVIEW_STALE' }
  );
});

test('financially forbidden target is blocked', () => {
  const context = fixture({
    status: 'ACTIVE',
    result: agentResult({ available: 120, reserve: 100 }),
  });
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'DISABLED',
    runId: RUN_ID,
  });
  assert.equal(preview.impact.financiallyPermitted, false);
  assert.throws(
    () => context.statusService.changeStatus(
      changeInput(context.rule, preview)
    ),
    { code: 'RULE_ACTIVATION_NOT_FINANCIALLY_PERMITTED' }
  );
  assert.equal(
    loadApprovedRules({
      registryPath: context.registryPath,
    }).rules[0].status,
    'ACTIVE'
  );
});

test('registry write failure leaves status unchanged', () => {
  const context = fixture();
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  context.statusService.saveRegistry = () => {
    throw new Error('simulated');
  };
  assert.throws(
    () => context.statusService.changeStatus(
      changeInput(context.rule, preview)
    ),
    { code: 'RULE_REGISTRY_UNAVAILABLE' }
  );
  assert.equal(
    loadApprovedRules({
      registryPath: context.registryPath,
    }).rules[0].status,
    'DISABLED'
  );
});

test('retry repairs journal after registry write succeeds', () => {
  const context = fixture();
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  const originalAppend = context.statusService.appendEvent;
  context.statusService.appendEvent = () => {
    throw new Error('simulated');
  };
  assert.throws(
    () => context.statusService.changeStatus(
      changeInput(context.rule, preview)
    ),
    { code: 'RULE_STATUS_STORAGE_UNAVAILABLE' }
  );
  assert.equal(
    loadApprovedRules({
      registryPath: context.registryPath,
    }).rules[0].status,
    'ACTIVE'
  );
  context.statusService.appendEvent = originalAppend;
  const retried = context.statusService.changeStatus(
    changeInput(context.rule, preview)
  );
  assert.equal(retried.status, 'ALREADY_CHANGED');
  assert.equal(retried.repair.repaired, true);
  const journal = loadRuleStatusEvents({
    filePath: context.eventsPath,
  });
  assert.equal(journal.events.length, 1);
  assert.equal(journal.events[0].metadata.repair, true);
});

test('duplicate POST is idempotent and does not duplicate event', () => {
  const context = fixture();
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  const input = changeInput(context.rule, preview);
  context.statusService.changeStatus(input);
  const duplicate = context.statusService.changeStatus(input);
  assert.equal(duplicate.status, 'ALREADY_CHANGED');
  assert.equal(duplicate.repair.repaired, false);
  assert.equal(
    loadRuleStatusEvents({
      filePath: context.eventsPath,
    }).events.length,
    1
  );
});

test('status history is scoped to one rule', () => {
  const context = fixture();
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  context.statusService.changeStatus(changeInput(context.rule, preview));
  const history = context.statusService.getRuleStatusHistory({
    ruleId: context.rule.ruleId,
  });
  assert.equal(history.ruleId, context.rule.ruleId);
  assert.equal(history.events.length, 1);
});

test('status switch never rewrites saved result.json', () => {
  const context = fixture();
  const before = fs.readFileSync(context.resultPath, 'utf8');
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  context.statusService.changeStatus(changeInput(context.rule, preview));
  assert.equal(fs.readFileSync(context.resultPath, 'utf8'), before);
});

test('practical activation/deactivation matches later APPLY_SAFE only', () => {
  const context = fixture();
  const sourceResult = agentResult();
  const unchangedFiles = [
    'owner-learning-rule-materializations.json',
    'owner-learning-candidate-lifecycle.json',
    'owner-decision-history.json',
  ].map(name => path.join(context.root, name));
  unchangedFiles.forEach((filePath, index) => {
    fs.writeFileSync(filePath, `{"sentinel":${index}}\n`, 'utf8');
  });
  const hashesBefore = unchangedFiles.map(filePath =>
    crypto.createHash('sha256')
      .update(fs.readFileSync(filePath))
      .digest('hex')
  );
  const resultBefore = fs.readFileSync(context.resultPath, 'utf8');
  const baseline = processApprovedRules({
    agentResult: structuredClone(sourceResult),
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: loadApprovedRules({
      registryPath: context.registryPath,
    }),
    generatedAt: PREVIEW_AT,
  });
  assert.equal(baseline.approvedRuleApplications.amountAfter, 50);

  const activationPreview = context.statusService.previewStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  assert.equal(
    loadApprovedRules({
      registryPath: context.registryPath,
    }).rules[0].status,
    'DISABLED'
  );
  context.statusService.changeStatus(
    changeInput(context.rule, activationPreview)
  );
  assert.equal(fs.readFileSync(context.resultPath, 'utf8'), resultBefore);
  const activeRegistry = loadApprovedRules({
    registryPath: context.registryPath,
  });
  const afterActivation = processApprovedRules({
    agentResult: structuredClone(sourceResult),
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: activeRegistry,
    generatedAt: CHANGE_AT,
  });
  assert.equal(
    afterActivation.approvedRuleApplications.amountAfter,
    activationPreview.impact.orderAmountAfter
  );
  assert.equal(
    afterActivation.agentResult[0].json
      .workingOrderProducts[0].approvedOrderQuantity,
    0
  );

  context.previewService.now =
    () => new Date('2026-07-26T04:03:00.000Z');
  context.statusService.now =
    () => new Date('2026-07-26T04:04:00.000Z');
  const deactivationPreview = context.statusService.previewStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'DISABLED',
    runId: RUN_ID,
  });
  context.statusService.changeStatus(
    changeInput(activeRegistry.rules[0], deactivationPreview)
  );
  const disabledAgain = loadApprovedRules({
    registryPath: context.registryPath,
  });
  const afterDeactivation = processApprovedRules({
    agentResult: structuredClone(sourceResult),
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: disabledAgain,
    generatedAt: '2026-07-26T04:05:00.000Z',
  });
  assert.equal(
    afterDeactivation.approvedRuleApplications.amountAfter,
    deactivationPreview.impact.orderAmountAfter
  );
  assert.equal(
    afterDeactivation.approvedRuleApplications.amountAfter,
    baseline.approvedRuleApplications.amountAfter
  );
  assert.equal(fs.readFileSync(context.resultPath, 'utf8'), resultBefore);
  assert.deepEqual(
    unchangedFiles.map(filePath =>
      crypto.createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex')
    ),
    hashesBefore
  );

  fs.writeFileSync(context.eventsPath, '{broken', 'utf8');
  const rulesResult = new OwnerMaterializedRulesService({
    approvedRulesFilePath: context.registryPath,
    materializationsFilePath: unchangedFiles[0],
    candidateLifecycleFilePath: unchangedFiles[1],
    statusEventsFilePath: context.eventsPath,
    candidatesService: {
      getCandidates() {
        return { status: 'AVAILABLE', candidates: [] };
      },
    },
    loadMaterializations() {
      return {
        schemaVersion: 'owner-learning-rule-materializations-v0.9.0',
        updatedAt: null,
        events: [],
      };
    },
    loadLifecycle() {
      return {
        schemaVersion: 'owner-learning-candidate-lifecycle-v0.8.5',
        updatedAt: null,
        events: [],
      };
    },
    logger: { warn() {} },
  }).listRules();
  assert.equal(rulesResult.status, 'AVAILABLE');
  assert.equal(rulesResult.warning, STATUS_HISTORY_WARNING);
  assert.equal(
    processApprovedRules({
      agentResult: structuredClone(sourceResult),
      approvedRuleMode: 'APPLY_SAFE',
      approvedRules: disabledAgain,
      generatedAt: '2026-07-26T04:06:00.000Z',
    }).approvedRuleApplications.amountAfter,
    50
  );
});
