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
  registryFingerprint,
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
  createStatusTransitionIntent,
  deleteStatusTransitionIntent,
  intentFilePath,
  loadStatusTransitionIntent,
  saveStatusTransitionIntent,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_status_transition_intent'
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
    expectedFingerprint: registryFingerprint(registry),
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
  assert.equal(fs.existsSync(intentFilePath(
    `${context.eventsPath}.transition-intents`,
    context.rule.ruleId
  )), false);
});

test('registry write lock preserves transition intent for the winner', () => {
  const context = fixture();
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  context.statusService.saveRegistry = () => {
    throw Object.assign(new Error('locked'), {
      code: 'RULE_REGISTRY_WRITE_LOCKED',
    });
  };

  assert.throws(
    () => context.statusService.changeStatus(
      changeInput(context.rule, preview)
    ),
    { code: 'RULE_REGISTRY_WRITE_LOCKED' }
  );
  assert.equal(fs.existsSync(intentFilePath(
    `${context.eventsPath}.transition-intents`,
    context.rule.ruleId
  )), true);
  const intent = loadStatusTransitionIntent({
    directoryPath: `${context.eventsPath}.transition-intents`,
    ruleId: context.rule.ruleId,
  });
  assert.equal(intent.previewId, preview.previewId);
  assert.equal(intent.fromStatus, 'DISABLED');
  assert.equal(intent.toStatus, 'ACTIVE');
  assert.equal(
    loadApprovedRules({
      registryPath: context.registryPath,
    }).rules[0].status,
    'DISABLED'
  );
});

test('status write carries an expected registry fingerprint', () => {
  const context = fixture();
  const preview = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  let expectedFingerprint = null;
  context.statusService.saveRegistry = (registry, options) => {
    expectedFingerprint = options.expectedFingerprint;
    const intent = loadStatusTransitionIntent({
      directoryPath: `${context.eventsPath}.transition-intents`,
      ruleId: context.rule.ruleId,
    });
    assert.equal(intent.previewId, preview.previewId);
    assert.equal(intent.reasonCode, 'READY_TO_APPLY');
    assert.equal(intent.ownerComment, 'Проверено');
    assert.equal(intent.targetUpdatedAt, CHANGE_AT);
    return registry;
  };

  const result = context.statusService.changeStatus(
    changeInput(context.rule, preview)
  );

  assert.equal(result.status, 'CHANGED');
  assert.match(expectedFingerprint, /^[a-f0-9]{64}$/);
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
  assert.equal(journal.events[0].previewId, preview.previewId);
  assert.equal(journal.events[0].reasonCode, 'READY_TO_APPLY');
  assert.equal(journal.events[0].ownerComment, 'Проверено');
  assert.equal(fs.existsSync(intentFilePath(
    `${context.eventsPath}.transition-intents`,
    context.rule.ruleId
  )), false);
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

test('another preview cannot create a second event for one transition', () => {
  const context = fixture();
  const previewA = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  context.previewService.now =
    () => new Date('2026-07-26T04:01:30.000Z');
  const previewB = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  assert.notEqual(previewA.previewId, previewB.previewId);

  context.statusService.changeStatus(changeInput(
    context.rule,
    previewA,
    {
      reasonCode: 'READY_TO_APPLY',
      ownerComment: 'Комментарий A',
    }
  ));
  const duplicate = context.statusService.changeStatus(changeInput(
    context.rule,
    previewB,
    {
      reasonCode: 'NEEDS_MORE_REVIEW',
      ownerComment: 'Комментарий B',
    }
  ));
  const events = loadRuleStatusEvents({
    filePath: context.eventsPath,
  }).events;

  assert.equal(duplicate.status, 'ALREADY_CHANGED');
  assert.equal(duplicate.repair.repaired, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].previewId, previewA.previewId);
  assert.equal(events[0].reasonCode, 'READY_TO_APPLY');
  assert.equal(events[0].ownerComment, 'Комментарий A');
  assert.notEqual(events[0].ownerComment, 'Комментарий B');
});

test('repair after append failure uses preview A and ignores preview B', () => {
  const context = fixture();
  const previewA = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  context.previewService.now =
    () => new Date('2026-07-26T04:01:30.000Z');
  const previewB = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  const originalAppend = context.statusService.appendEvent;
  context.statusService.appendEvent = () => {
    throw new Error('simulated audit failure');
  };
  assert.throws(
    () => context.statusService.changeStatus(changeInput(
      context.rule,
      previewA,
      {
        reasonCode: 'READY_TO_APPLY',
        ownerComment: 'Комментарий A',
      }
    )),
    { code: 'RULE_STATUS_STORAGE_UNAVAILABLE' }
  );
  const transitionIntentPath = intentFilePath(
    `${context.eventsPath}.transition-intents`,
    context.rule.ruleId
  );
  assert.equal(fs.existsSync(transitionIntentPath), true);
  const transitionIntentSource = fs.readFileSync(
    transitionIntentPath,
    'utf8'
  );
  assert.doesNotMatch(
    transitionIntentSource,
    /workingOrderProducts|changedItems|result\.json/
  );

  context.statusService.appendEvent = originalAppend;
  context.statusService.getPreview = () => {
    throw new Error('preview B must not be read during repair');
  };
  const repaired = context.statusService.changeStatus(changeInput(
    context.rule,
    previewB,
    {
      reasonCode: 'NEEDS_MORE_REVIEW',
      ownerComment: 'Комментарий B',
    }
  ));
  const events = loadRuleStatusEvents({
    filePath: context.eventsPath,
  }).events;

  assert.equal(repaired.status, 'ALREADY_CHANGED');
  assert.equal(repaired.repair.repaired, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].previewId, previewA.previewId);
  assert.equal(events[0].reasonCode, 'READY_TO_APPLY');
  assert.equal(events[0].ownerComment, 'Комментарий A');
  assert.notEqual(events[0].previewId, previewB.previewId);
  assert.notEqual(events[0].ownerComment, 'Комментарий B');
  assert.equal(fs.existsSync(transitionIntentPath), false);

  const duplicate = context.statusService.changeStatus(changeInput(
    context.rule,
    previewB,
    {
      reasonCode: 'NEEDS_MORE_REVIEW',
      ownerComment: 'Комментарий B',
    }
  ));
  assert.equal(duplicate.repair.repaired, false);
  assert.equal(
    loadRuleStatusEvents({ filePath: context.eventsPath }).events.length,
    1
  );
  assert.equal(fs.existsSync(transitionIntentPath), false);
});

