const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  HISTORY_SCHEMA_VERSION,
  atomicWriteDecisionHistory,
  createDecisionHistoryEntry,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);
const {
  LIFECYCLE_SCHEMA_VERSION,
  atomicWriteCandidateLifecycle,
  createCandidateLifecycleEvent,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_candidate_lifecycle'
);
const {
  MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
  writeMaterializationJournal,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_materialization_journal'
);
const {
  REGISTRY_SCHEMA_VERSION,
  saveApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_registry'
);
const {
  appendRuleEffectivenessEvent,
  createRuleEffectivenessEvent,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_effectiveness'
);
const {
  OwnerDecisionAnalyticsService,
} = require('../application/owner_decision_analytics_service');
const {
  OwnerLearningCandidatesService,
} = require('../application/owner_learning_candidates_service');
const {
  OwnerLearningCandidateLifecycleService,
} = require(
  '../application/owner_learning_candidate_lifecycle_service'
);
const {
  OwnerMaterializedRulesService,
} = require('../application/owner_materialized_rules_service');
const {
  OwnerRuleEffectivenessService,
} = require('../application/owner_rule_effectiveness_service');
const {
  OwnerLearningCenterService,
} = require('../application/owner_learning_center_service');

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
const AS_OF = '2026-07-27T00:00:00.000Z';

function sha256(filePath) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function digest(value) {
  return crypto.createHash('sha256')
    .update(String(value))
    .digest('hex');
}

