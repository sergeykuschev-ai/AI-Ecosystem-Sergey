const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  MANUAL_REVIEW_CODE,
  OwnerLearningCenterService,
  digestAttention,
  normalizeInput,
} = require('../application/owner_learning_center_service');
const {
  mapOwnerLearningCenter,
} = require('../dto/owner_learning_center_mapper');

const AS_OF = '2026-07-27T00:00:00.000Z';

function decisions(overrides = {}) {
  return {
    status: 'AVAILABLE',
    analytics: {
      generatedAt: AS_OF,
      population: {
        filteredEntries: 8,
        uniqueItems: 3,
      },
      agreementAnalysis: { agreementRate: 0.75 },
      dataQuality: { warnings: [] },
    },
    warning: null,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    candidateId: 'a'.repeat(64),
    displayScope: { primary: 'Товар', secondary: 'SKU 1' },
    proposedAction: { decision: 'BUY' },
    eligibility: { status: 'ELIGIBLE' },
    lifecycle: {
      status: 'NEW',
      lastRecordedAt: null,
    },
    materialization: {
      status: 'NOT_MATERIALIZED',
      materializedAt: null,
    },
    ...overrides,
  };
}

function candidates(items = [candidate()], overrides = {}) {
  return {
    status: 'AVAILABLE',
    generatedAt: AS_OF,
    summary: {
      totalCandidates: items.length,
      eligible: items.filter(item =>
        item.eligibility.status === 'ELIGIBLE'
      ).length,
      reviewOnly: items.filter(item =>
        item.eligibility.status === 'REVIEW_ONLY'
      ).length,
      ineligible: items.filter(item =>
        item.eligibility.status === 'INELIGIBLE'
      ).length,
    },
    candidates: items,
    warning: null,
    lifecycleWarning: null,
    materializationWarning: null,
    ...overrides,
  };
}

function effectiveness(overrides = {}) {
  return {
    population: {
      totalEvents: 3,
      evaluatedRuns: 3,
      fallbackRuns: 0,
    },
    effects: { appliedEffectRuns: 2 },
    impact: {
      totalOrderAmountDelta: -120,
      totalQuantityDelta: -2,
    },
    activity: {
      lastEvaluatedAt: '2026-07-26T12:00:00.000Z',
      lastAppliedAt: '2026-07-26T12:00:00.000Z',
      consecutiveNoEffectRuns: 0,
    },
    quality: { warnings: [] },
    classification: 'EFFECTIVE',
    explanationCodes: [],
    ...overrides,
  };
}

function materializedRule(overrides = {}) {
  return {
    ruleId: 'rule-1',
    status: 'ACTIVE',
    displayScope: { primary: 'Товар', secondary: 'SKU 1' },
    action: { decision: 'BUY' },
    provenance: {
      materializedAt: '2026-07-20T10:00:00.000Z',
    },
    lifecycle: { status: 'APPROVED' },
    timestamps: { updatedAt: '2026-07-25T10:00:00.000Z' },
    management: {
      lastStatusChangeAt: '2026-07-25T10:00:00.000Z',
    },
    effectiveness: {
      status: 'AVAILABLE',
      classification: 'EFFECTIVE',
    },
    ...overrides,
  };
}

function rules(items = [materializedRule()], overrides = {}) {
  return {
    status: 'AVAILABLE',
    generatedAt: AS_OF,
    summary: {
      totalRules: items.length,
      activeRules: items.filter(item => item.status === 'ACTIVE').length,
      disabledRules:
        items.filter(item => item.status === 'DISABLED').length,
      buyRules:
        items.filter(item => item.action.decision === 'BUY').length,
      skipRules:
        items.filter(item => item.action.decision === 'SKIP').length,
      deferRules:
        items.filter(item => item.action.decision === 'DEFER').length,
    },
    rules: items,
    warning: null,
    centerSnapshot: {
      materializationEvents: [],
      statusEvents: [],
      warnings: [],
    },
    ...overrides,
  };
}

