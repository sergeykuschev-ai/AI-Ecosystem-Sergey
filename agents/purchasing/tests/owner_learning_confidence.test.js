const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  analyzeOwnerDecisionHistory,
} = require(
  '../owner_learning/owner_decision_history_analytics'
);
const {
  CONFIDENCE_SCHEMA_VERSION,
  OwnerLearningConfidenceError,
  evaluateAllPatternConfidences,
  evaluatePatternConfidence,
  getConfidenceLevel,
  rankPatternsByConfidence,
} = require('../owner_learning/owner_learning_confidence');

const AS_OF = '2026-07-25T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysBefore(days) {
  return new Date(Date.parse(AS_OF) - days * DAY_MS).toISOString();
}

function entry(sequence, overrides = {}) {
  return {
    decisionId: `decision-${String(sequence).padStart(3, '0')}`,
    recordedAt: isoDaysBefore(30 - sequence),
    source: 'OWNER_REVIEW',
    stableItemKey: 'sku:SKU-1',
    sku: 'SKU-1',
    productName: 'Товар 1',
    brand: 'Alpha',
    supplier: 'Валта',
    category: 'Корм',
    ownerDecision: 'BUY',
    reasonCode: 'OTHER',
    agentRecommendation: 'BUY',
    agentQuantity: 5,
    ownerQuantity: 5,
    ownerComment: 'Скрытый комментарий',
    metadata: { privateNote: 'Скрытые metadata' },
    ...overrides,
  };
}

function history(entries = []) {
  return {
    schemaVersion: 'owner-decision-history-v0.7.1',
    updatedAt: entries.at(-1)?.recordedAt || null,
    entries,
  };
}

function pattern(overrides = {}) {
  return {
    patternType: 'SAME_ITEM_SAME_DECISION',
    scopeType: 'ITEM',
    scopeKey: 'sku:SKU-1',
    occurrences: 3,
    dominantValue: 'BUY',
    share: 1,
    evidenceDecisionIds: [
      'decision-001',
      'decision-002',
      'decision-003',
    ],
    firstRecordedAt: isoDaysBefore(29),
    lastRecordedAt: isoDaysBefore(27),
    ...overrides,
  };
}

function evaluate(entries, patternOverrides = {}, optionOverrides = {}) {
  return evaluatePatternConfidence({
    pattern: pattern(patternOverrides),
    history: history(entries),
    options: {
      asOf: AS_OF,
      ...optionOverrides,
    },
  });
}

function supportingEntries(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) =>
    entry(index + 1, overrides)
  );
}

function highEvaluation() {
  const entries = [
    entry(1, { recordedAt: isoDaysBefore(120) }),
    entry(2, { recordedAt: isoDaysBefore(90) }),
    entry(3, {
      recordedAt: isoDaysBefore(60),
      ownerDecision: 'SKIP',
    }),
    entry(4, { recordedAt: isoDaysBefore(30) }),
    entry(5, { recordedAt: isoDaysBefore(5) }),
  ];
  return evaluate(entries, {
    occurrences: 4,
    share: 0.8,
    evidenceDecisionIds: [
      'decision-001',
      'decision-002',
      'decision-004',
      'decision-005',
    ],
  });
}

