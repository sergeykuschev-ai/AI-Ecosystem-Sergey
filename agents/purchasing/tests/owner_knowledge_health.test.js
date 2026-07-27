const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  DIMENSION_WEIGHTS,
  analyzeKnowledgeHealth,
  analyzeRuleHealth,
  detectRuleConflicts,
  detectRuleDuplicates,
  getKnowledgeHealthGrade,
} = require('../owner_learning/owner_knowledge_health');

const AS_OF = '2026-07-01T00:00:00.000Z';

function rule(id, overrides = {}) {
  const decision = overrides.decision || 'BUY';
  return {
    ruleId: id,
    proposalId: `proposal-${id}`,
    status: overrides.status || 'ACTIVE',
    ruleType: overrides.ruleType || 'ITEM_DECISION_OVERRIDE',
    stableItemKey: overrides.scopeKey || `sku:${id}`,
    scopeType: overrides.scopeType || 'ITEM',
    scopeKey: overrides.scopeKey || `sku:${id}`,
    name: overrides.name || `Товар ${id}`,
    approvedDecision: decision,
    action: {
      decision,
      quantityStrategy: overrides.quantityStrategy || (
        decision === 'BUY'
          ? 'KEEP_AGENT_QUANTITY'
          : 'NO_QUANTITY_CHANGE'
      ),
      quantityValue: overrides.quantityValue ?? null,
    },
    source: overrides.source === undefined
      ? 'OWNER_LEARNING_CANDIDATE'
      : overrides.source,
    createdAt:
      overrides.createdAt || '2026-06-01T00:00:00.000Z',
    updatedAt:
      overrides.updatedAt || '2026-06-01T00:00:00.000Z',
    approvedAt:
      overrides.approvedAt || '2026-06-01T00:00:00.000Z',
    provenance: overrides.provenance === undefined
      ? {
        candidateId: `candidate-${id}`,
        confidenceLevel: overrides.confidenceLevel || 'HIGH',
        priorityLevel: overrides.priorityLevel || 'HIGH',
      }
      : overrides.provenance,
  };
}

function effectiveness(id, overrides = {}) {
  return {
    ruleId: id,
    effectiveness: {
      classification: overrides.classification || 'EFFECTIVE',
      population: {
        totalEvents: overrides.totalEvents ?? 5,
        evaluatedRuns: overrides.evaluatedRuns ?? 5,
      },
      effects: {
        appliedEffectRuns: overrides.appliedEffectRuns ?? 4,
      },
      activity: {
        lastAppliedAt:
          overrides.lastAppliedAt || '2026-06-25T00:00:00.000Z',
        daysSinceLastApplied: overrides.daysSinceLastApplied ?? 6,
        consecutiveNoEffectRuns:
          overrides.consecutiveNoEffectRuns ?? 0,
      },
    },
  };
}

function input(rules, overrides = {}) {
  return {
    rules,
    materializations: overrides.materializations ?? rules
      .filter(value => value && typeof value === 'object')
      .map(value => ({
        materializationId: `materialization-${value.ruleId}`,
        ruleId: value.ruleId,
      })),
    lifecycleStates: overrides.lifecycleStates ?? rules
      .filter(value => value && typeof value === 'object')
      .map(value => ({
      candidateId: value.provenance?.candidateId,
      status: 'APPROVED',
    })).filter(value => value.candidateId),
    effectivenessSummaries:
      overrides.effectivenessSummaries ??
      rules.filter(value => value && typeof value === 'object')
        .map(value => effectiveness(value.ruleId)),
    statusEvents: overrides.statusEvents ?? rules
      .filter(value => value && typeof value === 'object')
      .map(value => ({
      eventId: `status-${value.ruleId}`,
      ruleId: value.ruleId,
      toStatus: value.status,
      recordedAt: '2026-06-02T00:00:00.000Z',
      })),
    options: {
      asOf: AS_OF,
      ...(overrides.options || {}),
    },
  };
}

test('empty rules return deterministic perfect observational health', () => {
  const result = analyzeKnowledgeHealth(input([]));
  assert.equal(result.score, 100);
  assert.equal(result.grade, 'EXCELLENT');
  assert.equal(result.summary.totalRules, 0);
  assert.deepEqual(result.findings, []);
});

for (const [name, invalidRule] of [
  ['null', null],
  ['undefined', undefined],
  ['primitive string', 'bad'],
]) {
  test(`${name} rule entry is counted and skipped fail-soft`, () => {
    const result = analyzeKnowledgeHealth(input([invalidRule]));
    assert.equal(result.summary.totalRules, 0);
    assert.equal(result.dataQuality.invalidRules, 1);
    assert.ok(result.dataQuality.warnings.includes(
      'DATA_QUALITY_INVALID_RULES'
    ));
    assert.deepEqual(result.ruleHealth, []);
  });
}