function effectivenessResult(
  items = [{
    ruleId: 'rule-1',
    status: 'ACTIVE',
    decision: 'BUY',
    displayScope: { primary: 'Товар', secondary: 'SKU 1' },
    effectiveness: effectiveness(),
  }],
  overrides = {}
) {
  return {
    status: 'AVAILABLE',
    generatedAt: AS_OF,
    summary: {
      totalRules: items.length,
      totalOrderAmountDelta: items.reduce(
        (total, item) =>
          total +
          item.effectiveness.impact.totalOrderAmountDelta,
        0
      ),
    },
    rules: items,
    warning: null,
    centerSnapshot: { events: [] },
    ...overrides,
  };
}

function lifecycle(states = [], overrides = {}) {
  return {
    summary: {
      lastRecordedAt:
        states.map(state => state.lastRecordedAt).filter(Boolean)
          .sort().at(-1) || null,
    },
    states,
    ...overrides,
  };
}

function createService(overrides = {}) {
  const calls = {
    decisions: [],
    candidates: [],
    lifecycle: [],
    rules: [],
    effectiveness: [],
  };
  const values = {
    decisions: decisions(),
    candidates: candidates(),
    lifecycle: lifecycle(),
    rules: rules(),
    effectiveness: effectivenessResult(),
    ...overrides,
  };
  return {
    calls,
    service: new OwnerLearningCenterService({
      decisionAnalyticsService: {
        getAnalytics(input) {
          calls.decisions.push(input);
          if (values.decisions instanceof Error) throw values.decisions;
          return values.decisions;
        },
      },
      candidatesService: {
        getCandidates(input) {
          calls.candidates.push(input);
          if (values.candidates instanceof Error) throw values.candidates;
          return values.candidates;
        },
      },
      candidateLifecycleService: {
        getCandidateStates(input) {
          calls.lifecycle.push(input);
          if (values.lifecycle instanceof Error) throw values.lifecycle;
          return values.lifecycle;
        },
      },
      materializedRulesService: {
        getCenterSnapshot(input) {
          calls.rules.push(input);
          if (values.rules instanceof Error) throw values.rules;
          return values.rules;
        },
      },
      ruleEffectivenessService: {
        getCenterSnapshot(input) {
          calls.effectiveness.push(input);
          if (values.effectiveness instanceof Error) {
            throw values.effectiveness;
          }
          return values.effectiveness;
        },
      },
      logger: { warn() {} },
      now: () => AS_OF,
    }),
  };
}

test('empty system returns an AVAILABLE healthy overview', () => {
  const { service } = createService({
    decisions: decisions({
      analytics: {
        generatedAt: AS_OF,
        population: { filteredEntries: 0, uniqueItems: 0 },
        agreementAnalysis: { agreementRate: null },
        dataQuality: { warnings: [] },
      },
    }),
    candidates: candidates([]),
    lifecycle: lifecycle([]),
    rules: rules([]),
    effectiveness: effectivenessResult([]),
  });
  const result = service.getOverview();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.systemHealth.overallStatus, 'HEALTHY');
  assert.equal(result.attention.total, 0);
  assert.deepEqual(result.recentActivity, []);
});