function mediumEvaluation() {
  return evaluate([
    entry(1, { recordedAt: isoDaysBefore(15) }),
    entry(2, { recordedAt: isoDaysBefore(5) }),
  ], {
    occurrences: 2,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
}

function lowEvaluation() {
  return evaluate([
    entry(1, { recordedAt: isoDaysBefore(500) }),
  ], {
    occurrences: 1,
    evidenceDecisionIds: ['decision-001'],
  });
}

function veryHighEvaluation() {
  const entries = Array.from({ length: 8 }, (_, index) =>
    entry(index + 1, {
      recordedAt: isoDaysBefore(400 - index * 55),
    })
  );
  entries.at(-1).recordedAt = isoDaysBefore(5);
  return evaluate(entries, {
    occurrences: 8,
    evidenceDecisionIds: entries.map(item => item.decisionId),
    firstRecordedAt: entries[0].recordedAt,
    lastRecordedAt: entries.at(-1).recordedAt,
  });
}

function invalidError(error) {
  return error instanceof OwnerLearningConfidenceError &&
    error.code === 'OWNER_LEARNING_CONFIDENCE_INVALID_INPUT';
}

test('getConfidenceLevel covers every boundary', () => {
  const expected = new Map([
    [0, 'LOW'],
    [24, 'LOW'],
    [25, 'MEDIUM'],
    [49, 'MEDIUM'],
    [50, 'HIGH'],
    [74, 'HIGH'],
    [75, 'VERY_HIGH'],
    [100, 'VERY_HIGH'],
  ]);
  for (const [score, level] of expected) {
    assert.equal(getConfidenceLevel(score), level);
  }
});

test('getConfidenceLevel rejects values outside its contract', () => {
  for (const value of [-1, 101, 1.5, null]) {
    assert.throws(() => getConfidenceLevel(value), invalidError);
  }
});

test('confidence score is always clamped to 0..100', () => {
  assert.equal(veryHighEvaluation().confidenceScore, 100);
  const low = evaluate([
    entry(1, {
      recordedAt: null,
      ownerDecision: 'UNKNOWN',
    }),
  ], {
    dominantValue: 'UNKNOWN',
    share: 2,
    occurrences: 0,
    evidenceDecisionIds: ['absent'],
  });
  assert.equal(low.confidenceScore, 0);
});

test('higher occurrence count increases occurrenceScore', () => {
  const two = evaluate(supportingEntries(2), {
    occurrences: 2,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
  const seven = evaluate(supportingEntries(7), {
    occurrences: 7,
    evidenceDecisionIds: supportingEntries(7)
      .map(item => item.decisionId),
  });
  assert.equal(two.components.occurrenceScore, 5);
  assert.equal(seven.components.occurrenceScore, 25);
});

test('duplicate decisionId does not increase evidence', () => {
  const result = evaluate([
    entry(1),
    entry(2, { decisionId: 'decision-001' }),
    entry(3),
  ], {
    evidenceDecisionIds: ['decision-001', 'decision-003'],
  });
  assert.equal(result.evidence.occurrences, 2);
  assert.equal(result.evidence.supportingDecisionIdsCount, 2);
  assert.equal(result.dataQuality.duplicateDecisionIds, 1);
});

test('higher dominant share increases dominanceScore', () => {
  const moderate = evaluate(supportingEntries(3), { share: 0.6 });
  const high = evaluate(supportingEntries(3), { share: 0.95 });
  assert.equal(moderate.components.dominanceScore, 10);
  assert.equal(high.components.dominanceScore, 25);
});

test('invalid dominant share becomes a data-quality issue', () => {
  const result = evaluate(supportingEntries(3), { share: Number.NaN });
  assert.equal(result.evidence.dominantShare, null);
  assert.equal(result.components.dominanceScore, 0);
  assert.ok(result.components.dataQualityPenalty > 0);
  assert.ok(
    result.dataQuality.warnings.includes('INVALID_DOMINANT_SHARE')
  );
});

test('consistent early and late halves receive maximum consistency', () => {
  const result = evaluate(supportingEntries(6));
  assert.equal(result.components.consistencyScore, 20);
  assert.ok(
    result.explanationCodes.includes('CONSISTENT_ACROSS_TIME')
  );
});

test('pattern present only in early half has low consistency', () => {
  const entries = supportingEntries(3);
  entries.push(
    entry(4, { ownerDecision: 'SKIP' }),
    entry(5, { ownerDecision: 'SKIP' }),
    entry(6, { ownerDecision: 'SKIP' })
  );
  const result = evaluate(entries, {
    occurrences: 3,
    share: 0.5,
  });
  assert.equal(result.components.consistencyScore, 5);
  assert.ok(
    result.explanationCodes.includes('INCONSISTENT_ACROSS_TIME')
  );
});

test('one or two relevant records have insufficient consistency', () => {
  assert.equal(
    evaluate(supportingEntries(2), {
      occurrences: 2,
      evidenceDecisionIds: ['decision-001', 'decision-002'],
    }).components.consistencyScore,
    0
  );
});

test('recent supporting evidence receives maximum recency', () => {
  const result = evaluate([
    entry(1, { recordedAt: isoDaysBefore(20) }),
    entry(2, { recordedAt: isoDaysBefore(1) }),
  ], {
    occurrences: 2,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
  assert.equal(result.components.recencyScore, 15);
});

test('old supporting evidence receives low recency', () => {
  const result = evaluate([
    entry(1, { recordedAt: isoDaysBefore(500) }),
    entry(2, { recordedAt: isoDaysBefore(400) }),
  ], {
    occurrences: 2,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
  assert.equal(result.components.recencyScore, 0);
  assert.ok(
    result.explanationCodes.includes('STALE_SUPPORTING_EVIDENCE')
  );
});

test('future supporting date is never treated as recent', () => {
  const result = evaluate([
    entry(1, { recordedAt: isoDaysBefore(5) }),
    entry(2, {
      recordedAt: new Date(Date.parse(AS_OF) + DAY_MS).toISOString(),
    }),
  ], {
    occurrences: 2,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
  assert.equal(result.components.recencyScore, 0);
  assert.ok(result.components.dataQualityPenalty > 0);
  assert.ok(result.dataQuality.warnings.includes('FUTURE_RECORDED_AT'));
});

test('future contradictory date is also a scoped data-quality issue', () => {
  const result = evaluate([
    entry(1, { recordedAt: isoDaysBefore(5) }),
    entry(2, {
      recordedAt: new Date(Date.parse(AS_OF) + DAY_MS).toISOString(),
      ownerDecision: 'SKIP',
    }),
  ], {
    occurrences: 1,
    share: 0.5,
    evidenceDecisionIds: ['decision-001'],
  });
  assert.ok(
    result.dataQuality.warnings.includes('FUTURE_RECORDED_AT')
  );
  assert.ok(result.components.dataQualityPenalty > 0);
});

test('long observation period increases durationScore', () => {
  const short = evaluate([
    entry(1, { recordedAt: isoDaysBefore(10) }),
    entry(2, { recordedAt: isoDaysBefore(5) }),
  ], {
    occurrences: 2,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
  const long = evaluate([
    entry(1, { recordedAt: isoDaysBefore(400) }),
    entry(2, { recordedAt: isoDaysBefore(5) }),
  ], {
    occurrences: 2,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
  assert.equal(short.components.durationScore, 0);
  assert.equal(long.components.durationScore, 15);
});

test('one supporting decision never receives durationScore', () => {
  const result = lowEvaluation();
  assert.equal(result.components.durationScore, 0);
});

test('no contradictions has zero penalty and empty IDs', () => {
  const result = evaluate(supportingEntries(4), {
    occurrences: 4,
    evidenceDecisionIds: supportingEntries(4)
      .map(item => item.decisionId),
  });
  assert.equal(result.components.contradictionPenalty, 0);
  assert.deepEqual(result.contradictions, {
    count: 0,
    share: 0,
    decisionIds: [],
  });
  assert.ok(result.explanationCodes.includes('NO_CONTRADICTIONS'));
});

test('small contradiction share receives a small penalty', () => {
  const entries = supportingEntries(9);
  entries.push(entry(10, { ownerDecision: 'SKIP' }));
  const result = evaluate(entries, {
    occurrences: 9,
    share: 0.9,
  });
  assert.equal(result.contradictions.share, 0.1);
  assert.equal(result.components.contradictionPenalty, 3);
});

test('many contradictions receive the maximum penalty', () => {
  const entries = supportingEntries(2);
  entries.push(
    entry(3, { ownerDecision: 'SKIP' }),
    entry(4, { ownerDecision: 'SKIP' }),
    entry(5, { ownerDecision: 'SKIP' })
  );
  const result = evaluate(entries, {
    occurrences: 2,
    share: 0.4,
  });
  assert.equal(result.contradictions.share, 0.6);
  assert.equal(result.components.contradictionPenalty, 30);
  assert.deepEqual(result.contradictions.decisionIds, [
    'decision-003',
    'decision-004',
    'decision-005',
  ]);
});

test('contradiction IDs are unique, sorted and limited', () => {
  const entries = [
    entry(1, { ownerDecision: 'SKIP', decisionId: 'z' }),
    entry(2, { ownerDecision: 'SKIP', decisionId: 'a' }),
    entry(3, { ownerDecision: 'SKIP', decisionId: 'm' }),
  ];
  const result = evaluate(entries, {
    occurrences: 0,
    share: 0,
    evidenceDecisionIds: [],
  }, { maxEvidenceDecisionIds: 2 });
  assert.deepEqual(result.contradictions.decisionIds, ['a', 'm']);
});

test('contradiction IDs never exceed the safe maximum of 20', () => {
  const entries = Array.from({ length: 25 }, (_, index) =>
    entry(index + 1, {
      ownerDecision: 'SKIP',
      decisionId: `contradiction-${String(index + 1).padStart(2, '0')}`,
    })
  );
  const result = evaluate(entries, {
    occurrences: 0,
    share: 0,
    evidenceDecisionIds: [],
  }, { maxEvidenceDecisionIds: 100 });
  assert.equal(result.contradictions.decisionIds.length, 20);
});

test('SAME_ITEM_SAME_DECISION uses ownerDecision in item scope', () => {
  const result = evaluate([
    entry(1),
    entry(2),
    entry(3, { stableItemKey: 'sku:OTHER' }),
  ]);
  assert.equal(result.patternType, 'SAME_ITEM_SAME_DECISION');
  assert.equal(result.evidence.totalRelevantEntries, 2);
  assert.equal(result.evidence.occurrences, 2);
});

test('SAME_ITEM_SAME_REASON uses reasonCode in item scope', () => {
  const result = evaluate([
    entry(1, { reasonCode: 'LOW_SALES' }),
    entry(2, { reasonCode: 'LOW_SALES' }),
    entry(3, { reasonCode: 'OTHER' }),
  ], {
    patternType: 'SAME_ITEM_SAME_REASON',
    scopeType: 'ITEM',
    dominantValue: 'LOW_SALES',
    occurrences: 2,
    share: 2 / 3,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
  assert.equal(result.evidence.occurrences, 2);
  assert.equal(result.contradictions.count, 1);
});

test('BRAND_DECISION_BIAS uses exact brand scope', () => {
  const result = evaluate([
    entry(1, { brand: 'Alpha' }),
    entry(2, { brand: 'Alpha' }),
    entry(3, { brand: 'Beta', ownerDecision: 'SKIP' }),
  ], {
    patternType: 'BRAND_DECISION_BIAS',
    scopeType: 'BRAND',
    scopeKey: 'Alpha',
    occurrences: 2,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
  assert.equal(result.evidence.totalRelevantEntries, 2);
  assert.equal(result.contradictions.count, 0);
});

test('SUPPLIER_DECISION_BIAS uses exact supplier scope', () => {
  const result = evaluate([
    entry(1, { supplier: 'Валта' }),
    entry(2, { supplier: 'Валта' }),
    entry(3, { supplier: 'Другой', ownerDecision: 'SKIP' }),
  ], {
    patternType: 'SUPPLIER_DECISION_BIAS',
    scopeType: 'SUPPLIER',
    scopeKey: 'Валта',
    occurrences: 2,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
  assert.equal(result.evidence.totalRelevantEntries, 2);
});

test('AGENT_DISAGREEMENT_REPEAT distinguishes disagreement and agreement', () => {
  const result = evaluate([
    entry(1, {
      agentRecommendation: 'BUY',
      ownerDecision: 'SKIP',
    }),
    entry(2, {
      agentRecommendation: 'BUY',
      ownerDecision: 'SKIP',
    }),
    entry(3, {
      agentRecommendation: 'BUY',
      ownerDecision: 'BUY',
    }),
  ], {
    patternType: 'AGENT_DISAGREEMENT_REPEAT',
    scopeType: 'ITEM',
    dominantValue: 'BUY->SKIP',
    occurrences: 2,
    share: 2 / 3,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
  assert.equal(result.evidence.occurrences, 2);
  assert.equal(result.contradictions.count, 1);
  assert.deepEqual(result.contradictions.decisionIds, ['decision-003']);
});

test('unknown patternType returns controlled validation error', () => {
  assert.throws(() => evaluate(supportingEntries(3), {
    patternType: 'UNKNOWN_PATTERN',
  }), invalidError);
});

test('wrong scopeType returns controlled validation error', () => {
  assert.throws(() => evaluate(supportingEntries(3), {
    scopeType: 'BRAND',
  }), invalidError);
});

test('missing evidence decisionId is a scoped data-quality issue', () => {
  const result = evaluate(supportingEntries(3), {
    evidenceDecisionIds: ['decision-001', 'missing-id'],
  });
  assert.ok(
    result.dataQuality.warnings.includes(
      'MISSING_EVIDENCE_DECISION_ID'
    )
  );
  assert.ok(result.components.dataQualityPenalty > 0);
});

test('missing recordedAt is reported without throwing', () => {
  const result = evaluate([
    entry(1, { recordedAt: null }),
    entry(2),
  ], {
    occurrences: 2,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
  assert.equal(result.dataQuality.missingDates, 1);
  assert.ok(result.dataQuality.warnings.includes('MISSING_RECORDED_AT'));
});

test('invalid recordedAt is reported without throwing', () => {
  const result = evaluate([
    entry(1, { recordedAt: 'not-a-date' }),
    entry(2),
  ], {
    occurrences: 2,
    evidenceDecisionIds: ['decision-001', 'decision-002'],
  });
  assert.equal(result.dataQuality.missingDates, 1);
  assert.ok(result.dataQuality.warnings.includes('INVALID_RECORDED_AT'));
});

test('unsupported ownerDecision is a data-quality issue', () => {
  const result = evaluate([
    entry(1, { ownerDecision: 'UNKNOWN' }),
    entry(2),
  ], {
    occurrences: 1,
    evidenceDecisionIds: ['decision-002'],
  });
  assert.equal(result.dataQuality.unsupportedValues, 1);
  assert.ok(
    result.dataQuality.warnings.includes('UNSUPPORTED_OWNER_DECISION')
  );
});

test('unsupported reasonCode is a data-quality issue', () => {
  const result = evaluate([
    entry(1, { reasonCode: 'UNKNOWN_REASON' }),
    entry(2, { reasonCode: 'OTHER' }),
  ], {
    patternType: 'SAME_ITEM_SAME_REASON',
    scopeType: 'ITEM',
    dominantValue: 'OTHER',
    occurrences: 1,
    evidenceDecisionIds: ['decision-002'],
  });
  assert.equal(result.dataQuality.unsupportedValues, 1);
  assert.ok(
    result.dataQuality.warnings.includes('UNSUPPORTED_REASON_CODE')
  );
});

test('invalid dominantValue is a data-quality issue', () => {
  const result = evaluate(supportingEntries(3), {
    dominantValue: 'UNKNOWN',
  });
  assert.equal(result.evidence.occurrences, 0);
  assert.ok(
    result.dataQuality.warnings.includes('INVALID_DOMINANT_VALUE')
  );
});

test('missing pattern scope key is a data-quality issue', () => {
  const result = evaluate(supportingEntries(3), {
    scopeKey: null,
  });
  assert.equal(result.scopeKey, null);
  assert.ok(result.dataQuality.warnings.includes('MISSING_SCOPE_KEY'));
  assert.ok(result.components.dataQualityPenalty > 0);
});

test('invalid evidenceDecisionIds shape is a data-quality issue', () => {
  const result = evaluate(supportingEntries(3), {
    evidenceDecisionIds: 'decision-001',
  });
  assert.ok(
    result.dataQuality.warnings.includes(
      'INVALID_EVIDENCE_DECISION_IDS'
    )
  );
  assert.ok(result.components.dataQualityPenalty > 0);
});

test('LOW confidence is reachable and historical-only code is present', () => {
  const result = lowEvaluation();
  assert.equal(result.confidenceLevel, 'LOW');
  assert.ok(
    result.explanationCodes.includes(
      'CONFIDENCE_DESCRIBES_HISTORICAL_PATTERN_STRENGTH'
    )
  );
});

test('MEDIUM confidence is reachable', () => {
  assert.equal(mediumEvaluation().confidenceLevel, 'MEDIUM');
});

test('HIGH confidence is reachable', () => {
  assert.equal(highEvaluation().confidenceLevel, 'HIGH');
});

test('VERY_HIGH confidence is reachable', () => {
  assert.equal(veryHighEvaluation().confidenceLevel, 'VERY_HIGH');
});

test('evaluateAllPatternConfidences uses supplied analytics patterns', () => {
  const entries = supportingEntries(3);
  const analytics = {
    repeatedDecisionPatterns: [
      pattern(),
      pattern({
        patternType: 'BRAND_DECISION_BIAS',
        scopeType: 'BRAND',
        scopeKey: 'Alpha',
      }),
    ],
  };
  const results = evaluateAllPatternConfidences({
    analytics,
    history: history(entries),
    options: { asOf: AS_OF },
  });
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(item => item.patternType), [
    'SAME_ITEM_SAME_DECISION',
    'BRAND_DECISION_BIAS',
  ]);
});

test('evaluateAllPatternConfidences does not recompute absent patterns', () => {
  const results = evaluateAllPatternConfidences({
    analytics: { repeatedDecisionPatterns: [] },
    history: history(supportingEntries(8)),
    options: { asOf: AS_OF },
  });
  assert.deepEqual(results, []);
});

test('includeLowConfidence=false filters LOW evaluations', () => {
  const results = evaluateAllPatternConfidences({
    analytics: {
      repeatedDecisionPatterns: [
        pattern({
          occurrences: 1,
          evidenceDecisionIds: ['decision-001'],
        }),
        pattern({
          scopeKey: 'sku:SKU-2',
          occurrences: 2,
          evidenceDecisionIds: ['decision-002', 'decision-003'],
        }),
      ],
    },
    history: history([
      entry(1, {
        recordedAt: isoDaysBefore(500),
      }),
      entry(2, {
        stableItemKey: 'sku:SKU-2',
        recordedAt: isoDaysBefore(15),
      }),
      entry(3, {
        stableItemKey: 'sku:SKU-2',
        recordedAt: isoDaysBefore(5),
      }),
    ]),
    options: {
      asOf: AS_OF,
      includeLowConfidence: false,
    },
  });
  assert.equal(results.length, 1);
  assert.notEqual(results[0].confidenceLevel, 'LOW');
});

test('rankPatternsByConfidence follows every deterministic tie-breaker', () => {
  const base = {
    confidenceScore: 50,
    evidence: { occurrences: 3 },
    patternType: 'SAME_ITEM_SAME_DECISION',
    scopeType: 'ITEM',
    scopeKey: 'b',
  };
  const evaluations = [
    { ...base, scopeKey: 'b' },
    { ...base, scopeKey: 'a' },
    { ...base, patternType: 'BRAND_DECISION_BIAS', scopeType: 'BRAND' },
    { ...base, confidenceScore: 60 },
    { ...base, evidence: { occurrences: 4 } },
  ];
  const ranked = rankPatternsByConfidence({ evaluations });
  assert.equal(ranked[0].confidenceScore, 60);
  assert.equal(ranked[1].evidence.occurrences, 4);
  assert.equal(ranked[2].patternType, 'BRAND_DECISION_BIAS');
  assert.equal(ranked[3].scopeKey, 'a');
  assert.equal(ranked[4].scopeKey, 'b');
  assert.notStrictEqual(ranked, evaluations);
});

test('ranking limit truncates without mutating input', () => {
  const evaluations = [
    highEvaluation(),
    mediumEvaluation(),
    lowEvaluation(),
  ];
  const snapshot = structuredClone(evaluations);
  const ranked = rankPatternsByConfidence({
    evaluations,
    limit: 2,
  });
  assert.equal(ranked.length, 2);
  assert.deepEqual(evaluations, snapshot);
});

test('invalid asOf returns controlled validation error', () => {
  for (const asOf of [undefined, null, '2026-07-25', 'not-a-date']) {
    assert.throws(() => evaluatePatternConfidence({
      pattern: pattern(),
      history: history(supportingEntries(3)),
      options: { asOf },
    }), invalidError);
  }
});

test('invalid maxEvidenceDecisionIds returns controlled error', () => {
  for (const value of [0, 101, 1.5, '20']) {
    assert.throws(() => evaluate(
      supportingEntries(3),
      {},
      { maxEvidenceDecisionIds: value }
    ), invalidError);
  }
});

test('invalid includeLowConfidence returns controlled error', () => {
  assert.throws(() => evaluate(
    supportingEntries(3),
    {},
    { includeLowConfidence: 'yes' }
  ), invalidError);
});

test('invalid ranking limit returns controlled error', () => {
  for (const limit of [0, 101, 1.5, '2']) {
    assert.throws(() => rankPatternsByConfidence({
      evaluations: [],
      limit,
    }), invalidError);
  }
});

test('result never exposes ownerComment or metadata', () => {
  const result = evaluate(supportingEntries(3));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('ownerComment'), false);
  assert.equal(serialized.includes('metadata'), false);
  assert.equal(serialized.includes('Скрытый комментарий'), false);
  assert.equal(serialized.includes('Скрытые metadata'), false);
});

test('evaluation never mutates pattern, history, or options', () => {
  const sourcePattern = pattern();
  const sourceHistory = history(supportingEntries(3));
  const options = { asOf: AS_OF };
  const snapshot = structuredClone({
    sourcePattern,
    sourceHistory,
    options,
  });
  evaluatePatternConfidence({
    pattern: sourcePattern,
    history: sourceHistory,
    options,
  });
  assert.deepEqual(
    { sourcePattern, sourceHistory, options },
    snapshot
  );
});

test('identical inputs produce identical evaluations', () => {
  const sourcePattern = pattern();
  const sourceHistory = history(supportingEntries(3));
  const options = { asOf: AS_OF };
  const first = evaluatePatternConfidence({
    pattern: sourcePattern,
    history: sourceHistory,
    options,
  });
  const second = evaluatePatternConfidence({
    pattern: sourcePattern,
    history: sourceHistory,
    options,
  });
  assert.deepEqual(second, first);
});

test('empty analytics pattern list returns an empty list', () => {
  assert.deepEqual(evaluateAllPatternConfidences({
    analytics: { repeatedDecisionPatterns: [] },
    history: history([]),
    options: { asOf: AS_OF },
  }), []);
});

test('empty history returns a safe LOW evaluation', () => {
  const result = evaluate([]);
  assert.equal(result.confidenceLevel, 'LOW');
  assert.equal(result.evidence.occurrences, 0);
  assert.equal(result.dataQuality.insufficientEvidence, true);
});

test('null and undefined top-level inputs return controlled errors', () => {
  for (const input of [
    undefined,
    {},
    { pattern: null, history: history([]), options: { asOf: AS_OF } },
    { pattern: pattern(), history: null, options: { asOf: AS_OF } },
    { pattern: pattern(), history: history([]), options: null },
  ]) {
    assert.throws(
      () => evaluatePatternConfidence(input),
      invalidError
    );
  }
});

test('schema and component formula are explicit and reproducible', () => {
  const result = highEvaluation();
  const components = result.components;
  const expected = Math.max(0, Math.min(100, Math.round(
    components.occurrenceScore +
    components.dominanceScore +
    components.consistencyScore +
    components.recencyScore +
    components.durationScore -
    components.contradictionPenalty -
    components.dataQualityPenalty
  )));
  assert.equal(result.schemaVersion, CONFIDENCE_SCHEMA_VERSION);
  assert.equal(result.confidenceScore, expected);
});

test('existing analytics output can be evaluated without pattern recalculation', () => {
  const entries = supportingEntries(3);
  const analytics = analyzeOwnerDecisionHistory({
    history: history(entries),
    options: {
      minOccurrences: 3,
      generatedAt: AS_OF,
    },
  });
  const results = evaluateAllPatternConfidences({
    analytics,
    history: history(entries),
    options: { asOf: AS_OF },
  });
  assert.equal(
    results.length,
    analytics.repeatedDecisionPatterns.length
  );
  assert.ok(results.length >= 1);
});

test('practical 20-entry scenario represents every confidence level', () => {
  const entries = [];
  for (let index = 0; index < 8; index += 1) {
    entries.push(entry(entries.length + 1, {
      stableItemKey: 'sku:VERY-HIGH',
      recordedAt: isoDaysBefore(400 - index * 55),
      brand: 'VH',
      supplier: 'VH',
    }));
  }
  entries.at(-1).recordedAt = isoDaysBefore(5);
  for (let index = 0; index < 5; index += 1) {
    entries.push(entry(entries.length + 1, {
      stableItemKey: `sku:HIGH-${index}`,
      brand: 'High Brand',
      supplier: 'High Supplier',
      ownerDecision: index === 2 ? 'SKIP' : 'BUY',
      recordedAt: isoDaysBefore(120 - index * 28),
    }));
  }
  for (let index = 0; index < 2; index += 1) {
    entries.push(entry(entries.length + 1, {
      stableItemKey: `sku:MEDIUM-${index}`,
      brand: 'Medium Brand',
      supplier: 'Medium Supplier',
      recordedAt: isoDaysBefore(15 - index * 10),
    }));
  }
  entries.push(entry(entries.length + 1, {
    stableItemKey: 'sku:LOW',
    brand: 'Low Brand',
    supplier: 'Low Supplier',
    reasonCode: 'LOW_SALES',
    recordedAt: isoDaysBefore(500),
  }));
  for (let index = 0; index < 5; index += 1) {
    entries.push(entry(entries.length + 1, {
      stableItemKey: 'sku:DISAGREEMENT',
      brand: 'Disagreement Brand',
      supplier: 'Disagreement Supplier',
      agentRecommendation: 'BUY',
      ownerDecision: index === 2 ? 'BUY' : 'SKIP',
      recordedAt: isoDaysBefore(60 - index * 12),
    }));
  }
  assert.ok(entries.length >= 20);

  const patterns = [
    pattern({
      scopeKey: 'sku:VERY-HIGH',
      occurrences: 8,
      share: 1,
      evidenceDecisionIds: entries.slice(0, 8)
        .map(item => item.decisionId),
    }),
    pattern({
      patternType: 'BRAND_DECISION_BIAS',
      scopeType: 'BRAND',
      scopeKey: 'High Brand',
      occurrences: 4,
      share: 0.8,
      evidenceDecisionIds: entries.slice(8, 13)
        .filter(item => item.ownerDecision === 'BUY')
        .map(item => item.decisionId),
    }),
    pattern({
      patternType: 'SUPPLIER_DECISION_BIAS',
      scopeType: 'SUPPLIER',
      scopeKey: 'Medium Supplier',
      occurrences: 2,
      share: 1,
      evidenceDecisionIds: entries.slice(13, 15)
        .map(item => item.decisionId),
    }),
    pattern({
      patternType: 'SAME_ITEM_SAME_REASON',
      scopeType: 'ITEM',
      scopeKey: 'sku:LOW',
      dominantValue: 'LOW_SALES',
      occurrences: 1,
      share: 1,
      evidenceDecisionIds: [entries[15].decisionId],
    }),
    pattern({
      patternType: 'AGENT_DISAGREEMENT_REPEAT',
      scopeType: 'ITEM',
      scopeKey: 'sku:DISAGREEMENT',
      dominantValue: 'BUY->SKIP',
      occurrences: 4,
      share: 0.8,
      evidenceDecisionIds: entries.slice(16)
        .filter(item => item.ownerDecision === 'SKIP')
        .map(item => item.decisionId),
    }),
  ];
  const analytics = { repeatedDecisionPatterns: patterns };
  const sourceHistory = history(entries);
  const options = { asOf: AS_OF };
  const first = evaluateAllPatternConfidences({
    analytics,
    history: sourceHistory,
    options,
  });
  const second = evaluateAllPatternConfidences({
    analytics,
    history: sourceHistory,
    options,
  });
  const levels = new Set(first.map(item => item.confidenceLevel));
  assert.deepEqual(
    [...levels].sort(),
    ['HIGH', 'LOW', 'MEDIUM', 'VERY_HIGH']
  );
  assert.deepEqual(second, first);
  const ranked = rankPatternsByConfidence({ evaluations: first });
  assert.deepEqual(
    ranked.map(item => item.confidenceScore),
    [...ranked]
      .map(item => item.confidenceScore)
      .sort((left, right) => right - left)
  );
  for (const result of first) {
    const components = result.components;
    assert.equal(result.confidenceScore, Math.max(0, Math.min(100,
      components.occurrenceScore +
      components.dominanceScore +
      components.consistencyScore +
      components.recencyScore +
      components.durationScore -
      components.contradictionPenalty -
      components.dataQualityPenalty
    )));
  }
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes('ownerComment'), false);
  assert.equal(serialized.includes('metadata'), false);
});