test('mixed valid and invalid rules preserve valid rule analysis', () => {
  const valid = rule('valid');
  const result = analyzeKnowledgeHealth(input([
    null,
    valid,
    42,
    undefined,
  ]));
  assert.equal(result.summary.totalRules, 1);
  assert.equal(result.dataQuality.invalidRules, 3);
  assert.equal(result.ruleHealth.length, 1);
  assert.equal(result.ruleHealth[0].ruleId, 'valid');
  assert.equal(result.ruleHealth[0].classification, 'HEALTHY');
});

test('invalid rules cannot create conflicts or duplicates', () => {
  const result = analyzeKnowledgeHealth(input([
    rule('valid'),
    null,
    'bad',
  ]));
  assert.equal(result.summary.conflictGroups, 0);
  assert.equal(result.summary.duplicateGroups, 0);
  assert.equal(result.findings.some(value =>
    ['RULE_CONFLICT', 'RULE_DUPLICATE'].includes(value.type)
  ), false);
});

test('analysis with invalid rules remains deterministic', () => {
  const data = input([undefined, rule('valid'), 'bad']);
  assert.deepEqual(
    analyzeKnowledgeHealth(data),
    analyzeKnowledgeHealth(data)
  );
});

test('analysis with invalid rules does not mutate input', () => {
  const data = input([null, rule('valid'), 'bad']);
  const before = structuredClone(data);
  analyzeKnowledgeHealth(data);
  assert.deepEqual(data, before);
});

test('healthy single rule is classified HEALTHY', () => {
  const result = analyzeKnowledgeHealth(input([rule('one')]));
  assert.equal(result.ruleHealth[0].classification, 'HEALTHY');
  assert.equal(result.ruleHealth[0].score, 100);
  assert.equal(result.summary.healthyRules, 1);
});

test('BUY and SKIP active rules for one item conflict', () => {
  const rules = [
    rule('buy', { scopeKey: 'sku:one', decision: 'BUY' }),
    rule('skip', { scopeKey: 'sku:one', decision: 'SKIP' }),
  ];
  const conflicts = detectRuleConflicts({
    rules,
    options: { asOf: AS_OF },
  });
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].decisions, ['BUY', 'SKIP']);
  assert.equal(conflicts[0].safeScopeHash.length, 64);
  assert.equal(Object.hasOwn(conflicts[0], 'stableItemKey'), false);
});

test('findings expose only the required read navigation targets', () => {
  const rules = [
    rule('buy', { scopeKey: 'sku:one', decision: 'BUY' }),
    rule('skip', { scopeKey: 'sku:one', decision: 'SKIP' }),
    rule('missing', { provenance: null }),
    rule('stale'),
  ];
  const result = analyzeKnowledgeHealth(input(rules, {
    effectivenessSummaries: [
      effectiveness('buy'),
      effectiveness('skip'),
      effectiveness('missing'),
      effectiveness('stale', { classification: 'STALE' }),
    ],
  }));
  const target = type => result.findings.find(
    value => value.type === type
  )?.navigationTarget;
  assert.equal(target('RULE_CONFLICT'), 'MATERIALIZED_RULES');
  assert.equal(target('RULE_MISSING_PROVENANCE'), 'MATERIALIZED_RULES');
  assert.equal(target('RULE_STALE'), 'RULE_EFFECTIVENESS');
});

test('BUY and DEFER active rules for one item conflict', () => {
  const rules = [
    rule('buy', { scopeKey: 'sku:one', decision: 'BUY' }),
    rule('defer', { scopeKey: 'sku:one', decision: 'DEFER' }),
  ];
  assert.equal(detectRuleConflicts({
    rules,
    options: { asOf: AS_OF },
  }).length, 1);
});

test('different quantity strategies for the same action conflict', () => {
  const rules = [
    rule('one', { scopeKey: 'sku:one' }),
    rule('two', {
      scopeKey: 'sku:one',
      quantityStrategy: 'FIXED',
      quantityValue: 3,
    }),
  ];
  assert.equal(detectRuleConflicts({
    rules,
    options: { asOf: AS_OF },
  }).length, 1);
});

test('separate items do not conflict', () => {
  assert.deepEqual(detectRuleConflicts({
    rules: [rule('one'), rule('two', { decision: 'SKIP' })],
    options: { asOf: AS_OF },
  }), []);
});