test('intent cleanup deletes only the exact expected correlation', () => {
  const context = fixture();
  const previewA = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  const originalAppend = context.statusService.appendEvent;
  context.statusService.appendEvent = () => {
    throw new Error('simulated audit failure');
  };
  assert.throws(
    () => context.statusService.changeStatus(
      changeInput(context.rule, previewA)
    ),
    { code: 'RULE_STATUS_STORAGE_UNAVAILABLE' }
  );
  const directoryPath = `${context.eventsPath}.transition-intents`;
  const intentA = loadStatusTransitionIntent({
    directoryPath,
    ruleId: context.rule.ruleId,
  });
  assert.equal(deleteStatusTransitionIntent({
    directoryPath,
    expectedIntent: intentA,
  }).deleted, true);

  const activeRule = loadApprovedRules({
    registryPath: context.registryPath,
  }).rules[0];
  context.previewService.now =
    () => new Date('2026-07-26T04:03:00.000Z');
  const previewB = context.previewService.previewRuleStatusChange({
    ruleId: activeRule.ruleId,
    targetStatus: 'DISABLED',
    runId: RUN_ID,
  });
  const eventB = context.statusService.statusEvent({
    rule: activeRule,
    targetStatus: 'DISABLED',
    preview: context.statusService.currentPreview(previewB.previewId),
    recordedAt: '2026-07-26T04:04:00.000Z',
    reasonCode: 'TEMPORARILY_DISABLE',
    ownerComment: 'Переход B',
  });
  const intentB = createStatusTransitionIntent({ event: eventB });
  assert.equal(saveStatusTransitionIntent({
    directoryPath,
    intent: intentB,
  }).intentId, intentB.intentId);

  const staleCleanup = deleteStatusTransitionIntent({
    directoryPath,
    expectedIntent: intentA,
  });
  assert.deepEqual(staleCleanup, {
    deleted: false,
    diagnostic: 'RULE_STATUS_TRANSITION_INTENT_MISMATCH',
  });
  assert.equal(
    loadStatusTransitionIntent({
      directoryPath,
      ruleId: activeRule.ruleId,
    }).intentId,
    intentB.intentId
  );
  assert.deepEqual(deleteStatusTransitionIntent({
    directoryPath,
    expectedIntent: intentB,
  }), {
    deleted: true,
    diagnostic: null,
  });
  assert.deepEqual(deleteStatusTransitionIntent({
    directoryPath,
    expectedIntent: intentB,
  }), {
    deleted: false,
    diagnostic: 'RULE_STATUS_TRANSITION_INTENT_NOT_FOUND',
  });
  context.statusService.appendEvent = originalAppend;
});

test('duplicate completed event does not delete the next transition intent', () => {
  const context = fixture();
  const previewA = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  const inputA = changeInput(context.rule, previewA);
  context.statusService.changeStatus(inputA);
  const activeRule = loadApprovedRules({
    registryPath: context.registryPath,
  }).rules[0];
  context.previewService.now =
    () => new Date('2026-07-26T04:03:00.000Z');
  const previewB = context.previewService.previewRuleStatusChange({
    ruleId: activeRule.ruleId,
    targetStatus: 'DISABLED',
    runId: RUN_ID,
  });
  const intentB = createStatusTransitionIntent({
    event: context.statusService.statusEvent({
      rule: activeRule,
      targetStatus: 'DISABLED',
      preview: context.statusService.currentPreview(previewB.previewId),
      recordedAt: '2026-07-26T04:04:00.000Z',
      reasonCode: 'TEMPORARILY_DISABLE',
      ownerComment: 'Переход B',
    }),
  });
  const directoryPath = `${context.eventsPath}.transition-intents`;
  saveStatusTransitionIntent({ directoryPath, intent: intentB });

  const duplicateA = context.statusService.changeStatus(inputA);

  assert.equal(duplicateA.status, 'ALREADY_CHANGED');
  assert.equal(duplicateA.repair.repaired, false);
  assert.equal(
    duplicateA.repair.cleanup.diagnostic,
    'RULE_STATUS_TRANSITION_INTENT_MISMATCH'
  );
  assert.equal(
    loadStatusTransitionIntent({
      directoryPath,
      ruleId: activeRule.ruleId,
    }).intentId,
    intentB.intentId
  );
  assert.equal(
    loadRuleStatusEvents({ filePath: context.eventsPath }).events.length,
    1
  );
});