function historyEntry(index) {
  return createDecisionHistoryEntry({
    recordedAt:
      `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    source: 'OWNER_REVIEW',
    runId: `center-practical-run-${index + 1}`,
    supplier: 'Валта',
    stableItemKey: 'sku:7177004',
    sku: '7177004',
    productName: '<img src=x onerror=alert(1)>',
    brand: 'AWARD',
    category: 'Корм',
    agentRecommendation: 'BUY',
    agentQuantity: 8,
    ownerDecision: 'SKIP',
    ownerQuantity: 0,
    reasonCode: 'LOW_SALES',
    ownerComment: null,
    ruleId: null,
    applicationMode: 'PREVIEW',
    financialContext: {},
    inventoryContext: {},
    salesContext: {},
    metadata: {},
  });
}

function lifecycleSnapshot(candidate) {
  return {
    patternType: candidate.patternType,
    scopeType: candidate.scopeType,
    displayScope: candidate.displayScope,
    proposedRuleType: candidate.proposedRuleType,
    proposedDecision: candidate.proposedAction.decision,
    confidenceScore: candidate.confidence.score,
    confidenceLevel: candidate.confidence.level,
    priorityScore: candidate.ranking.priorityScore,
    priorityLevel: candidate.ranking.priorityLevel,
    eligibilityStatus: candidate.eligibility.status,
  };
}

function rule(index, candidateId, status = 'ACTIVE') {
  const timestamp =
    `2026-07-${String(15 + index).padStart(2, '0')}T00:00:00.000Z`;
  return {
    ruleId: `center-rule-${index}`,
    proposalId: `center-materialization-${index}`,
    stableItemKey: `sku:${8000 + index}`,
    name: index === 2
      ? '<img src=x onerror=alert(1)>'
      : `Товар ${index}`,
    brand: 'Test',
    ruleType: 'ITEM_DECISION_OVERRIDE',
    approvedDecision: index % 2 === 0 ? 'BUY' : 'SKIP',
    approvedAt: timestamp,
    status,
    createdFromVersion: 'owner-rule-materialization-v0.9.0',
    notes: null,
    scopeType: 'ITEM',
    scopeKey: `sku:${8000 + index}`,
    action: {
      decision: index % 2 === 0 ? 'BUY' : 'SKIP',
      quantityStrategy: index % 2 === 0
        ? 'KEEP_AGENT_QUANTITY'
        : 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    source: 'OWNER_LEARNING_CANDIDATE',
    createdAt: timestamp,
    updatedAt: timestamp,
    provenance: {
      source: 'OWNER_LEARNING_CANDIDATE',
      candidateId,
      lifecycleEventId: `center-lifecycle-${index}`,
      patternType: 'SAME_ITEM_SAME_DECISION',
      confidenceScore: 90 - index,
      confidenceLevel: 'HIGH',
      priorityScore: 80 - index,
      priorityLevel: 'HIGH',
      eligibilityStatus: 'ELIGIBLE',
      materializedAt: timestamp,
      materializationVersion: 'owner-rule-materialization-v0.9.0',
    },
  };
}

function materializationEvent(value) {
  return {
    schemaVersion: MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
    materializationId: value.proposalId,
    recordedAt: value.provenance.materializedAt,
    candidateId: value.provenance.candidateId,
    lifecycleEventId: value.provenance.lifecycleEventId,
    ruleId: value.ruleId,
    resultStatus: 'CREATED',
    ruleStatus: 'DISABLED',
    fingerprint: digest(value.ruleId),
    snapshot: {
      patternType: value.provenance.patternType,
      proposedRuleType: value.ruleType,
      proposedDecision: value.approvedDecision,
      confidenceScore: value.provenance.confidenceScore,
      confidenceLevel: value.provenance.confidenceLevel,
      priorityScore: value.provenance.priorityScore,
      priorityLevel: value.provenance.priorityLevel,
    },
    metadata: {},
  };
}

function effectivenessEvent({
  rule,
  runId,
  recordedAt,
  effectStatus,
}) {
  const applied = effectStatus === 'APPLIED_EFFECT';
  const fallback = effectStatus === 'FALLBACK_TO_BASELINE';
  return createRuleEffectivenessEvent({
    recordedAt,
    runId,
    supplier: 'Валта',
    ruleId: rule.ruleId,
    candidateId: rule.provenance.candidateId,
    ruleStatus: rule.status,
    ruleType: rule.ruleType,
    decision: rule.action.decision,
    evaluationStatus: 'EVALUATED',
    effectStatus,
    scopeSnapshot: {
      displayPrimary: rule.name,
      displaySecondary: `SKU ${8000 + Number(rule.ruleId.at(-1))}`,
      stableItemKeyHash: digest(rule.stableItemKey),
    },
    impact: {
      affectedRows: applied ? 1 : 0,
      decisionChanges: applied ? 1 : 0,
      quantityChanges: applied ? 1 : 0,
      quantityBefore: 10,
      quantityAfter: applied ? 8 : 10,
      quantityDelta: applied ? -2 : 0,
      orderAmountBefore: 1000,
      orderAmountAfter: applied ? 800 : 1000,
      orderAmountDelta: applied ? -200 : 0,
      financialStatusBefore: 'APPROVED',
      financialStatusAfter: 'APPROVED',
      financiallyPermitted: true,
    },
    fallback: {
      occurred: fallback,
      reasonCode: fallback ? 'RECALCULATION_FAILED' : null,
    },
    applicationMode: 'APPLY_SAFE',
    registryFingerprint: digest('center-registry'),
    runFingerprint: digest(`${runId}:${rule.ruleId}`),
    metadata: { recorderVersion: 'practical-test' },
  });
}

test('practical center scenario is AVAILABLE, fail-soft and read-only', () => {
  const productionBefore = Object.fromEntries(
    PRODUCTION_FILES.map(filePath => [filePath, sha256(filePath)])
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'owner-learning-center-practical-')
  );
  const historyPath = path.join(directory, 'history.json');
  const lifecyclePath = path.join(directory, 'lifecycle.json');
  const materializationsPath =
    path.join(directory, 'materializations.json');
  const registryPath = path.join(directory, 'rules.json');
  const registryMarkdownPath = path.join(directory, 'rules.md');
  const statusPath = path.join(directory, 'statuses.json');
  const effectivenessPath = path.join(directory, 'effectiveness.json');
  try {
    const entries = Array.from({ length: 8 }, (_, index) =>
      historyEntry(index)
    );
    atomicWriteDecisionHistory(historyPath, {
      schemaVersion: HISTORY_SCHEMA_VERSION,
      updatedAt: entries.at(-1).recordedAt,
      entries,
    });
    const candidatesService = new OwnerLearningCandidatesService({
      historyFilePath: historyPath,
      lifecycleFilePath: lifecyclePath,
      materializationsFilePath: materializationsPath,
      logger: { warn() {} },
      now: () => AS_OF,
    });
    const initialCandidates =
      candidatesService.getCandidates().candidates;
    assert.ok(initialCandidates.length >= 4);
    const approved = createCandidateLifecycleEvent({
      recordedAt: '2026-07-10T00:00:00.000Z',
      candidateId: initialCandidates[0].candidateId,
      fromStatus: 'NEW',
      toStatus: 'APPROVED',
      action: 'APPROVE',
      actor: 'OWNER',
      reasonCode: 'READY_FOR_RULE',
      ownerComment: null,
      candidateSnapshot: lifecycleSnapshot(initialCandidates[0]),
      metadata: {},
    });
    const postponed = createCandidateLifecycleEvent({
      recordedAt: '2026-07-11T00:00:00.000Z',
      candidateId: initialCandidates[1].candidateId,
      fromStatus: 'NEW',
      toStatus: 'POSTPONED',
      action: 'POSTPONE',
      actor: 'OWNER',
      reasonCode: 'NEEDS_MORE_HISTORY',
      ownerComment: null,
      candidateSnapshot: lifecycleSnapshot(initialCandidates[1]),
      metadata: {},
    });
    atomicWriteCandidateLifecycle(lifecyclePath, {
      schemaVersion: LIFECYCLE_SCHEMA_VERSION,
      updatedAt: postponed.recordedAt,
      events: [approved, postponed],
    });

    const rules = [
      rule(1, initialCandidates[2].candidateId),
      rule(2, 'b'.repeat(64)),
      rule(3, 'c'.repeat(64)),
      rule(4, 'd'.repeat(64)),
    ];
    saveApprovedRules({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: rules.at(-1).updatedAt,
      rules,
    }, {
      registryPath,
      markdownPath: registryMarkdownPath,
      logger: { error() {} },
    });
    writeMaterializationJournal(materializationsPath, {
      schemaVersion: MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
      updatedAt: rules.at(-1).provenance.materializedAt,
      events: rules.map(materializationEvent),
    });

    const events = [
      ...Array.from({ length: 3 }, (_, index) =>
        effectivenessEvent({
          rule: rules[0],
          runId: `effective-${index}`,
          recordedAt:
            `2026-07-${String(20 + index).padStart(2, '0')}T00:00:00.000Z`,
          effectStatus: 'APPLIED_EFFECT',
        })
      ),
      effectivenessEvent({
        rule: rules[1],
        runId: 'stale-applied',
        recordedAt: '2025-01-01T00:00:00.000Z',
        effectStatus: 'APPLIED_EFFECT',
      }),
      effectivenessEvent({
        rule: rules[1],
        runId: 'stale-no-match-1',
        recordedAt: '2025-01-02T00:00:00.000Z',
        effectStatus: 'NO_MATCH',
      }),
      effectivenessEvent({
        rule: rules[1],
        runId: 'stale-no-match-2',
        recordedAt: '2025-01-03T00:00:00.000Z',
        effectStatus: 'NO_MATCH',
      }),
      effectivenessEvent({
        rule: rules[2],
        runId: 'review-fallback',
        recordedAt: '2026-07-23T00:00:00.000Z',
        effectStatus: 'FALLBACK_TO_BASELINE',
      }),
      ...Array.from({ length: 3 }, (_, index) =>
        effectivenessEvent({
          rule: rules[3],
          runId: `no-effect-${index}`,
          recordedAt:
            `2026-07-${String(20 + index).padStart(2, '0')}T12:00:00.000Z`,
          effectStatus: 'MATCHED_NO_CHANGE',
        })
      ),
    ];
    for (const event of events) {
      appendRuleEffectivenessEvent({
        filePath: effectivenessPath,
        event,
      });
    }

    const decisionService = new OwnerDecisionAnalyticsService({
      historyFilePath: historyPath,
      logger: { warn() {} },
      now: () => AS_OF,
    });
    const lifecycleService =
      new OwnerLearningCandidateLifecycleService({
        lifecycleFilePath: lifecyclePath,
        candidatesService,
        logger: { warn() {} },
        now: () => AS_OF,
      });
    const materializedRulesService =
      new OwnerMaterializedRulesService({
        approvedRulesFilePath: registryPath,
        materializationsFilePath: materializationsPath,
        candidateLifecycleFilePath: lifecyclePath,
        statusEventsFilePath: statusPath,
        effectivenessFilePath: effectivenessPath,
        candidatesService,
        logger: { warn() {} },
        now: () => AS_OF,
      });
    const effectivenessService =
      new OwnerRuleEffectivenessService({
        effectivenessFilePath: effectivenessPath,
        approvedRulesFilePath: registryPath,
        logger: { warn() {} },
        now: () => AS_OF,
      });
    const center = new OwnerLearningCenterService({
      decisionAnalyticsService: decisionService,
      candidatesService,
      candidateLifecycleService: lifecycleService,
      materializedRulesService,
      ruleEffectivenessService: effectivenessService,
      logger: { warn() {} },
      now: () => AS_OF,
    });

    const overview = center.getOverview();
    assert.equal(overview.status, 'AVAILABLE');
    assert.equal(overview.summary.decisions.total, 8);
    assert.equal(overview.summary.rules.total, 4);
    assert.equal(overview.summary.effectiveness.effective, 1);
    assert.equal(overview.summary.effectiveness.stale, 1);
    assert.equal(overview.summary.effectiveness.reviewRecommended, 1);
    assert.equal(overview.summary.effectiveness.noEffectYet, 1);
    assert.ok(overview.attention.total >= 5);
    assert.ok(overview.recentActivity.length >= 5);
    assert.equal(overview.systemHealth.overallStatus, 'HEALTHY');
    assert.equal(
      JSON.stringify(overview).includes('<img src=x onerror=alert(1)>'),
      true
    );

    fs.writeFileSync(effectivenessPath, '{');
    const partial = center.getOverview();
    assert.equal(partial.status, 'PARTIAL');
    assert.equal(partial.summary.decisions.total, 8);
    assert.equal(partial.summary.rules.total, 4);
    assert.equal(partial.summary.effectiveness, null);

    fs.writeFileSync(registryPath, '{');
    const registryUnavailable = center.getOverview();
    assert.equal(registryUnavailable.status, 'PARTIAL');
    assert.equal(registryUnavailable.summary.decisions.total, 8);
    assert.equal(registryUnavailable.summary.rules, null);

    const productionAfter = Object.fromEntries(
      PRODUCTION_FILES.map(filePath => [filePath, sha256(filePath)])
    );
    assert.deepEqual(productionAfter, productionBefore);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