test('all component summaries are aggregated without recalculation', () => {
  const items = [
    candidate({
      lifecycle: { status: 'APPROVED', lastRecordedAt: AS_OF },
      materialization: { status: 'MATERIALIZED' },
    }),
    candidate({
      candidateId: 'b'.repeat(64),
      eligibility: { status: 'REVIEW_ONLY' },
      lifecycle: { status: 'POSTPONED', lastRecordedAt: AS_OF },
    }),
    candidate({
      candidateId: 'c'.repeat(64),
      eligibility: { status: 'INELIGIBLE' },
      lifecycle: { status: 'REJECTED', lastRecordedAt: AS_OF },
    }),
  ];
  const materialized = [
    materializedRule(),
    materializedRule({
      ruleId: 'rule-2',
      status: 'DISABLED',
      action: { decision: 'SKIP' },
    }),
    materializedRule({
      ruleId: 'rule-3',
      status: 'ACTIVE',
      action: { decision: 'DEFER' },
    }),
  ];
  const effects = [
    {
      ruleId: 'rule-1',
      effectiveness: effectiveness(),
    },
    {
      ruleId: 'rule-2',
      effectiveness: effectiveness({
        classification: 'STALE',
        impact: { totalOrderAmountDelta: 20 },
      }),
    },
    {
      ruleId: 'rule-3',
      effectiveness: effectiveness({
        classification: 'REVIEW_RECOMMENDED',
        impact: { totalOrderAmountDelta: -10 },
      }),
    },
  ];
  const { service } = createService({
    candidates: candidates(items),
    rules: rules(materialized),
    effectiveness: effectivenessResult(effects),
  });
  const result = service.getOverview();
  assert.deepEqual(result.summary.decisions, {
    total: 8,
    uniqueItems: 3,
    agreementRate: 0.75,
  });
  assert.deepEqual(result.summary.candidates, {
    total: 3,
    eligible: 1,
    reviewOnly: 1,
    ineligible: 1,
    approved: 1,
    postponed: 1,
    rejected: 1,
  });
  assert.deepEqual(result.summary.rules, {
    total: 3,
    active: 2,
    disabled: 1,
    buy: 1,
    skip: 1,
    defer: 1,
  });
  assert.equal(result.summary.effectiveness.effective, 1);
  assert.equal(result.summary.effectiveness.stale, 1);
  assert.equal(result.summary.effectiveness.reviewRecommended, 1);
  assert.equal(result.summary.effectiveness.totalOrderAmountDelta, -110);
});

test('approved candidate without a materialized rule is high attention', () => {
  const item = candidate({
    lifecycle: { status: 'APPROVED', lastRecordedAt: AS_OF },
  });
  const { service } = createService({ candidates: candidates([item]) });
  const result = service.getOverview();
  const attention = result.attention.items.find(value =>
    value.type === 'APPROVED_CANDIDATE_NOT_MATERIALIZED'
  );
  assert.equal(attention.priority, 'HIGH');
  assert.equal(attention.entityId, item.candidateId);
});

test('eligible candidate awaiting review is medium attention', () => {
  const { service } = createService();
  const attention = service.getOverview().attention.items.find(value =>
    value.type === 'CANDIDATE_AWAITING_REVIEW'
  );
  assert.equal(attention.priority, 'MEDIUM');
});

test('postponed candidate is medium attention', () => {
  const item = candidate({
    lifecycle: { status: 'POSTPONED', lastRecordedAt: AS_OF },
  });
  const { service } = createService({ candidates: candidates([item]) });
  const attention = service.getOverview().attention.items.find(value =>
    value.type === 'CANDIDATE_POSTPONED'
  );
  assert.equal(attention.priority, 'MEDIUM');
});

test('active stale rule is high attention', () => {
  const effect = effectiveness({
    classification: 'STALE',
  });
  const { service } = createService({
    effectiveness: effectivenessResult([{
      ruleId: 'rule-1',
      effectiveness: effect,
    }]),
  });
  const attention = service.getOverview().attention.items.find(value =>
    value.type === 'ACTIVE_RULE_STALE'
  );
  assert.equal(attention.priority, 'HIGH');
});

test('review recommended rule with fallback is critical attention', () => {
  const effect = effectiveness({
    population: {
      totalEvents: 5,
      evaluatedRuns: 4,
      fallbackRuns: 1,
    },
    classification: 'REVIEW_RECOMMENDED',
  });
  const { service } = createService({
    effectiveness: effectivenessResult([{
      ruleId: 'rule-1',
      effectiveness: effect,
    }]),
  });
  const attention = service.getOverview().attention.items.find(value =>
    value.type === 'ACTIVE_RULE_REVIEW_RECOMMENDED'
  );
  assert.equal(attention.priority, 'CRITICAL');
  assert.ok(attention.explanationCodes.includes(MANUAL_REVIEW_CODE));
});

