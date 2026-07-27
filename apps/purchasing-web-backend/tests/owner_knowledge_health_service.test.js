const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  OwnerKnowledgeHealthService,
} = require('../application/owner_knowledge_health_service');
const {
  mapKnowledgeHealth,
} = require('../dto/owner_knowledge_health_mapper');

const AS_OF = '2026-07-01T00:00:00.000Z';

function rule(id, overrides = {}) {
  const decision = overrides.decision || 'BUY';
  return {
    ruleId: id,
    proposalId: `proposal-${id}`,
    status: overrides.status || 'ACTIVE',
    ruleType: 'ITEM_DECISION_OVERRIDE',
    stableItemKey: overrides.scopeKey || `sku:${id}`,
    scopeType: 'ITEM',
    scopeKey: overrides.scopeKey || `sku:${id}`,
    name: overrides.name || `Товар ${id}`,
    approvedDecision: decision,
    action: {
      decision,
      quantityStrategy: decision === 'BUY'
        ? 'KEEP_AGENT_QUANTITY'
        : 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    source: 'OWNER_LEARNING_CANDIDATE',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ||
      '2026-06-01T00:00:00.000Z',
    provenance: {
      candidateId: `candidate-${id}`,
      confidenceLevel: overrides.confidenceLevel || 'HIGH',
      priorityLevel: overrides.priorityLevel || 'HIGH',
      ownerComment: '<script>bad()</script>',
      rawPath: '/private/data',
    },
  };
}

function snapshot(rules, overrides = {}) {
  const validRules = rules.filter(value =>
    value && typeof value === 'object' && !Array.isArray(value)
  );
  return {
    status: overrides.status || 'AVAILABLE',
    generatedAt: AS_OF,
    rules,
    materializations: validRules.map(value => ({
      materializationId: `mat-${value.ruleId}`,
      ruleId: value.ruleId,
    })),
    lifecycleStates: validRules.map(value => ({
      candidateId: value.provenance.candidateId,
      status: 'APPROVED',
    })),
    effectivenessSummaries: validRules.map(value => ({
      ruleId: value.ruleId,
      effectiveness: {
        classification: 'EFFECTIVE',
        population: { totalEvents: 5, evaluatedRuns: 5 },
        effects: { appliedEffectRuns: 4 },
        activity: {
          lastAppliedAt: '2026-06-25T00:00:00.000Z',
          daysSinceLastApplied: 6,
          consecutiveNoEffectRuns: 0,
        },
      },
    })),
    statusEvents: validRules.map(value => ({
      ruleId: value.ruleId,
      toStatus: value.status,
      recordedAt: '2026-06-02T00:00:00.000Z',
    })),
    warnings: overrides.warnings || [],
  };
}

function service(result) {
  return new OwnerKnowledgeHealthService({
    materializedRulesService: {
      getKnowledgeHealthSnapshot() {
        if (result instanceof Error) throw result;
        return structuredClone(result);
      },
    },
    logger: { warn() {} },
    now: () => new Date(AS_OF),
  });
}

test('service returns AVAILABLE and analyzes snapshot once', () => {
  let calls = 0;
  const instance = new OwnerKnowledgeHealthService({
    materializedRulesService: {
      getKnowledgeHealthSnapshot() {
        calls += 1;
        return snapshot([rule('one')]);
      },
    },
    now: () => new Date(AS_OF),
  });
  const result = instance.getKnowledgeHealth();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.score, 100);
  assert.equal(calls, 1);
});

test('partial snapshot remains PARTIAL with usable rules', () => {
  const result = service(snapshot([rule('one')], {
    status: 'PARTIAL',
    warnings: ['OWNER_RULE_EFFECTIVENESS_UNAVAILABLE'],
  })).getKnowledgeHealth();
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.rules.length, 1);
  assert.deepEqual(result.warnings, [
    'OWNER_RULE_EFFECTIVENESS_UNAVAILABLE',
  ]);
});

test('service and DTO preserve invalid rule data-quality count', () => {
  const result = service(snapshot([
    null,
    rule('valid'),
    'bad',
  ])).getKnowledgeHealth();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.rules.length, 1);
  assert.equal(result.dataQuality.invalidRules, 2);
  assert.ok(result.dataQuality.warnings.includes(
    'DATA_QUALITY_INVALID_RULES'
  ));
  assert.equal(mapKnowledgeHealth(result).data_quality.invalid_rules, 2);
});