for (const [name, statuses, expectedType] of [
  ['active', ['ACTIVE', 'ACTIVE'], 'ACTIVE_DUPLICATE'],
  ['disabled', ['DISABLED', 'DISABLED'], 'DISABLED_DUPLICATE'],
  ['mixed', ['ACTIVE', 'DISABLED'], 'MIXED_STATUS_DUPLICATE'],
]) {
  test(`${name} duplicates have the expected type`, () => {
    const rules = statuses.map((status, index) => rule(
      `${name}-${index}`,
      { status, scopeKey: 'sku:duplicate' }
    ));
    const duplicates = detectRuleDuplicates({
      rules,
      options: { asOf: AS_OF },
    });
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0].duplicateType, expectedType);
  });
}

test('low confidence and low priority produce review signals', () => {
  const result = analyzeKnowledgeHealth(input([
    rule('low', {
      confidenceLevel: 'LOW',
      priorityLevel: 'LOW',
    }),
  ]));
  const types = result.findings.map(value => value.type);
  assert.ok(types.includes('RULE_LOW_CONFIDENCE'));
  assert.ok(types.includes('RULE_LOW_PRIORITY'));
});

test('stale and old rules are detected independently', () => {
  const value = rule('old', {
    updatedAt: '2024-01-01T00:00:00.000Z',
  });
  const result = analyzeKnowledgeHealth(input([value], {
    effectivenessSummaries: [effectiveness('old', {
      classification: 'STALE',
      lastAppliedAt: '2025-01-01T00:00:00.000Z',
      daysSinceLastApplied: 546,
    })],
  }));
  const types = result.findings.map(item => item.type);
  assert.ok(types.includes('RULE_STALE'));
  assert.ok(types.includes('RULE_LAST_UPDATED_TOO_OLD'));
});

test('no-effect and never-applied rules are detected', () => {
  const result = analyzeKnowledgeHealth(input([rule('none')], {
    effectivenessSummaries: [effectiveness('none', {
      classification: 'NO_EFFECT_YET',
      appliedEffectRuns: 0,
      evaluatedRuns: 5,
      totalEvents: 5,
    })],
  }));
  const types = result.findings.map(item => item.type);
  assert.ok(types.includes('RULE_NO_EFFECT'));
  assert.ok(types.includes('ACTIVE_RULE_NEVER_APPLIED'));
});

test('review recommended effectiveness is a high finding', () => {
  const result = analyzeKnowledgeHealth(input([rule('review')], {
    effectivenessSummaries: [effectiveness('review', {
      classification: 'REVIEW_RECOMMENDED',
    })],
  }));
  assert.equal(
    result.findings.find(item =>
      item.type === 'RULE_REVIEW_RECOMMENDED'
    ).severity,
    'HIGH'
  );
});

test('missing provenance and materialization are reported', () => {
  const result = analyzeKnowledgeHealth(input([
    rule('missing', { provenance: null }),
  ], {
    materializations: [],
    lifecycleStates: [],
  }));
  const types = result.findings.map(item => item.type);
  assert.ok(types.includes('RULE_MISSING_PROVENANCE'));
  assert.ok(types.includes('RULE_MATERIALIZATION_MISSING'));
});

test('lifecycle and status history inconsistencies are reported', () => {
  const value = rule('inconsistent');
  const result = analyzeKnowledgeHealth(input([value], {
    lifecycleStates: [{
      candidateId: 'candidate-inconsistent',
      status: 'REJECTED',
    }],
    statusEvents: [{
      ruleId: 'inconsistent',
      toStatus: 'DISABLED',
      recordedAt: '2026-06-02T00:00:00.000Z',
    }],
  }));
  const types = result.findings.map(item => item.type);
  assert.ok(types.includes('RULE_LIFECYCLE_INCONSISTENT'));
  assert.ok(types.includes('RULE_STATUS_HISTORY_INCONSISTENT'));
});

test('active without effectiveness and disabled with events are detected', () => {
  const active = analyzeKnowledgeHealth(input([rule('active')], {
    effectivenessSummaries: [],
  }));
  assert.ok(active.findings.some(item =>
    item.type === 'ACTIVE_RULE_WITHOUT_EFFECT_DATA'
  ));
  const disabled = analyzeKnowledgeHealth(input([
    rule('disabled', { status: 'DISABLED' }),
  ]));
  assert.ok(disabled.findings.some(item =>
    item.type === 'DISABLED_RULE_WITH_EFFECT_EVENTS'
  ));
});