test('active no-effect rule is medium attention', () => {
  const effect = effectiveness({
    classification: 'NO_EFFECT_YET',
  });
  const { service } = createService({
    effectiveness: effectivenessResult([{
      ruleId: 'rule-1',
      effectiveness: effect,
    }]),
  });
  const attention = service.getOverview().attention.items.find(value =>
    value.type === 'ACTIVE_RULE_NO_EFFECT_YET'
  );
  assert.equal(attention.priority, 'MEDIUM');
});

test('decision data quality warning creates read-only attention', () => {
  const value = decisions();
  value.analytics.dataQuality.warnings = ['MISSING_REASON'];
  const { service } = createService({ decisions: value });
  const attention = service.getOverview().attention.items.find(item =>
    item.type === 'DECISION_HISTORY_DATA_QUALITY'
  );
  assert.equal(attention.priority, 'LOW');
  assert.ok(attention.explanationCodes.includes('MISSING_REASON'));
});

test('attention IDs are deterministic and ignore object key order', () => {
  const left = digestAttention({
    type: 'TYPE',
    entityType: 'RULE',
    entityId: 'rule-1',
    state: 'ACTIVE',
    sourceVersion: AS_OF,
  });
  const right = digestAttention({
    sourceVersion: AS_OF,
    entityId: 'rule-1',
    entityType: 'RULE',
    state: 'ACTIVE',
    type: 'TYPE',
  });
  assert.equal(left, right);
});

test('attention is sorted by priority then timestamp', () => {
  const items = [
    candidate(),
    candidate({
      candidateId: 'b'.repeat(64),
      lifecycle: {
        status: 'APPROVED',
        lastRecordedAt: '2026-07-26T00:00:00.000Z',
      },
    }),
  ];
  const { service } = createService({ candidates: candidates(items) });
  const result = service.getOverview();
  assert.equal(
    result.attention.items[0].type,
    'APPROVED_CANDIDATE_NOT_MATERIALIZED'
  );
});

test('attention limit is applied after total count', () => {
  const items = Array.from({ length: 4 }, (_, index) =>
    candidate({ candidateId: String(index).repeat(64) })
  );
  const { service } = createService({ candidates: candidates(items) });
  const result = service.getOverview({
    options: { attentionLimit: 2 },
  });
  assert.equal(result.attention.total, 4);
  assert.equal(result.attention.items.length, 2);
});

test('recent lifecycle activity omits private event fields', () => {
  const state = {
    candidateId: 'a'.repeat(64),
    lastRecordedAt: AS_OF,
    lastEvent: {
      recordedAt: AS_OF,
      toStatus: 'APPROVED',
      ownerComment: 'secret',
      metadata: { private: true },
      eventId: 'private-event',
      candidateSnapshot: {
        displayScope: { primary: 'Товар', secondary: 'SKU 1' },
        proposedDecision: 'BUY',
      },
    },
  };
  const { service } = createService({
    lifecycle: lifecycle([state]),
  });
  const activity = service.getOverview().recentActivity[0];
  assert.equal(activity.activityType, 'CANDIDATE_STATUS_CHANGED');
  assert.equal(JSON.stringify(activity).includes('secret'), false);
  assert.equal(JSON.stringify(activity).includes('private-event'), false);
});

test('recent materialization and status activities are combined', () => {
  const value = rules();
  value.centerSnapshot.materializationEvents = [{
    recordedAt: '2026-07-24T00:00:00.000Z',
    ruleId: 'rule-1',
    ruleStatus: 'DISABLED',
    snapshot: { proposedDecision: 'BUY' },
  }];
  value.centerSnapshot.statusEvents = [{
    recordedAt: '2026-07-25T00:00:00.000Z',
    ruleId: 'rule-1',
    toStatus: 'ACTIVE',
    ruleSnapshot: { decision: 'BUY' },
  }];
  const { service } = createService({ rules: value });
  const types = service.getOverview().recentActivity
    .map(item => item.activityType);
  assert.deepEqual(types.slice(0, 2), [
    'RULE_ACTIVATED',
    'RULE_MATERIALIZED',
  ]);
});