test('loser CAS keeps winner intent and retry repairs winner audit', () => {
  const context = fixture();
  const previewA = context.previewService.previewRuleStatusChange({
    ruleId: context.rule.ruleId,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
  const inputA = changeInput(context.rule, previewA, {
    reasonCode: 'READY_TO_APPLY',
    ownerComment: 'Correlation A',
  });
  const serviceB = new OwnerRuleStatusService({
    approvedRulesFilePath: context.registryPath,
    approvedRulesMarkdownPath: context.markdownPath,
    statusEventsFilePath: context.eventsPath,
    previewStorageFilePath: context.previewsPath,
    previewService: context.previewService,
    now: () => new Date(CHANGE_AT),
  });
  serviceB.saveRegistry = () => {
    throw Object.assign(new Error('loser CAS'), {
      code: 'RULE_REGISTRY_CONCURRENT_MODIFICATION',
    });
  };
  const originalAppend = context.statusService.appendEvent;
  context.statusService.saveRegistry = (registry, options) => {
    assert.throws(
      () => serviceB.changeStatus(inputA),
      { code: 'RULE_REGISTRY_CONCURRENT_MODIFICATION' }
    );
    const winnerIntent = loadStatusTransitionIntent({
      directoryPath: `${context.eventsPath}.transition-intents`,
      ruleId: context.rule.ruleId,
    });
    assert.equal(winnerIntent.previewId, previewA.previewId);
    assert.equal(winnerIntent.ownerComment, 'Correlation A');
    return saveApprovedRules(registry, options);
  };
  context.statusService.appendEvent = () => {
    throw new Error('winner audit failure');
  };

  assert.throws(
    () => context.statusService.changeStatus(inputA),
    { code: 'RULE_STATUS_STORAGE_UNAVAILABLE' }
  );
  assert.equal(
    loadApprovedRules({
      registryPath: context.registryPath,
    }).rules[0].status,
    'ACTIVE'
  );
  const winnerIntent = loadStatusTransitionIntent({
    directoryPath: `${context.eventsPath}.transition-intents`,
    ruleId: context.rule.ruleId,
  });
  assert.equal(winnerIntent.previewId, previewA.previewId);
  assert.equal(winnerIntent.reasonCode, 'READY_TO_APPLY');
  assert.equal(winnerIntent.ownerComment, 'Correlation A');
  assert.equal(fs.existsSync(context.eventsPath), false);

  context.statusService.appendEvent = originalAppend;
  const repaired = context.statusService.changeStatus(inputA);
  const events = loadRuleStatusEvents({
    filePath: context.eventsPath,
  }).events;

  assert.equal(repaired.status, 'ALREADY_CHANGED');
  assert.equal(repaired.repair.repaired, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].previewId, previewA.previewId);
  assert.equal(events[0].reasonCode, 'READY_TO_APPLY');
  assert.equal(events[0].ownerComment, 'Correlation A');
  assert.equal(loadStatusTransitionIntent({
    directoryPath: `${context.eventsPath}.transition-intents`,
    ruleId: context.rule.ruleId,
  }), null);
  const duplicate = context.statusService.changeStatus(inputA);
  assert.equal(duplicate.repair.repaired, false);
  assert.equal(
    loadRuleStatusEvents({ filePath: context.eventsPath }).events.length,
    1
  );
});

test('missing transition correlation never creates a guessed audit event', () => {
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
    updatedAt: CHANGE_AT,
    rules: registry.rules.map(rule => ({
      ...rule,
      status: 'ACTIVE',
      updatedAt: CHANGE_AT,
    })),
  }, {
    registryPath: context.registryPath,
    markdownPath: context.markdownPath,
    expectedFingerprint: registryFingerprint(registry),
    logger: { error() {} },
  });

  assert.throws(
    () => context.statusService.changeStatus(
      changeInput(context.rule, preview)
    ),
    { code: 'RULE_STATUS_AUDIT_UNRESOLVED' }
  );
  assert.equal(fs.existsSync(context.eventsPath), false);
  assert.equal(fs.existsSync(intentFilePath(
    `${context.eventsPath}.transition-intents`,
    context.rule.ruleId
  )), false);
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
