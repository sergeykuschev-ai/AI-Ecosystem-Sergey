const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  CANDIDATE_SCHEMA_VERSION,
  OwnerRuleCandidateRankingError,
  buildAndRankRuleCandidates,
  buildRuleCandidates,
  getCandidatePriorityLevel,
  rankRuleCandidates,
} = require(
  '../owner_learning/owner_rule_candidate_ranking'
);

const AS_OF = '2026-07-25T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysBefore(days) {
  return new Date(Date.parse(AS_OF) - days * DAY_MS).toISOString();
}

function levelForScore(score) {
  if (score <= 24) return 'LOW';
  if (score <= 49) return 'MEDIUM';
  if (score <= 74) return 'HIGH';
  return 'VERY_HIGH';
}

function pattern(overrides = {}) {
  return {
    patternType: 'SAME_ITEM_SAME_DECISION',
    scopeType: 'ITEM',
    scopeKey: 'sku:SKU-1',
    occurrences: 4,
    dominantValue: 'BUY',
    share: 0.8,
    evidenceDecisionIds: [
      'decision-001',
      'decision-002',
      'decision-003',
      'decision-004',
    ],
    firstRecordedAt: isoDaysBefore(120),
    lastRecordedAt: isoDaysBefore(5),
    ...overrides,
  };
}

function confidence(patternValue = pattern(), overrides = {}) {
  const score = overrides.confidenceScore ?? 80;
  const evidenceOverrides = overrides.evidence || {};
  const componentOverrides = overrides.components || {};
  const contradictionOverrides = overrides.contradictions || {};
  const qualityOverrides = overrides.dataQuality || {};
  return {
    schemaVersion: 'owner-learning-confidence-v0.8.1',
    patternType: patternValue.patternType,
    scopeType: patternValue.scopeType,
    scopeKey: patternValue.scopeKey,
    confidenceScore: score,
    confidenceLevel:
      overrides.confidenceLevel ?? levelForScore(score),
    evidence: {
      occurrences: patternValue.occurrences,
      totalRelevantEntries: patternValue.occurrences,
      dominantShare: Number.isFinite(patternValue.share)
        ? patternValue.share
        : 0.8,
      supportingDecisionIdsCount: patternValue.occurrences,
      firstRecordedAt: isoDaysBefore(120),
      lastRecordedAt: isoDaysBefore(5),
      historySpanDays: 115,
      ...evidenceOverrides,
    },
    components: {
      occurrenceScore: 15,
      dominanceScore: 20,
      recencyScore: 15,
      consistencyScore: 20,
      durationScore: 9,
      contradictionPenalty: 0,
      dataQualityPenalty: 0,
      ...componentOverrides,
    },
    contradictions: {
      count: 0,
      share: 0,
      decisionIds: [],
      ...contradictionOverrides,
    },
    dataQuality: {
      missingDates: 0,
      unsupportedValues: 0,
      duplicateDecisionIds: 0,
      insufficientEvidence: false,
      warnings: [],
      ...qualityOverrides,
    },
    explanationCodes: [
      'CONFIDENCE_DESCRIBES_HISTORICAL_PATTERN_STRENGTH',
    ],
  };
}

function historyEntry(sequence, overrides = {}) {
  return {
    decisionId: `decision-${String(sequence).padStart(3, '0')}`,
    recordedAt: isoDaysBefore(30 - sequence),
    stableItemKey: 'sku:SKU-1',
    brand: 'Alpha',
    supplier: 'Supplier A',
    ownerDecision: 'BUY',
    reasonCode: 'OTHER',
    agentRecommendation: 'BUY',
    agentQuantity: 5,
    ownerQuantity: 7,
    ownerComment: 'Скрытый комментарий',
    metadata: { private: true },
    ...overrides,
  };
}

function defaultHistory() {
  return Array.from({ length: 4 }, (_, index) =>
    historyEntry(index + 1)
  );
}