test('recent effectiveness events include safe signed deltas', () => {
  const value = effectivenessResult();
  value.centerSnapshot.events = [{
    ruleId: 'rule-1',
    recordedAt: '2026-07-26T00:00:00.000Z',
    effectStatus: 'APPLIED_EFFECT',
    decision: 'BUY',
    scopeSnapshot: { displayPrimary: 'Товар' },
    impact: { orderAmountDelta: -50, quantityDelta: -1 },
    runId: 'private-run-id',
    eventId: 'private-event',
    metadata: { private: true },
  }];
  const { service } = createService({ effectiveness: value });
  const activity = service.getOverview().recentActivity[0];
  assert.equal(activity.activityType, 'RULE_APPLIED_EFFECT');
  assert.equal(activity.amountDelta, -50);
  assert.equal(JSON.stringify(activity).includes('private-run-id'), false);
});

test('activity is sorted deterministically and limited', () => {
  const value = effectivenessResult();
  value.centerSnapshot.events = Array.from({ length: 3 }, (_, index) => ({
    ruleId: 'rule-1',
    recordedAt: `2026-07-2${index + 1}T00:00:00.000Z`,
    effectStatus: 'APPLIED_EFFECT',
    scopeSnapshot: { displayPrimary: `Товар ${index}` },
    impact: {},
  }));
  const { service } = createService({ effectiveness: value });
  const result = service.getOverview({
    options: { activityLimit: 2 },
  });
  assert.equal(result.recentActivity.length, 2);
  assert.equal(
    result.recentActivity[0].recordedAt,
    '2026-07-23T00:00:00.000Z'
  );
});

test('healthy status requires all overview components to be readable', () => {
  const { service } = createService();
  assert.equal(
    service.getOverview().systemHealth.overallStatus,
    'HEALTHY'
  );
});

test('effectiveness unavailable returns PARTIAL and preserves summaries', () => {
  const { service } = createService({
    effectiveness: {
      status: 'UNAVAILABLE',
      generatedAt: null,
      summary: null,
      rules: [],
      warning: 'OWNER_RULE_EFFECTIVENESS_UNAVAILABLE',
    },
  });
  const result = service.getOverview();
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.summary.decisions.total, 8);
  assert.equal(result.summary.effectiveness, null);
  assert.equal(result.systemHealth.overallStatus, 'DEGRADED');
});

test('lifecycle exception returns PARTIAL and other sections remain usable', () => {
  const { service } = createService({
    lifecycle: new Error('private path /tmp/journal'),
  });
  const result = service.getOverview();
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.sections.candidates.count, 1);
  assert.equal(
    result.systemHealth.components.candidateLifecycle.status,
    'UNAVAILABLE'
  );
  assert.equal(JSON.stringify(result).includes('/tmp/journal'), false);
});

test('registry unavailable alone produces a safe PARTIAL overview', () => {
  const { service } = createService({
    rules: {
      status: 'UNAVAILABLE',
      summary: null,
      rules: [],
      warning: 'OWNER_MATERIALIZED_RULES_UNAVAILABLE',
    },
  });
  const result = service.getOverview();
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.summary.rules, null);
});

test('decision history and registry unavailable together are UNAVAILABLE', () => {
  const { service } = createService({
    decisions: {
      status: 'UNAVAILABLE',
      analytics: null,
      warning: 'OWNER_DECISION_ANALYTICS_UNAVAILABLE',
    },
    rules: {
      status: 'UNAVAILABLE',
      summary: null,
      rules: [],
      warning: 'OWNER_MATERIALIZED_RULES_UNAVAILABLE',
    },
  });
  const result = service.getOverview();
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.generatedAt, null);
  assert.equal(result.summary, null);
});

test('section counts and navigation targets are stable', () => {
  const { service } = createService();
  const sections = service.getOverview().sections;
  assert.equal(sections.decisionHistory.count, 8);
  assert.equal(sections.candidates.navigationTarget, 'CANDIDATES');
  assert.equal(
    sections.materializedRules.navigationTarget,
    'MATERIALIZED_RULES'
  );
  assert.equal(
    sections.effectiveness.navigationTarget,
    'RULE_EFFECTIVENESS'
  );
});