test('unavailable and thrown source failures have safe contracts', () => {
  const unavailable = service({
    status: 'UNAVAILABLE',
    warnings: ['OWNER_MATERIALIZED_RULES_UNAVAILABLE'],
  }).getKnowledgeHealth();
  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.deepEqual(unavailable.rules, []);
  const failure = service(new Error('/private/secret')).getKnowledgeHealth();
  assert.equal(failure.status, 'UNAVAILABLE');
  assert.deepEqual(failure.warnings, [
    'OWNER_KNOWLEDGE_HEALTH_UNAVAILABLE',
  ]);
});

test('filters apply to status, decision and search', () => {
  const instance = service(snapshot([
    rule('buy', { name: '<b>Искомый товар</b>' }),
    rule('skip', { decision: 'SKIP', status: 'DISABLED' }),
  ]));
  const result = instance.getKnowledgeHealth({
    filters: {
      status: 'active',
      decision: 'buy',
      search: 'искомый',
    },
  });
  assert.deepEqual(result.rules.map(value => value.ruleId), ['buy']);
});

test('classification, confidence and finding filters apply', () => {
  const instance = service(snapshot([
    rule('high'),
    rule('low', { confidenceLevel: 'LOW' }),
  ]));
  const result = instance.getKnowledgeHealth({
    filters: {
      confidenceLevel: 'LOW',
      findingType: 'RULE_LOW_CONFIDENCE',
      severity: 'MEDIUM',
    },
  });
  assert.deepEqual(result.rules.map(value => value.ruleId), ['low']);
  assert.ok(result.findings.every(value =>
    value.type === 'RULE_LOW_CONFIDENCE' &&
    value.severity === 'MEDIUM'
  ));
});

test('default sorting is severity desc, score asc, ruleId asc', () => {
  const result = service(snapshot([
    rule('z-healthy'),
    rule('b-low', { confidenceLevel: 'LOW' }),
    rule('a-low', { confidenceLevel: 'LOW' }),
  ])).getKnowledgeHealth();
  assert.deepEqual(result.rules.map(value => value.ruleId), [
    'a-low',
    'b-low',
    'z-healthy',
  ]);
});

test('explicit score sorting and limit work', () => {
  const result = service(snapshot([
    rule('healthy'),
    rule('low', { confidenceLevel: 'LOW' }),
  ])).getKnowledgeHealth({
    options: {
      sortBy: 'score',
      sortDirection: 'asc',
      limit: 1,
    },
  });
  assert.deepEqual(result.rules.map(value => value.ruleId), ['low']);
});

test('detail returns exact rule and not-found is controlled', () => {
  const instance = service(snapshot([rule('one')]));
  assert.equal(instance.getRuleHealth({
    ruleId: 'one',
    options: { asOf: AS_OF },
  }).rule.ruleId, 'one');
  assert.throws(
    () => instance.getRuleHealth({ ruleId: 'missing' }),
    error => error.code === 'OWNER_KNOWLEDGE_HEALTH_RULE_NOT_FOUND'
  );
});

test('findings endpoint projection contains only findings', () => {
  const result = service(snapshot([
    rule('low', { confidenceLevel: 'LOW' }),
  ])).getFindings({
    filters: { findingType: 'RULE_LOW_CONFIDENCE' },
  });
  assert.equal(result.status, 'AVAILABLE');
  assert.deepEqual(result.findings.map(value => value.type), [
    'RULE_LOW_CONFIDENCE',
  ]);
  assert.equal(Object.hasOwn(result, 'rules'), false);
});

test('invalid filters, sorting, limit and asOf are controlled', () => {
  const instance = service(snapshot([]));
  for (const input of [
    { filters: { unknown: 'x' } },
    { options: { sortBy: 'unknown' } },
    { options: { limit: 0 } },
    { options: { asOf: '2026-01-01' } },
  ]) {
    assert.throws(
      () => instance.getKnowledgeHealth(input),
      error => error.code ===
        'OWNER_KNOWLEDGE_HEALTH_INVALID_INPUT'
    );
  }
});

test('DTO is allowlist-only and omits provenance and technical journals', () => {
  const result = service(snapshot([
    rule('safe', { name: '<img src=x onerror=bad()>' }),
  ])).getKnowledgeHealth();
  const dto = mapKnowledgeHealth(result);
  const serialized = JSON.stringify(dto);
  assert.equal(dto.status, 'AVAILABLE');
  assert.equal(dto.rules[0].display_scope.primary,
    '<img src=x onerror=bad()>');
  for (const forbidden of [
    'stableItemKey',
    'scopeKey',
    'materializationId',
    'ownerComment',
    'rawPath',
    '"provenance":',
    '"metadata":',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