function build({
  patterns,
  evaluations,
  history,
  options,
} = {}) {
  const patternValues = patterns || [pattern()];
  const confidenceValues = evaluations === undefined
    ? patternValues.map(value => confidence(value))
    : evaluations;
  return buildRuleCandidates({
    analytics: { repeatedDecisionPatterns: patternValues },
    confidenceEvaluations: confidenceValues,
    history: history || defaultHistory(),
    options,
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function invalidError(error) {
  return error instanceof OwnerRuleCandidateRankingError &&
    error.code === 'OWNER_RULE_CANDIDATE_RANKING_INVALID_INPUT';
}

test('empty pattern list produces no candidates', () => {
  assert.deepEqual(build({ patterns: [], evaluations: [] }), []);
});

test('SAME_ITEM_SAME_DECISION becomes an item override candidate', () => {
  const [candidate] = build();
  assert.equal(candidate.schemaVersion, CANDIDATE_SCHEMA_VERSION);
  assert.equal(candidate.proposedRuleType, 'ITEM_DECISION_OVERRIDE');
  assert.equal(candidate.scopeType, 'ITEM');
  assert.equal(candidate.scopeKey, 'sku:SKU-1');
  assert.equal(candidate.proposedAction.decision, 'BUY');
});

test('SAME_ITEM_SAME_REASON is REVIEW_ONLY guidance', () => {
  const value = pattern({
    patternType: 'SAME_ITEM_SAME_REASON',
    dominantValue: 'LOW_SALES',
  });
  const [candidate] = build({ patterns: [value] });
  assert.equal(candidate.proposedRuleType, 'ITEM_REVIEW_GUIDANCE');
  assert.equal(candidate.proposedAction.decision, null);
  assert.equal(candidate.eligibility.status, 'REVIEW_ONLY');
});

test('BRAND_DECISION_BIAS is REVIEW_ONLY guidance', () => {
  const value = pattern({
    patternType: 'BRAND_DECISION_BIAS',
    scopeType: 'BRAND',
    scopeKey: 'Alpha',
  });
  const [candidate] = build({ patterns: [value] });
  assert.equal(candidate.proposedRuleType, 'BRAND_DECISION_GUIDANCE');
  assert.equal(candidate.proposedAction.decision, 'BUY');
  assert.equal(candidate.eligibility.status, 'REVIEW_ONLY');
});

test('SUPPLIER_DECISION_BIAS is REVIEW_ONLY guidance', () => {
  const value = pattern({
    patternType: 'SUPPLIER_DECISION_BIAS',
    scopeType: 'SUPPLIER',
    scopeKey: 'Supplier A',
  });
  const [candidate] = build({ patterns: [value] });
  assert.equal(
    candidate.proposedRuleType,
    'SUPPLIER_DECISION_GUIDANCE'
  );
  assert.equal(candidate.eligibility.status, 'REVIEW_ONLY');
});

test('AGENT_DISAGREEMENT_REPEAT is REVIEW_ONLY guidance', () => {
  const value = pattern({
    patternType: 'AGENT_DISAGREEMENT_REPEAT',
    dominantValue: 'BUY->SKIP',
  });
  const [candidate] = build({ patterns: [value] });
  assert.equal(
    candidate.proposedRuleType,
    'ITEM_AGENT_DISAGREEMENT_REVIEW'
  );
  assert.equal(candidate.proposedAction.decision, null);
  assert.equal(candidate.eligibility.status, 'REVIEW_ONLY');
});

test('strict item decision candidate is ELIGIBLE', () => {
  const [candidate] = build();
  assert.equal(candidate.eligibility.status, 'ELIGIBLE');
  assert.deepEqual(candidate.eligibility.reasons, [
    'ELIGIBLE_STRICT_CRITERIA_MET',
  ]);
});

test('insufficient confidence makes item candidate REVIEW_ONLY', () => {
  const value = pattern();
  const [candidate] = build({
    patterns: [value],
    evaluations: [confidence(value, { confidenceScore: 45 })],
  });
  assert.equal(candidate.eligibility.status, 'REVIEW_ONLY');
  assert.ok(candidate.eligibility.reasons.includes(
    'CONFIDENCE_BELOW_ELIGIBILITY_THRESHOLD'
  ));
});

test('low dominant share makes item candidate REVIEW_ONLY', () => {
  const value = pattern({ share: 0.7 });
  const evaluation = confidence(value, {
    evidence: { dominantShare: 0.7 },
  });
  const [candidate] = build({
    patterns: [value],
    evaluations: [evaluation],
  });
  assert.equal(candidate.eligibility.status, 'REVIEW_ONLY');
  assert.ok(candidate.eligibility.reasons.includes(
    'DOMINANT_SHARE_BELOW_ELIGIBILITY_THRESHOLD'
  ));
});

test('excessive contradictions make item candidate REVIEW_ONLY', () => {
  const value = pattern();
  const evaluation = confidence(value, {
    contradictions: { count: 2, share: 0.4 },
    components: { contradictionPenalty: 18 },
  });
  const [candidate] = build({
    patterns: [value],
    evaluations: [evaluation],
  });
  assert.equal(candidate.eligibility.status, 'REVIEW_ONLY');
  assert.ok(candidate.eligibility.reasons.includes(
    'CONTRADICTIONS_ABOVE_ELIGIBILITY_THRESHOLD'
  ));
});

test('data-quality penalty makes item candidate REVIEW_ONLY', () => {
  const value = pattern();
  const evaluation = confidence(value, {
    components: { dataQualityPenalty: 10 },
    dataQuality: { duplicateDecisionIds: 1 },
  });
  const [candidate] = build({
    patterns: [value],
    evaluations: [evaluation],
  });
  assert.equal(candidate.eligibility.status, 'REVIEW_ONLY');
  assert.ok(
    candidate.eligibility.reasons.includes('DATA_QUALITY_PRESENT')
  );
});

test('invalid decision creates an INELIGIBLE candidate', () => {
  const value = pattern({ dominantValue: 'REVIEW' });
  const [candidate] = build({
    patterns: [value],
    evaluations: [confidence(value)],
  });
  assert.equal(candidate.eligibility.status, 'INELIGIBLE');
  assert.equal(candidate.proposedAction.decision, null);
  assert.ok(candidate.eligibility.reasons.includes(
    'INVALID_DOMINANT_VALUE'
  ));
});

test('missing confidence evaluation creates safe zero-priority candidate', () => {
  const [candidate] = build({ evaluations: [] });
  assert.equal(candidate.eligibility.status, 'INELIGIBLE');
  assert.deepEqual(candidate.confidence, { score: null, level: null });
  assert.equal(candidate.ranking.priorityScore, 0);
  assert.ok(candidate.explanationCodes.includes(
    'CONFIDENCE_EVALUATION_MISSING'
  ));
});

test('LOW confidence with insufficient evidence is INELIGIBLE', () => {
  const value = pattern({ occurrences: 1 });
  const evaluation = confidence(value, {
    confidenceScore: 20,
    evidence: { supportingDecisionIdsCount: 1, occurrences: 1 },
    dataQuality: { insufficientEvidence: true },
  });
  const [candidate] = build({
    patterns: [value],
    evaluations: [evaluation],
  });
  assert.equal(candidate.eligibility.status, 'INELIGIBLE');
  assert.ok(candidate.eligibility.reasons.includes(
    'INSUFFICIENT_EVIDENCE'
  ));
});

test('includeIneligible=false removes ineligible candidates', () => {
  assert.deepEqual(build({
    evaluations: [],
    options: { includeIneligible: false },
  }), []);
});

test('candidateId is a deterministic full SHA-256 digest', () => {
  const first = build()[0];
  const second = build()[0];
  assert.match(first.candidateId, /^[a-f0-9]{64}$/);
  assert.equal(second.candidateId, first.candidateId);
});

test('candidateId changes when the proposed action changes', () => {
  const buy = build()[0];
  const skipValue = pattern({ dominantValue: 'SKIP' });
  const skip = build({ patterns: [skipValue] })[0];
  assert.notEqual(skip.candidateId, buy.candidateId);
});

test('duplicate candidateId is rejected', () => {
  const value = pattern();
  assert.throws(() => build({
    patterns: [value, clone(value)],
    evaluations: [confidence(value)],
  }), invalidError);
});

test('confidenceComponent scales confidence score to 0..30', () => {
  for (const [score, expected] of [[0, 0], [50, 15], [100, 30]]) {
    const value = pattern();
    const [candidate] = build({
      patterns: [value],
      evaluations: [confidence(value, { confidenceScore: score })],
    });
    assert.equal(
      candidate.ranking.components.confidenceComponent,
      expected
    );
  }
});

test('evidenceComponent follows every evidence boundary', () => {
  const expected = new Map([
    [0, 0], [1, 0], [2, 4], [3, 7],
    [4, 10], [5, 13], [6, 13], [7, 15],
  ]);
  for (const [count, score] of expected) {
    const value = pattern();
    const evaluation = confidence(value, {
      evidence: { supportingDecisionIdsCount: count },
    });
    const [candidate] = build({
      patterns: [value],
      evaluations: [evaluation],
    });
    assert.equal(candidate.ranking.components.evidenceComponent, score);
  }
});

test('recurrenceComponent follows every occurrence boundary', () => {
  const expected = new Map([
    [0, 0], [1, 0], [2, 3], [3, 6],
    [4, 9], [5, 12], [6, 12], [7, 15],
  ]);
  for (const [occurrences, score] of expected) {
    const value = pattern({ occurrences });
    const [candidate] = build({
      patterns: [value],
      evaluations: [confidence(value)],
    });
    assert.equal(
      candidate.ranking.components.recurrenceComponent,
      score
    );
  }
});

test('recencyComponent normalizes 0..15 to 0..10', () => {
  for (const [source, expected] of [[0, 0], [9, 6], [15, 10]]) {
    const value = pattern();
    const evaluation = confidence(value, {
      components: { recencyScore: source },
    });
    const [candidate] = build({
      patterns: [value],
      evaluations: [evaluation],
    });
    assert.equal(candidate.ranking.components.recencyComponent, expected);
  }
});

test('consistencyComponent normalizes 0..20 to 0..10', () => {
  for (const [source, expected] of [[0, 0], [10, 5], [20, 10]]) {
    const value = pattern();
    const evaluation = confidence(value, {
      components: { consistencyScore: source },
    });
    const [candidate] = build({
      patterns: [value],
      evaluations: [evaluation],
    });
    assert.equal(
      candidate.ranking.components.consistencyComponent,
      expected
    );
  }
});

test('ITEM impact is exactly one affected item and four points', () => {
  const [candidate] = build({ history: [] });
  assert.equal(candidate.impact.estimatedAffectedItems, 1);
  assert.equal(candidate.ranking.components.impactComponent, 4);
});

test('BRAND impact counts unique stable item keys', () => {
  const value = pattern({
    patternType: 'BRAND_DECISION_BIAS',
    scopeType: 'BRAND',
    scopeKey: 'Alpha',
  });
  const entries = [
    historyEntry(1, { stableItemKey: 'sku:A' }),
    historyEntry(2, { stableItemKey: 'sku:B' }),
    historyEntry(3, { stableItemKey: 'sku:C' }),
    historyEntry(4, { stableItemKey: 'sku:C' }),
    historyEntry(5, { brand: 'Other', stableItemKey: 'sku:D' }),
  ];
  const [candidate] = build({
    patterns: [value],
    history: entries,
  });
  assert.equal(candidate.impact.estimatedAffectedItems, 3);
  assert.equal(candidate.ranking.components.impactComponent, 8);
});

test('SUPPLIER impact counts unique stable item keys', () => {
  const value = pattern({
    patternType: 'SUPPLIER_DECISION_BIAS',
    scopeType: 'SUPPLIER',
    scopeKey: 'Supplier A',
  });
  const entries = Array.from({ length: 7 }, (_, index) =>
    historyEntry(index + 1, {
      stableItemKey: `sku:${index + 1}`,
    })
  );
  const [candidate] = build({
    patterns: [value],
    history: entries,
  });
  assert.equal(candidate.impact.estimatedAffectedItems, 7);
  assert.equal(candidate.ranking.components.impactComponent, 12);
});

test('unknown broad-scope impact receives zero and explanation code', () => {
  const value = pattern({
    patternType: 'BRAND_DECISION_BIAS',
    scopeType: 'BRAND',
    scopeKey: 'Absent',
  });
  const [candidate] = build({
    patterns: [value],
    history: [],
  });
  assert.equal(candidate.impact.estimatedAffectedItems, 0);
  assert.equal(candidate.ranking.components.impactComponent, 0);
  assert.ok(candidate.explanationCodes.includes(
    'IMPACT_ESTIMATE_UNAVAILABLE'
  ));
});

test('historical quantity delta uses only valid BUY to BUY records', () => {
  const entries = [
    historyEntry(1, { agentQuantity: 5, ownerQuantity: 8 }),
    historyEntry(2, { agentQuantity: 4, ownerQuantity: 2 }),
    historyEntry(3, {
      agentRecommendation: 'SKIP',
      agentQuantity: 4,
      ownerQuantity: 9,
    }),
    historyEntry(4, { ownerQuantity: null }),
  ];
  const [candidate] = build({ history: entries });
  assert.equal(candidate.impact.estimatedHistoricalQuantityDelta, 1);
});

test('duplicate decisionId does not duplicate quantity impact', () => {
  const entries = [
    historyEntry(1, {
      decisionId: 'same',
      agentQuantity: 1,
      ownerQuantity: 3,
    }),
    historyEntry(2, {
      decisionId: 'same',
      agentQuantity: 1,
      ownerQuantity: 10,
    }),
  ];
  const [candidate] = build({ history: entries });
  assert.equal(candidate.impact.estimatedHistoricalQuantityDelta, 2);
});

test('absence of valid quantity pairs returns null delta', () => {
  const entries = [
    historyEntry(1, { agentQuantity: null, ownerQuantity: null }),
    historyEntry(2, { ownerDecision: 'SKIP' }),
  ];
  const [candidate] = build({ history: entries });
  assert.equal(candidate.impact.estimatedHistoricalQuantityDelta, null);
});

test('financial estimate is always unavailable in v0.8.2', () => {
  const [candidate] = build();
  assert.equal(candidate.impact.hasFinancialEstimate, false);
  assert.ok(
    candidate.explanationCodes.includes('NO_FINANCIAL_ESTIMATE')
  );
});

test('ambiguityPenalty combines missing decision and guidance status', () => {
  const value = pattern({
    patternType: 'SAME_ITEM_SAME_REASON',
    dominantValue: 'OTHER',
  });
  const [candidate] = build({ patterns: [value] });
  assert.equal(candidate.ranking.components.ambiguityPenalty, 12);
});

test('contradictionPenalty is normalized from 0..30 to 0..20', () => {
  const value = pattern();
  const [candidate] = build({
    patterns: [value],
    evaluations: [confidence(value, {
      components: { contradictionPenalty: 15 },
      contradictions: { count: 2, share: 0.3 },
    })],
  });
  assert.equal(candidate.ranking.components.contradictionPenalty, 10);
});

test('dataQualityPenalty is normalized from 0..30 to 0..20', () => {
  const value = pattern();
  const [candidate] = build({
    patterns: [value],
    evaluations: [confidence(value, {
      components: { dataQualityPenalty: 15 },
      dataQuality: { duplicateDecisionIds: 1 },
    })],
  });
  assert.equal(candidate.ranking.components.dataQualityPenalty, 10);
});

test('priorityScore is clamped at zero', () => {
  const value = pattern({ occurrences: 0, share: 0.5 });
  const evaluation = confidence(value, {
    confidenceScore: 0,
    evidence: {
      occurrences: 0,
      supportingDecisionIdsCount: 0,
      dominantShare: 0.5,
    },
    components: {
      recencyScore: 0,
      consistencyScore: 0,
      contradictionPenalty: 30,
      dataQualityPenalty: 30,
    },
    contradictions: { count: 4, share: 1 },
    dataQuality: { duplicateDecisionIds: 4 },
  });
  const [candidate] = build({
    patterns: [value],
    evaluations: [evaluation],
  });
  assert.equal(candidate.ranking.priorityScore, 0);
});

test('maximum-signal priority remains within the 100-point clamp', () => {
  const value = pattern({
    patternType: 'BRAND_DECISION_BIAS',
    scopeType: 'BRAND',
    scopeKey: 'Wide Brand',
    occurrences: 7,
    share: 1,
  });
  const entries = Array.from({ length: 21 }, (_, index) =>
    historyEntry(index + 1, {
      brand: 'Wide Brand',
      stableItemKey: `sku:wide-${index}`,
    })
  );
  const evaluation = confidence(value, {
    confidenceScore: 100,
    evidence: {
      occurrences: 7,
      supportingDecisionIdsCount: 7,
      dominantShare: 1,
    },
  });
  const [candidate] = build({
    patterns: [value],
    evaluations: [evaluation],
    history: entries,
  });
  assert.equal(candidate.ranking.priorityScore, 96);
  assert.ok(candidate.ranking.priorityScore <= 100);
});

test('getCandidatePriorityLevel covers every boundary', () => {
  const expected = new Map([
    [0, 'LOW'], [24, 'LOW'],
    [25, 'MEDIUM'], [49, 'MEDIUM'],
    [50, 'HIGH'], [74, 'HIGH'],
    [75, 'CRITICAL'], [100, 'CRITICAL'],
  ]);
  for (const [score, level] of expected) {
    assert.equal(getCandidatePriorityLevel(score), level);
  }
});

test('getCandidatePriorityLevel rejects invalid scores', () => {
  for (const value of [-1, 101, 1.5, null]) {
    assert.throws(
      () => getCandidatePriorityLevel(value),
      invalidError
    );
  }
});

test('ranking sorts ELIGIBLE before REVIEW_ONLY and INELIGIBLE', () => {
  const eligible = build()[0];
  const reviewPattern = pattern({
    patternType: 'SAME_ITEM_SAME_REASON',
    dominantValue: 'OTHER',
    scopeKey: 'sku:review',
  });
  const review = build({ patterns: [reviewPattern] })[0];
  const invalidPattern = pattern({
    dominantValue: 'REVIEW',
    scopeKey: 'sku:invalid',
  });
  const invalid = build({ patterns: [invalidPattern] })[0];
  const ranked = rankRuleCandidates({
    candidates: [invalid, review, eligible],
  });
  assert.deepEqual(ranked.map(item => item.eligibility.status), [
    'ELIGIBLE',
    'REVIEW_ONLY',
    'INELIGIBLE',
  ]);
});

test('ranking sorts equal-eligibility candidates by priorityScore', () => {
  const firstPattern = pattern({ scopeKey: 'sku:A' });
  const secondPattern = pattern({ scopeKey: 'sku:B' });
  const candidates = build({
    patterns: [firstPattern, secondPattern],
  });
  candidates[0].ranking.priorityScore = 50;
  candidates[0].ranking.priorityLevel = 'HIGH';
  candidates[1].ranking.priorityScore = 70;
  candidates[1].ranking.priorityLevel = 'HIGH';
  const ranked = rankRuleCandidates({ candidates });
  assert.deepEqual(
    ranked.map(item => item.ranking.priorityScore),
    [70, 50]
  );
});

test('ranking uses confidence score after priority score', () => {
  const firstPattern = pattern({ scopeKey: 'sku:A' });
  const secondPattern = pattern({ scopeKey: 'sku:B' });
  const candidates = build({
    patterns: [firstPattern, secondPattern],
  });
  for (const candidate of candidates) {
    candidate.ranking.priorityScore = 60;
    candidate.ranking.priorityLevel = 'HIGH';
  }
  candidates[0].confidence = { score: 60, level: 'HIGH' };
  candidates[1].confidence = { score: 90, level: 'VERY_HIGH' };
  const ranked = rankRuleCandidates({ candidates });
  assert.deepEqual(
    ranked.map(item => item.confidence.score),
    [90, 60]
  );
});

test('ranking uses evidence occurrences after confidence score', () => {
  const firstPattern = pattern({ scopeKey: 'sku:A' });
  const secondPattern = pattern({ scopeKey: 'sku:B' });
  const candidates = build({
    patterns: [firstPattern, secondPattern],
  });
  for (const candidate of candidates) {
    candidate.ranking.priorityScore = 60;
    candidate.ranking.priorityLevel = 'HIGH';
  }
  candidates[0].evidence.occurrences = 2;
  candidates[1].evidence.occurrences = 5;
  const ranked = rankRuleCandidates({ candidates });
  assert.deepEqual(
    ranked.map(item => item.evidence.occurrences),
    [5, 2]
  );
});

test('ranking applies deterministic pattern and scope tie-breakers', () => {
  const itemB = pattern({ scopeKey: 'sku:B' });
  const itemA = pattern({ scopeKey: 'sku:A' });
  const reason = pattern({
    patternType: 'SAME_ITEM_SAME_REASON',
    scopeKey: 'sku:A',
    dominantValue: 'OTHER',
  });
  const candidates = build({
    patterns: [reason, itemB, itemA],
  });
  for (const candidate of candidates) {
    candidate.eligibility.status = 'REVIEW_ONLY';
    candidate.eligibility.reasons = [
      'CONFIDENCE_BELOW_ELIGIBILITY_THRESHOLD',
    ];
    candidate.ranking.priorityScore = 50;
    candidate.ranking.priorityLevel = 'HIGH';
    candidate.confidence = { score: 50, level: 'HIGH' };
    candidate.evidence.occurrences = 4;
  }
  const ranked = rankRuleCandidates({ candidates });
  assert.deepEqual(
    ranked.map(item => `${item.patternType}:${item.scopeKey}`),
    [
      'SAME_ITEM_SAME_DECISION:sku:A',
      'SAME_ITEM_SAME_DECISION:sku:B',
      'SAME_ITEM_SAME_REASON:sku:A',
    ]
  );
});

test('ranking assigns consecutive ranks starting at one', () => {
  const values = [
    pattern({ scopeKey: 'sku:A' }),
    pattern({ scopeKey: 'sku:B' }),
    pattern({ scopeKey: 'sku:C' }),
  ];
  const ranked = rankRuleCandidates({
    candidates: build({ patterns: values }),
  });
  assert.deepEqual(ranked.map(item => item.ranking.rank), [1, 2, 3]);
});

test('ranking limit truncates after sorting', () => {
  const values = [
    pattern({ scopeKey: 'sku:A' }),
    pattern({ scopeKey: 'sku:B' }),
    pattern({ scopeKey: 'sku:C' }),
  ];
  const ranked = rankRuleCandidates({
    candidates: build({ patterns: values }),
    options: { limit: 2 },
  });
  assert.equal(ranked.length, 2);
  assert.deepEqual(ranked.map(item => item.ranking.rank), [1, 2]);
});

test('ineligible filtering happens before rank and limit', () => {
  const eligible = pattern({ scopeKey: 'sku:A' });
  const invalid = pattern({
    scopeKey: 'sku:B',
    dominantValue: 'REVIEW',
  });
  const candidates = build({ patterns: [invalid, eligible] });
  const ranked = rankRuleCandidates({
    candidates,
    options: { includeIneligible: false, limit: 1 },
  });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].eligibility.status, 'ELIGIBLE');
  assert.equal(ranked[0].ranking.rank, 1);
});

test('invalid ranking limit returns controlled error', () => {
  const candidates = build();
  for (const limit of [0, 101, 1.5, '2']) {
    assert.throws(
      () => rankRuleCandidates({ candidates, options: { limit } }),
      invalidError
    );
  }
});

test('invalid eligibility thresholds return controlled errors', () => {
  const cases = [
    { minOccurrencesForEligibility: 0 },
    { minOccurrencesForEligibility: 1.5 },
    { minDominantShareForEligibility: -0.1 },
    { minDominantShareForEligibility: 1.1 },
    { maxContradictionShareForEligibility: -0.1 },
    { maxContradictionShareForEligibility: 1.1 },
    { includeIneligible: 'yes' },
  ];
  for (const options of cases) {
    assert.throws(() => build({ options }), invalidError);
  }
});

test('invalid analytics returns controlled error', () => {
  for (const analytics of [null, {}, { repeatedDecisionPatterns: {} }]) {
    assert.throws(() => buildRuleCandidates({
      analytics,
      confidenceEvaluations: [],
      history: [],
    }), invalidError);
  }
});

test('invalid confidenceEvaluations container returns controlled error', () => {
  assert.throws(() => buildRuleCandidates({
    analytics: { repeatedDecisionPatterns: [] },
    confidenceEvaluations: null,
    history: [],
  }), invalidError);
});

test('invalid confidence evaluation returns controlled error', () => {
  const value = pattern();
  const evaluation = confidence(value, {
    confidenceScore: 101,
    confidenceLevel: 'VERY_HIGH',
  });
  assert.throws(() => build({
    patterns: [value],
    evaluations: [evaluation],
  }), invalidError);
});

test('confidence evaluation scopeType must match patternType', () => {
  const value = pattern();
  const evaluation = confidence(value);
  evaluation.scopeType = 'BRAND';
  assert.throws(() => build({
    patterns: [value],
    evaluations: [evaluation],
  }), invalidError);
});

test('unmatched confidence evaluation scope returns controlled error', () => {
  const value = pattern();
  const otherScope = pattern({ scopeKey: 'sku:OTHER' });
  assert.throws(() => build({
    patterns: [value],
    evaluations: [confidence(otherScope)],
  }), invalidError);
});

test('unsupported patternType returns controlled error', () => {
  const value = pattern({ patternType: 'UNKNOWN_PATTERN' });
  assert.throws(() => build({
    patterns: [value],
    evaluations: [],
  }), invalidError);
});

test('duplicate confidence evaluation scope returns controlled error', () => {
  const value = pattern();
  const evaluation = confidence(value);
  assert.throws(() => build({
    patterns: [value],
    evaluations: [evaluation, clone(evaluation)],
  }), invalidError);
});

test('invalid ranking candidate returns controlled error', () => {
  const candidate = build()[0];
  candidate.candidateId = 'invalid';
  assert.throws(
    () => rankRuleCandidates({ candidates: [candidate] }),
    invalidError
  );
});

test('duplicate candidateId in ranking input is rejected', () => {
  const candidate = build()[0];
  assert.throws(() => rankRuleCandidates({
    candidates: [candidate, clone(candidate)],
  }), invalidError);
});

test('candidate output never exposes ownerComment', () => {
  const serialized = JSON.stringify(build());
  assert.equal(serialized.includes('ownerComment'), false);
  assert.equal(serialized.includes('Скрытый комментарий'), false);
});

test('candidate output never exposes metadata', () => {
  const serialized = JSON.stringify(build());
  assert.equal(serialized.includes('metadata'), false);
  assert.equal(serialized.includes('private'), false);
});

test('ranking strips unsafe extra fields from caller candidates', () => {
  const candidate = build()[0];
  candidate.ownerComment = 'private';
  candidate.metadata = { private: true };
  candidate.evidence.ownerComment = 'nested private';
  const [ranked] = rankRuleCandidates({ candidates: [candidate] });
  const serialized = JSON.stringify(ranked);
  assert.equal(serialized.includes('ownerComment'), false);
  assert.equal(serialized.includes('metadata'), false);
  assert.equal(serialized.includes('private'), false);
});

test('candidate evidence never exposes decisionId payloads', () => {
  const [candidate] = build();
  assert.deepEqual(Object.keys(candidate.evidence).sort(), [
    'dominantShare',
    'firstRecordedAt',
    'historySpanDays',
    'lastRecordedAt',
    'occurrences',
    'supportingDecisionIdsCount',
    'totalRelevantEntries',
  ]);
  assert.equal(JSON.stringify(candidate).includes('decision-001'), false);
});

test('candidate building does not mutate any caller-owned input', () => {
  const value = pattern();
  const evaluation = confidence(value);
  const entries = defaultHistory();
  const analytics = { repeatedDecisionPatterns: [value] };
  const options = { limit: 10 };
  const before = clone({
    analytics,
    confidenceEvaluations: [evaluation],
    history: entries,
    options,
  });
  buildRuleCandidates({
    analytics,
    confidenceEvaluations: [evaluation],
    history: entries,
    options,
  });
  assert.deepEqual({
    analytics,
    confidenceEvaluations: [evaluation],
    history: entries,
    options,
  }, before);
});

test('ranking does not mutate candidates or options', () => {
  const candidates = build();
  const options = { limit: 1 };
  const beforeCandidates = clone(candidates);
  const beforeOptions = clone(options);
  rankRuleCandidates({ candidates, options });
  assert.deepEqual(candidates, beforeCandidates);
  assert.deepEqual(options, beforeOptions);
});

test('identical build and rank inputs are deterministic', () => {
  const input = {
    analytics: { repeatedDecisionPatterns: [pattern()] },
    confidenceEvaluations: [confidence(pattern())],
    history: defaultHistory(),
    options: { limit: 10 },
  };
  assert.deepEqual(
    buildAndRankRuleCandidates(input),
    buildAndRankRuleCandidates(input)
  );
});

test('BUY action keeps the agent quantity', () => {
  const [candidate] = build();
  assert.equal(
    candidate.proposedAction.quantityStrategy,
    'KEEP_AGENT_QUANTITY'
  );
  assert.equal(candidate.proposedAction.quantityValue, null);
});

test('SKIP action makes no quantity change', () => {
  const value = pattern({ dominantValue: 'SKIP' });
  const [candidate] = build({ patterns: [value] });
  assert.equal(
    candidate.proposedAction.quantityStrategy,
    'NO_QUANTITY_CHANGE'
  );
});

test('DEFER action makes no quantity change', () => {
  const value = pattern({ dominantValue: 'DEFER' });
  const [candidate] = build({ patterns: [value] });
  assert.equal(
    candidate.proposedAction.quantityStrategy,
    'NO_QUANTITY_CHANGE'
  );
});

test('guidance candidate always makes no quantity change', () => {
  const value = pattern({
    patternType: 'BRAND_DECISION_BIAS',
    scopeType: 'BRAND',
    scopeKey: 'Alpha',
    dominantValue: 'BUY',
  });
  const [candidate] = build({ patterns: [value] });
  assert.equal(
    candidate.proposedAction.quantityStrategy,
    'NO_QUANTITY_CHANGE'
  );
  assert.equal(candidate.proposedAction.quantityValue, null);
});

test('explanation codes are unique and use fixed logical order', () => {
  const [candidate] = build();
  assert.equal(
    new Set(candidate.explanationCodes).size,
    candidate.explanationCodes.length
  );
  assert.deepEqual(candidate.explanationCodes, [
    'HIGH_CONFIDENCE_PATTERN',
    'LIMITED_EVIDENCE_VOLUME',
    'RECENT_PATTERN',
    'CONSISTENT_PATTERN',
    'ITEM_SPECIFIC_CANDIDATE',
    'ELIGIBLE_FOR_OWNER_REVIEW',
    'NO_FINANCIAL_ESTIMATE',
    'PRIORITY_DESCRIBES_MANUAL_REVIEW_ORDER',
  ]);
});

test('empty history is safe and preserves item impact only', () => {
  const [candidate] = build({ history: [] });
  assert.equal(candidate.impact.estimatedAffectedItems, 1);
  assert.equal(candidate.impact.estimatedHistoricalQuantityDelta, null);
});

test('null and undefined top-level inputs return controlled errors', () => {
  for (const call of [
    () => buildRuleCandidates(),
    () => buildRuleCandidates(null),
    () => rankRuleCandidates(),
    () => rankRuleCandidates(null),
    () => buildAndRankRuleCandidates(null),
  ]) {
    assert.throws(call, invalidError);
  }
});

test('buildAndRankRuleCandidates composes build and ranking APIs', () => {
  const value = pattern();
  const result = buildAndRankRuleCandidates({
    analytics: { repeatedDecisionPatterns: [value] },
    confidenceEvaluations: [confidence(value)],
    history: defaultHistory(),
    options: { limit: 1 },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].ranking.rank, 1);
});

test('practical 25-entry scenario covers ranking and eligibility', () => {
  const entries = [];
  const add = overrides => entries.push(
    historyEntry(entries.length + 1, overrides)
  );
  for (let index = 0; index < 5; index += 1) {
    add({
      stableItemKey: 'sku:eligible-a',
      brand: 'Eligible Brand',
      supplier: 'Supplier One',
      agentQuantity: 5,
      ownerQuantity: 8,
    });
  }
  for (let index = 0; index < 4; index += 1) {
    add({
      stableItemKey: 'sku:eligible-b',
      brand: 'Eligible Brand',
      supplier: 'Supplier One',
    });
  }
  for (let index = 0; index < 3; index += 1) {
    add({
      stableItemKey: 'sku:reason',
      reasonCode: 'LOW_SALES',
      brand: 'Reason Brand',
    });
  }
  for (let index = 0; index < 5; index += 1) {
    add({
      stableItemKey: `sku:brand-${index}`,
      brand: 'Broad Brand',
      supplier: 'Supplier Two',
    });
  }
  for (let index = 0; index < 4; index += 1) {
    add({
      stableItemKey: `sku:supplier-${index}`,
      brand: 'Supplier Brand',
      supplier: 'Broad Supplier',
    });
  }
  for (let index = 0; index < 4; index += 1) {
    add({
      stableItemKey: 'sku:disagreement',
      agentRecommendation: 'BUY',
      ownerDecision: 'SKIP',
    });
  }
  assert.equal(entries.length, 25);

  const patterns = [
    pattern({
      scopeKey: 'sku:eligible-a',
      occurrences: 5,
      share: 1,
    }),
    pattern({
      scopeKey: 'sku:eligible-b',
      occurrences: 4,
      share: 0.8,
    }),
    pattern({
      patternType: 'SAME_ITEM_SAME_REASON',
      scopeKey: 'sku:reason',
      dominantValue: 'LOW_SALES',
      occurrences: 3,
      share: 1,
    }),
    pattern({
      patternType: 'BRAND_DECISION_BIAS',
      scopeType: 'BRAND',
      scopeKey: 'Broad Brand',
      occurrences: 5,
      share: 0.9,
    }),
    pattern({
      patternType: 'SUPPLIER_DECISION_BIAS',
      scopeType: 'SUPPLIER',
      scopeKey: 'Broad Supplier',
      occurrences: 4,
      share: 0.8,
    }),
    pattern({
      patternType: 'AGENT_DISAGREEMENT_REPEAT',
      scopeKey: 'sku:disagreement',
      dominantValue: 'BUY->SKIP',
      occurrences: 4,
      share: 1,
    }),
    pattern({
      scopeKey: 'sku:invalid',
      dominantValue: 'REVIEW',
      occurrences: 2,
      share: 0.5,
    }),
  ];
  const scores = [90, 70, 45, 65, 20, 60, 40];
  const evaluations = patterns.map((value, index) =>
    confidence(value, {
      confidenceScore: scores[index],
      evidence: {
        occurrences: value.occurrences,
        supportingDecisionIdsCount: value.occurrences,
        dominantShare: value.share,
      },
    })
  );
  const input = {
    analytics: { repeatedDecisionPatterns: patterns },
    confidenceEvaluations: evaluations,
    history: entries,
    options: { limit: 100 },
  };
  const first = buildAndRankRuleCandidates(input);
  const second = buildAndRankRuleCandidates(input);
  assert.deepEqual(second, first);
  assert.equal(first.length, 7);
  assert.equal(
    first.filter(item => item.eligibility.status === 'ELIGIBLE').length,
    2
  );
  assert.ok(
    first.filter(item =>
      item.eligibility.status === 'REVIEW_ONLY'
    ).length >= 3
  );
  assert.equal(
    first.filter(item => item.eligibility.status === 'INELIGIBLE').length,
    1
  );
  assert.deepEqual(
    first.map(item => item.ranking.rank),
    [1, 2, 3, 4, 5, 6, 7]
  );
  assert.equal(first.every(item =>
    item.ranking.priorityScore >= 0 &&
    item.ranking.priorityScore <= 100
  ), true);
  const brand = first.find(item =>
    item.patternType === 'BRAND_DECISION_BIAS'
  );
  const supplier = first.find(item =>
    item.patternType === 'SUPPLIER_DECISION_BIAS'
  );
  const eligibleA = first.find(item =>
    item.scopeKey === 'sku:eligible-a'
  );
  assert.equal(brand.impact.estimatedAffectedItems, 5);
  assert.equal(supplier.impact.estimatedAffectedItems, 4);
  assert.equal(
    eligibleA.impact.estimatedHistoricalQuantityDelta,
    15
  );
  assert.equal(first.every(item =>
    item.impact.hasFinancialEstimate === false
  ), true);
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes('ownerComment'), false);
  assert.equal(serialized.includes('metadata'), false);

  const withoutIneligible = buildAndRankRuleCandidates({
    ...input,
    options: { includeIneligible: false, limit: 100 },
  });
  assert.equal(withoutIneligible.length, 6);
  assert.equal(withoutIneligible.some(item =>
    item.eligibility.status === 'INELIGIBLE'
  ), false);
  const limited = buildAndRankRuleCandidates({
    ...input,
    options: { limit: 3 },
  });
  assert.equal(limited.length, 3);
  assert.deepEqual(
    limited.map(item => item.ranking.rank),
    [1, 2, 3]
  );
});