test('filters are passed only to compatible service inputs', () => {
  const { service, calls } = createService();
  service.getOverview({
    filters: {
      supplier: 'Валта',
      brand: 'AWARD',
      category: 'Корм',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-27',
    },
  });
  assert.equal(calls.decisions[0].filters.supplier, 'Валта');
  assert.equal(calls.candidates[0].filters.brand, 'AWARD');
  assert.deepEqual(calls.rules[0].filters, {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-27',
  });
  assert.deepEqual(calls.effectiveness[0].filters, {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-27',
  });
});

test('asOf defaults to the now dependency and is shared by services', () => {
  const { service, calls } = createService();
  const result = service.getOverview();
  assert.equal(result.generatedAt, AS_OF);
  assert.equal(calls.candidates[0].confidenceOptions.asOf, AS_OF);
  assert.equal(calls.effectiveness[0].options.asOf, AS_OF);
});

test('strict asOf and limits reject invalid input', () => {
  const { service } = createService();
  assert.throws(
    () => service.getOverview({ options: { asOf: '2026-07-27' } }),
    { code: 'OWNER_LEARNING_CENTER_INVALID_INPUT' }
  );
  assert.throws(
    () => service.getOverview({
      options: { asOf: '2026-02-30T00:00:00.000Z' },
    }),
    { code: 'OWNER_LEARNING_CENTER_INVALID_INPUT' }
  );
  assert.throws(
    () => service.getOverview({ options: { attentionLimit: 0 } }),
    { code: 'OWNER_LEARNING_CENTER_INVALID_INPUT' }
  );
  assert.throws(
    () => service.getOverview({ options: { activityLimit: 101 } }),
    { code: 'OWNER_LEARNING_CENTER_INVALID_INPUT' }
  );
});

test('DTO mapper is allowlist-only and removes sensitive fields', () => {
  const mapped = mapOwnerLearningCenter({
    status: 'AVAILABLE',
    generatedAt: AS_OF,
    summary: {
      decisions: { total: 1, uniqueItems: 1, agreementRate: 1 },
      candidates: {},
      rules: {},
      effectiveness: {},
    },
    attention: {
      total: 1,
      items: [{
        attentionId: 'a'.repeat(64),
        type: 'CANDIDATE_AWAITING_REVIEW',
        priority: 'MEDIUM',
        title: 'Тест',
        description: 'Тест',
        displayScope: { primary: '<img onerror=alert(1)>' },
        entityType: 'CANDIDATE',
        entityId: 'b'.repeat(64),
        navigationTarget: 'CANDIDATES',
        createdAt: AS_OF,
        explanationCodes: [MANUAL_REVIEW_CODE],
        ownerComment: 'secret',
        metadata: { secret: true },
        fingerprints: ['secret'],
        path: '/private/path',
      }],
    },
    recentActivity: [{
      activityType: 'RULE_APPLIED_EFFECT',
      recordedAt: AS_OF,
      displayScope: { primary: 'Товар' },
      description: 'Тест',
      status: 'APPLIED_EFFECT',
      decision: 'BUY',
      amountDelta: -1,
      quantityDelta: -1,
      navigationTarget: 'RULE_EFFECTIVENESS',
      runId: 'private',
      eventId: 'private',
    }],
    systemHealth: {
      overallStatus: 'HEALTHY',
      components: {},
      dataQualityWarnings: [],
    },
    sections: {},
    warnings: [],
  });
  const serialized = JSON.stringify(mapped);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('/private/path'), false);
  assert.equal(serialized.includes('runId'), false);
  assert.equal(serialized.includes('eventId'), false);
  assert.equal(
    mapped.attention.items[0].display_scope.primary,
    '<img onerror=alert(1)>'
  );
});

test('normalization is deterministic for an explicit asOf', () => {
  const input = {
    filters: { supplier: ' Валта ' },
    options: { asOf: AS_OF },
  };
  assert.deepEqual(
    normalizeInput(input, () => {
      throw new Error('now must not be called');
    }),
    normalizeInput(input, () => {
      throw new Error('now must not be called');
    })
  );
});
