const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  OwnerLearningExplanationError,
  buildCandidateExplanation,
  buildCandidateExplanations,
} = require('../owner_learning/owner_learning_explanations');
const {
  buildRuleCandidates,
} = require('../owner_learning/owner_rule_candidate_ranking');

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
    occurrences: 5,
    dominantValue: 'BUY',
    share: 0.8,
    evidenceDecisionIds: [],
    ...overrides,
  };
}

function confidence(patternValue, overrides = {}) {
  const score = overrides.confidenceScore ?? 80;
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
      dominantShare: patternValue.share,
      supportingDecisionIdsCount: patternValue.occurrences,
      firstRecordedAt: '2026-03-27T00:00:00.000Z',
      lastRecordedAt: '2026-07-20T00:00:00.000Z',
      historySpanDays: 115,
      ...overrides.evidence,
    },
    components: {
      occurrenceScore: 20,
      dominanceScore: 20,
      recencyScore: 15,
      consistencyScore: 20,
      durationScore: 9,
      contradictionPenalty: 0,
      dataQualityPenalty: 0,
      ...overrides.components,
    },
    contradictions: {
      count: 0,
      share: 0,
      decisionIds: [],
      ...overrides.contradictions,
    },
    dataQuality: {
      missingDates: 0,
      unsupportedValues: 0,
      duplicateDecisionIds: 0,
      insufficientEvidence: false,
      warnings: [],
      ...overrides.dataQuality,
    },
    explanationCodes: [],
  };
}