test('unsupported type and damaged fields become findings, not crashes', () => {
  const damaged = rule('damaged', {
    ruleType: 'GLOBAL_PROMPT',
    scopeType: 'GLOBAL',
  });
  damaged.scopeKey = null;
  damaged.stableItemKey = null;
  damaged.updatedAt = 'invalid';
  damaged.name = null;
  damaged.approvedDecision = 'UNKNOWN';
  damaged.action.decision = 'UNKNOWN';
  const result = analyzeKnowledgeHealth(input([damaged]));
  const types = result.findings.map(item => item.type);
  assert.ok(types.includes('RULE_UNSUPPORTED_TYPE'));
  assert.ok(types.includes('RULE_SCOPE_TOO_BROAD'));
  assert.ok(types.includes('RULE_DATA_QUALITY_ISSUE'));
});

test('dimension weights and weighted score are exact', () => {
  const result = analyzeKnowledgeHealth(input([
    rule('low', { confidenceLevel: 'LOW' }),
  ]));
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.dimensions).map(
      ([name, value]) => [name, value.weight]
    )),
    DIMENSION_WEIGHTS
  );
  const expected = Math.round(
    Object.values(result.dimensions).reduce(
      (total, value) => total + value.score * value.weight,
      0
    ) / 100
  );
  assert.equal(result.score, expected);
});

test('grade boundaries are stable', () => {
  assert.equal(getKnowledgeHealthGrade(100), 'EXCELLENT');
  assert.equal(getKnowledgeHealthGrade(90), 'EXCELLENT');
  assert.equal(getKnowledgeHealthGrade(89), 'GOOD');
  assert.equal(getKnowledgeHealthGrade(75), 'GOOD');
  assert.equal(getKnowledgeHealthGrade(74), 'FAIR');
  assert.equal(getKnowledgeHealthGrade(50), 'FAIR');
  assert.equal(getKnowledgeHealthGrade(49), 'POOR');
  assert.equal(getKnowledgeHealthGrade(25), 'POOR');
  assert.equal(getKnowledgeHealthGrade(24), 'CRITICAL');
  assert.equal(getKnowledgeHealthGrade(0), 'CRITICAL');
});

test('finding IDs and complete analysis are deterministic', () => {
  const data = input([
    rule('one', { scopeKey: 'sku:same' }),
    rule('two', { scopeKey: 'sku:same', decision: 'SKIP' }),
  ]);
  assert.deepEqual(
    analyzeKnowledgeHealth(data),
    analyzeKnowledgeHealth(data)
  );
});

test('input is not mutated', () => {
  const data = input([rule('one')]);
  const before = structuredClone(data);
  analyzeKnowledgeHealth(data);
  assert.deepEqual(data, before);
});

test('data quality counts duplicate IDs and all orphan types', () => {
  const first = rule('duplicate');
  const second = rule('duplicate');
  const result = analyzeKnowledgeHealth(input([first, second], {
    materializations: [{ ruleId: 'orphan' }],
    lifecycleStates: [{
      candidateId: 'orphan-candidate',
      status: 'APPROVED',
    }],
    statusEvents: [{ ruleId: 'orphan', toStatus: 'ACTIVE' }],
    effectivenessSummaries: [{ ruleId: 'orphan' }],
  }));
  assert.deepEqual(result.dataQuality.duplicateRuleIds, ['duplicate']);
  assert.equal(result.dataQuality.orphanMaterializations, 1);
  assert.equal(result.dataQuality.orphanLifecycleStates, 1);
  assert.equal(result.dataQuality.orphanStatusEvents, 1);
  assert.equal(result.dataQuality.orphanEffectivenessSummaries, 1);
});

test('invalid top-level arrays, asOf and thresholds are controlled', () => {
  assert.throws(
    () => analyzeKnowledgeHealth({ rules: [] }),
    error => error.code === 'OWNER_KNOWLEDGE_HEALTH_INVALID_INPUT'
  );
  assert.throws(
    () => analyzeKnowledgeHealth(input([], {
      options: { asOf: '2026-01-01' },
    })),
    error => error.code === 'OWNER_KNOWLEDGE_HEALTH_INVALID_INPUT'
  );
  assert.throws(
    () => analyzeKnowledgeHealth(input([], {
      options: { staleRuleAfterDays: 0 },
    })),
    error => error.code === 'OWNER_KNOWLEDGE_HEALTH_INVALID_INPUT'
  );
});

test('analyzeRuleHealth exposes the required signals', () => {
  const value = rule('detail');
  const data = input([value]);
  const result = analyzeRuleHealth({
    rule: value,
    context: data,
    options: data.options,
  });
  assert.equal(result.ruleId, 'detail');
  assert.equal(result.signals.provenanceAvailable, true);
  assert.equal(result.signals.materializationAvailable, true);
  assert.equal(result.signals.statusHistoryAvailable, true);
});