function historyEntry(sequence, overrides = {}) {
  return {
    decisionId: `decision-${sequence}`,
    recordedAt: '2026-07-20T00:00:00.000Z',
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

function makeCandidate({
  patternOverrides,
  confidenceOverrides,
  history,
} = {}) {
  const patternValue = pattern(patternOverrides);
  return buildRuleCandidates({
    analytics: { repeatedDecisionPatterns: [patternValue] },
    confidenceEvaluations: [
      confidence(patternValue, confidenceOverrides),
    ],
    history: history || [
      historyEntry(1),
      historyEntry(2),
      historyEntry(3),
      historyEntry(4),
      historyEntry(5),
    ],
  })[0];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function invalidError(error) {
  return error instanceof OwnerLearningExplanationError &&
    error.code === 'OWNER_LEARNING_EXPLANATIONS_INVALID_INPUT';
}

test('ITEM candidate receives the item headline and facts', () => {
  const result = buildCandidateExplanation(makeCandidate());
  assert.equal(result.headline, 'Повторяющееся решение по товару');
  assert.match(result.summary, /решение BUY/);
  assert.ok(result.details.includes('Повторений: 5'));
  assert.ok(result.explanationCodes.includes('ITEM_SCOPE'));
});

test('BRAND candidate receives broad-scope explanation', () => {
  const result = buildCandidateExplanation(makeCandidate({
    patternOverrides: {
      patternType: 'BRAND_DECISION_BIAS',
      scopeType: 'BRAND',
      scopeKey: 'Alpha',
    },
  }));
  assert.equal(result.headline, 'Повторяющаяся особенность бренда');
  assert.ok(result.explanationCodes.includes('BRAND_SCOPE'));
  assert.ok(result.explanationCodes.includes('BROAD_SCOPE'));
  assert.ok(result.risks.includes('Большая область действия'));
});

test('SUPPLIER candidate receives broad-scope explanation', () => {
  const result = buildCandidateExplanation(makeCandidate({
    patternOverrides: {
      patternType: 'SUPPLIER_DECISION_BIAS',
      scopeType: 'SUPPLIER',
      scopeKey: 'Supplier A',
    },
  }));
  assert.equal(
    result.headline,
    'Повторяющаяся особенность поставщика'
  );
  assert.ok(result.explanationCodes.includes('SUPPLIER_SCOPE'));
  assert.ok(result.risks.includes('Большая область действия'));
});

test('reason GUIDANCE candidate uses guidance-only template', () => {
  const result = buildCandidateExplanation(makeCandidate({
    patternOverrides: {
      patternType: 'SAME_ITEM_SAME_REASON',
      dominantValue: 'LOW_SALES',
      occurrences: 3,
      share: 1,
    },
    confidenceOverrides: { confidenceScore: 45 },
  }));
  assert.equal(
    result.headline,
    'Повторяющаяся причина решения по товару'
  );
  assert.ok(result.explanationCodes.includes('GUIDANCE_ONLY'));
  assert.ok(result.risks.includes(
    'Кандидат предназначен только для рекомендации'
  ));
});

test('agent disagreement candidate has a fixed safe headline', () => {
  const result = buildCandidateExplanation(makeCandidate({
    patternOverrides: {
      patternType: 'AGENT_DISAGREEMENT_REPEAT',
      dominantValue: 'BUY->SKIP',
    },
  }));
  assert.equal(
    result.headline,
    'Повторяющееся расхождение с агентом'
  );
  assert.match(result.summary, /расхождение/);
  assert.ok(result.explanationCodes.includes('GUIDANCE_ONLY'));
});

test('LOW confidence is explained as a risk', () => {
  const result = buildCandidateExplanation(makeCandidate({
    confidenceOverrides: { confidenceScore: 20 },
  }));
  assert.ok(result.explanationCodes.includes('LOW_CONFIDENCE'));
  assert.ok(result.risks.includes('Низкий confidence'));
});

test('MEDIUM confidence uses a moderate code and strength', () => {
  const result = buildCandidateExplanation(makeCandidate({
    confidenceOverrides: { confidenceScore: 45 },
  }));
  assert.ok(result.explanationCodes.includes('MODERATE_CONFIDENCE'));
  assert.ok(result.strengths.includes('Умеренный confidence'));
});

test('HIGH confidence is explained as a strength', () => {
  const result = buildCandidateExplanation(makeCandidate({
    confidenceOverrides: { confidenceScore: 70 },
  }));
  assert.ok(result.explanationCodes.includes('HIGH_CONFIDENCE'));
  assert.ok(result.strengths.includes('Высокий confidence'));
});

test('VERY_HIGH confidence uses the high-confidence enum', () => {
  const result = buildCandidateExplanation(makeCandidate({
    confidenceOverrides: { confidenceScore: 90 },
  }));
  assert.ok(result.explanationCodes.includes('HIGH_CONFIDENCE'));
  assert.ok(result.strengths.includes('Высокий confidence'));
});

test('contradictions are exposed as a fixed risk', () => {
  const result = buildCandidateExplanation(makeCandidate({
    confidenceOverrides: {
      components: { contradictionPenalty: 15 },
      contradictions: { count: 2, share: 0.3 },
    },
  }));
  assert.ok(result.explanationCodes.includes('HAS_CONTRADICTIONS'));
  assert.ok(result.risks.includes('Есть противоречия'));
});

test('insufficient evidence recommends collecting more history', () => {
  const result = buildCandidateExplanation(makeCandidate({
    patternOverrides: { occurrences: 1 },
    confidenceOverrides: {
      confidenceScore: 20,
      evidence: {
        occurrences: 1,
        totalRelevantEntries: 1,
        supportingDecisionIdsCount: 1,
      },
      dataQuality: { insufficientEvidence: true },
    },
  }));
  assert.ok(
    result.explanationCodes.includes('INSUFFICIENT_EVIDENCE')
  );
  assert.ok(result.risks.includes('Недостаточно истории'));
  assert.equal(result.recommendedOwnerAction, 'COLLECT_MORE_HISTORY');
});

test('data-quality penalty is explained as a fixed risk', () => {
  const result = buildCandidateExplanation(makeCandidate({
    confidenceOverrides: {
      components: { dataQualityPenalty: 10 },
      dataQuality: { duplicateDecisionIds: 1 },
    },
  }));
  assert.ok(result.explanationCodes.includes('DATA_QUALITY_ISSUES'));
  assert.ok(result.risks.includes('Низкое качество данных'));
});

test('REVIEW_ONLY candidate recommends REVIEW_ONLY', () => {
  const result = buildCandidateExplanation(makeCandidate({
    patternOverrides: {
      patternType: 'SAME_ITEM_SAME_REASON',
      dominantValue: 'OTHER',
      occurrences: 3,
    },
    confidenceOverrides: { confidenceScore: 45 },
  }));
  assert.ok(result.explanationCodes.includes('REVIEW_ONLY'));
  assert.equal(result.recommendedOwnerAction, 'REVIEW_ONLY');
});

test('ELIGIBLE candidate recommends REVIEW_AND_APPROVE', () => {
  const result = buildCandidateExplanation(makeCandidate());
  assert.ok(result.explanationCodes.includes('ELIGIBLE_FOR_REVIEW'));
  assert.equal(result.recommendedOwnerAction, 'REVIEW_AND_APPROVE');
});

test('unsafe INELIGIBLE candidate recommends no rule', () => {
  const result = buildCandidateExplanation(makeCandidate({
    patternOverrides: {
      dominantValue: 'REVIEW',
      occurrences: 4,
    },
    confidenceOverrides: { confidenceScore: 45 },
  }));
  assert.ok(result.explanationCodes.includes('INELIGIBLE'));
  assert.ok(result.risks.includes(
    'Кандидат нельзя безопасно представить как правило'
  ));
  assert.equal(result.recommendedOwnerAction, 'DO_NOT_CREATE_RULE');
});

test('every recommended action belongs to the fixed enum', () => {
  const values = [
    buildCandidateExplanation(makeCandidate()),
    buildCandidateExplanation(makeCandidate({
      confidenceOverrides: { confidenceScore: 20 },
    })),
    buildCandidateExplanation(makeCandidate({
      patternOverrides: {
        patternType: 'SAME_ITEM_SAME_REASON',
        dominantValue: 'OTHER',
        occurrences: 3,
      },
      confidenceOverrides: { confidenceScore: 45 },
    })),
    buildCandidateExplanation(makeCandidate({
      patternOverrides: { dominantValue: 'REVIEW' },
      confidenceOverrides: { confidenceScore: 45 },
    })),
  ];
  const allowed = new Set([
    'REVIEW_AND_APPROVE',
    'REVIEW_ONLY',
    'COLLECT_MORE_HISTORY',
    'DO_NOT_CREATE_RULE',
  ]);
  assert.equal(values.every(value =>
    allowed.has(value.recommendedOwnerAction)
  ), true);
});

test('details have one deterministic fact per string', () => {
  const result = buildCandidateExplanation(makeCandidate());
  assert.deepEqual(result.details, [
    'Повторений: 5',
    'Confidence: 80',
    'Priority: HIGH',
    'Dominant share: 80%',
    'История: 115 дней',
    'Статус кандидата: ELIGIBLE',
  ]);
  assert.equal(result.details.every(value => !value.includes('\n')), true);
});

test('summary never exceeds 200 characters for supported types', () => {
  const candidates = [
    makeCandidate(),
    makeCandidate({
      patternOverrides: {
        patternType: 'SAME_ITEM_SAME_REASON',
        dominantValue: 'OTHER',
      },
    }),
    makeCandidate({
      patternOverrides: {
        patternType: 'BRAND_DECISION_BIAS',
        scopeType: 'BRAND',
        scopeKey: 'Alpha',
      },
    }),
    makeCandidate({
      patternOverrides: {
        patternType: 'SUPPLIER_DECISION_BIAS',
        scopeType: 'SUPPLIER',
        scopeKey: 'Supplier A',
      },
    }),
    makeCandidate({
      patternOverrides: {
        patternType: 'AGENT_DISAGREEMENT_REPEAT',
        dominantValue: 'BUY->SKIP',
      },
    }),
  ];
  const results = buildCandidateExplanations(candidates);
  assert.equal(results.every(result => result.summary.length <= 200), true);
});

test('strong history factors appear only at fixed thresholds', () => {
  const strong = buildCandidateExplanation(makeCandidate());
  const weak = buildCandidateExplanation(makeCandidate({
    patternOverrides: { occurrences: 2 },
    confidenceOverrides: {
      confidenceScore: 45,
      evidence: {
        occurrences: 2,
        totalRelevantEntries: 2,
        supportingDecisionIdsCount: 2,
        historySpanDays: 20,
      },
    },
  }));
  assert.ok(strong.explanationCodes.includes('STRONG_HISTORY'));
  assert.ok(strong.strengths.includes('Высокая повторяемость'));
  assert.ok(strong.strengths.includes('Большой период наблюдений'));
  assert.ok(weak.explanationCodes.includes('WEAK_HISTORY'));
});

test('explanation codes are unique and in fixed order', () => {
  const result = buildCandidateExplanation(makeCandidate());
  assert.deepEqual(result.explanationCodes, [
    'HIGH_CONFIDENCE',
    'STRONG_HISTORY',
    'ITEM_SCOPE',
    'ELIGIBLE_FOR_REVIEW',
    'MANUAL_REVIEW_REQUIRED',
  ]);
  assert.equal(
    result.explanationCodes.length,
    new Set(result.explanationCodes).size
  );
});

test('all explanations explicitly require manual review', () => {
  const results = buildCandidateExplanations([
    makeCandidate(),
    makeCandidate({
      patternOverrides: {
        patternType: 'BRAND_DECISION_BIAS',
        scopeType: 'BRAND',
        scopeKey: 'Alpha',
      },
    }),
  ]);
  assert.equal(results.every(result =>
    result.explanationCodes.includes('MANUAL_REVIEW_REQUIRED')
  ), true);
});

test('output shape contains exactly the seven public fields', () => {
  const result = buildCandidateExplanation(makeCandidate());
  assert.deepEqual(Object.keys(result).sort(), [
    'details',
    'explanationCodes',
    'headline',
    'recommendedOwnerAction',
    'risks',
    'strengths',
    'summary',
  ]);
});

test('output never exposes ownerComment, metadata or decisionId', () => {
  const candidate = makeCandidate();
  candidate.ownerComment = 'private';
  candidate.metadata = { private: true };
  candidate.decisionId = 'decision-private';
  const serialized = JSON.stringify(
    buildCandidateExplanation(candidate)
  );
  assert.equal(serialized.includes('ownerComment'), false);
  assert.equal(serialized.includes('metadata'), false);
  assert.equal(serialized.includes('decisionId'), false);
  assert.equal(serialized.includes('private'), false);
});

test('scope keys and candidate IDs are never copied to explanation', () => {
  const candidate = makeCandidate({
    patternOverrides: { scopeKey: 'sku:SECRET-SCOPE' },
  });
  const serialized = JSON.stringify(
    buildCandidateExplanation(candidate)
  );
  assert.equal(serialized.includes('SECRET-SCOPE'), false);
  assert.equal(serialized.includes(candidate.candidateId), false);
});

test('templates never emit HTML', () => {
  const candidate = makeCandidate();
  candidate.ownerComment = '<script>alert(1)</script>';
  candidate.metadata = { html: '<b>private</b>' };
  const serialized = JSON.stringify(
    buildCandidateExplanation(candidate)
  );
  assert.equal(/[<>]/.test(serialized), false);
});

test('identical candidate produces deterministic output', () => {
  const candidate = makeCandidate();
  assert.deepEqual(
    buildCandidateExplanation(candidate),
    buildCandidateExplanation(candidate)
  );
});

test('single explanation does not mutate candidate', () => {
  const candidate = makeCandidate();
  const before = clone(candidate);
  buildCandidateExplanation(candidate);
  assert.deepEqual(candidate, before);
});

test('batch explanation does not mutate candidate array', () => {
  const candidates = [makeCandidate(), makeCandidate({
    patternOverrides: {
      patternType: 'BRAND_DECISION_BIAS',
      scopeType: 'BRAND',
      scopeKey: 'Alpha',
    },
  })];
  const before = clone(candidates);
  buildCandidateExplanations(candidates);
  assert.deepEqual(candidates, before);
});

test('batch explanation preserves input order', () => {
  const brand = makeCandidate({
    patternOverrides: {
      patternType: 'BRAND_DECISION_BIAS',
      scopeType: 'BRAND',
      scopeKey: 'Alpha',
    },
  });
  const item = makeCandidate();
  const results = buildCandidateExplanations([brand, item]);
  assert.deepEqual(results.map(value => value.headline), [
    'Повторяющаяся особенность бренда',
    'Повторяющееся решение по товару',
  ]);
});

test('empty candidate array returns an empty array', () => {
  assert.deepEqual(buildCandidateExplanations([]), []);
});

test('null and undefined candidate handling is controlled', () => {
  for (const value of [null, undefined, {}, []]) {
    assert.throws(
      () => buildCandidateExplanation(value),
      invalidError
    );
  }
});

test('invalid batch input returns controlled error', () => {
  for (const value of [null, undefined, {}, 'candidate']) {
    assert.throws(
      () => buildCandidateExplanations(value),
      invalidError
    );
  }
});

test('unsupported candidate type returns controlled error', () => {
  const candidate = makeCandidate();
  candidate.patternType = 'UNKNOWN_PATTERN';
  assert.throws(
    () => buildCandidateExplanation(candidate),
    invalidError
  );
});

test('invalid confidence contract returns controlled error', () => {
  const candidate = makeCandidate();
  candidate.confidence = { score: 90, level: 'LOW' };
  assert.throws(
    () => buildCandidateExplanation(candidate),
    invalidError
  );
});

test('invalid priority contract returns controlled error', () => {
  const candidate = makeCandidate();
  candidate.ranking.priorityLevel = 'CRITICAL';
  assert.throws(
    () => buildCandidateExplanation(candidate),
    invalidError
  );
});
