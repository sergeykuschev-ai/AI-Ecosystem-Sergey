const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  OwnerKnowledgeHealthService,
} = require('../application/owner_knowledge_health_service');
const {
  OwnerLearningCenterService,
} = require('../application/owner_learning_center_service');
const {
  DEFAULT_SERVER_PATHS,
} = require('../config');

const AS_OF = '2026-07-27T00:00:00.000Z';
const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), {
      recursive: true,
      force: true,
    });
  }
});

function digestFile(filePath) {
  if (!fs.existsSync(filePath)) return 'MISSING';
  return crypto.createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function productionHashes() {
  return Object.fromEntries([
    'approvedRulesPath',
    'ownerLearningCandidateLifecycleFilePath',
    'ownerLearningRuleMaterializationsFilePath',
    'ownerLearningRuleStatusEventsFilePath',
    'ownerLearningRuleActivationPreviewsFilePath',
    'ownerLearningRuleEffectivenessFilePath',
  ].map(name => [name, digestFile(DEFAULT_SERVER_PATHS[name])]));
}

function rule(id, overrides = {}) {
  const decision = overrides.decision || 'BUY';
  return {
    ruleId: id,
    status: overrides.status || 'ACTIVE',
    ruleType: 'ITEM_DECISION_OVERRIDE',
    scopeType: 'ITEM',
    scopeKey: overrides.scopeKey || `sku:${id}`,
    stableItemKey: overrides.scopeKey || `sku:${id}`,
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ||
      '2026-07-20T00:00:00.000Z',
    provenance: overrides.missingProvenance
      ? null
      : {
        candidateId: `candidate-${id}`,
        confidenceLevel: 'HIGH',
        priorityLevel: 'HIGH',
      },
  };
}

function effect(ruleId, overrides = {}) {
  return {
    ruleId,
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
        lastAppliedAt: overrides.lastAppliedAt ||
          '2026-07-20T00:00:00.000Z',
        daysSinceLastApplied: overrides.daysSinceLastApplied ?? 7,
        consecutiveNoEffectRuns: 0,
      },
    },
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
}

function practicalStorage() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'knowledge-health-practical-')
  );
  temporaryDirectories.push(directory);
  const files = {
    registry: path.join(directory, 'registry.json'),
    materializations: path.join(directory, 'materializations.json'),
    lifecycle: path.join(directory, 'lifecycle.json'),
    statuses: path.join(directory, 'statuses.json'),
    effectiveness: path.join(directory, 'effectiveness.json'),
  };
  const rules = [
    rule('conflict-buy', {
      scopeKey: 'sku:<b>conflict</b>',
      name: '<img src=x onerror=alert(1)>',
    }),
    rule('conflict-skip', {
      scopeKey: 'sku:<b>conflict</b>',
      decision: 'SKIP',
    }),
    rule('duplicate-one', { scopeKey: 'sku:duplicate' }),
    rule('duplicate-two', { scopeKey: 'sku:duplicate' }),
    rule('stale'),
    rule('healthy'),
    rule('no-effect'),
    rule('missing-provenance', { missingProvenance: true }),
  ];
  writeJson(files.registry, rules);
  writeJson(files.materializations, [
    ...rules.filter(value => value.ruleId !== 'missing-provenance')
      .map(value => ({ ruleId: value.ruleId })),
    { ruleId: 'orphan-materialization' },
  ]);
  writeJson(files.lifecycle, rules
    .filter(value => value.provenance)
    .map(value => ({
      candidateId: value.provenance.candidateId,
      status: 'APPROVED',
    })));
  writeJson(files.statuses, [
    ...rules.map(value => ({
      ruleId: value.ruleId,
      toStatus: value.status,
      recordedAt: '2026-07-21T00:00:00.000Z',
    })),
    { ruleId: 'orphan-status', toStatus: 'ACTIVE' },
  ]);
  writeJson(files.effectiveness, [
    ...rules.map(value => {
      if (value.ruleId === 'stale') {
        return effect(value.ruleId, {
          classification: 'STALE',
          lastAppliedAt: '2025-01-01T00:00:00.000Z',
          daysSinceLastApplied: 572,
        });
      }
      if (value.ruleId === 'no-effect') {
        return effect(value.ruleId, {
          classification: 'NO_EFFECT_YET',
          appliedEffectRuns: 0,
        });
      }
      return effect(value.ruleId);
    }),
    effect('orphan-effectiveness'),
  ]);
  return { directory, files, rules };
}

function storageService(storage) {
  return new OwnerKnowledgeHealthService({
    materializedRulesService: {
      getKnowledgeHealthSnapshot({ asOf }) {
        let rules;
        try {
          rules = JSON.parse(fs.readFileSync(
            storage.files.registry,
            'utf8'
          ));
        } catch {
          return {
            status: 'UNAVAILABLE',
            warnings: ['OWNER_MATERIALIZED_RULES_UNAVAILABLE'],
          };
        }
        const read = name => {
          try {
            return JSON.parse(fs.readFileSync(
              storage.files[name],
              'utf8'
            ));
          } catch {
            return null;
          }
        };
        const materializations = read('materializations');
        const lifecycleStates = read('lifecycle');
        const statusEvents = read('statuses');
        const effectivenessSummaries = read('effectiveness');
        const unavailable = [
          materializations,
          lifecycleStates,
          statusEvents,
          effectivenessSummaries,
        ].some(value => value === null);
        return {
          status: unavailable ? 'PARTIAL' : 'AVAILABLE',
          generatedAt: asOf,
          rules,
          materializations: materializations || [],
          lifecycleStates: lifecycleStates || [],
          statusEvents: statusEvents || [],
          effectivenessSummaries: effectivenessSummaries || [],
          warnings: unavailable
            ? ['OWNER_RULE_EFFECTIVENESS_UNAVAILABLE']
            : [],
        };
      },
    },
    now: () => new Date(AS_OF),
    logger: { warn() {} },
  });
}

function centerWithHealth(healthService) {
  return new OwnerLearningCenterService({
    decisionAnalyticsService: {
      getAnalytics() {
        return {
          status: 'AVAILABLE',
          analytics: {
            population: { filteredEntries: 0, uniqueItems: 0 },
            agreementAnalysis: { agreementRate: null },
            dataQuality: { warnings: [] },
          },
        };
      },
    },
    candidatesService: {
      getCandidates() {
        return {
          status: 'AVAILABLE',
          summary: { totalCandidates: 0 },
          candidates: [],
        };
      },
    },
    candidateLifecycleService: {
      getCandidateStates() {
        return { summary: {}, states: [] };
      },
    },
    materializedRulesService: {
      getCenterSnapshot() {
        return {
          status: 'AVAILABLE',
          summary: {
            totalRules: 8,
            activeRules: 8,
            disabledRules: 0,
          },
          rules: [],
          centerSnapshot: {
            materializationEvents: [],
            statusEvents: [],
            warnings: [],
          },
        };
      },
    },
    ruleEffectivenessService: {
      getCenterSnapshot() {
        return {
          status: 'AVAILABLE',
          summary: { totalRules: 8 },
          rules: [],
          centerSnapshot: { events: [] },
        };
      },
    },
    knowledgeHealthService: healthService,
    now: () => new Date(AS_OF),
    logger: { warn() {} },
  });
}

test('practical temporary storage covers health, degradation and SHA safety', () => {
  const productionBefore = productionHashes();
  const storage = practicalStorage();
  const healthService = storageService(storage);
  const result = healthService.getKnowledgeHealth({
    options: { asOf: AS_OF },
  });
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(Number.isInteger(result.score), true);
  assert.ok([
    'EXCELLENT',
    'GOOD',
    'FAIR',
    'POOR',
    'CRITICAL',
  ].includes(result.grade));
  assert.deepEqual(Object.keys(result.dimensions), [
    'consistency',
    'effectiveness',
    'freshness',
    'dataQuality',
    'safety',
    'maintainability',
  ]);
  assert.equal(result.summary.conflictGroups, 1);
  assert.equal(result.summary.duplicateGroups, 1);
  assert.ok(result.summary.staleRules >= 1);
  assert.ok(result.summary.noEffectRules >= 1);
  assert.equal(result.dataQuality.orphanMaterializations, 1);
  assert.equal(result.dataQuality.orphanStatusEvents, 1);
  assert.equal(result.dataQuality.orphanEffectivenessSummaries, 1);
  assert.ok(result.rules.some(value =>
    value.classification === 'CRITICAL'
  ));
  assert.ok(result.rules.some(value =>
    value.classification === 'HEALTHY'
  ));

  const filtered = healthService.getKnowledgeHealth({
    filters: { findingType: 'RULE_CONFLICT' },
    options: { asOf: AS_OF, sortBy: 'score', sortDirection: 'asc' },
  });
  assert.equal(filtered.rules.length, 2);
  assert.ok(filtered.findings.every(value =>
    value.type === 'RULE_CONFLICT'
  ));

  const center = centerWithHealth(healthService).getOverview({
    options: { asOf: AS_OF },
  });
  assert.equal(center.summary.knowledgeHealth.score, result.score);
  assert.ok(center.attention.items.some(value =>
    value.type === 'RULE_CONFLICT'
  ));

  fs.writeFileSync(storage.files.effectiveness, '{', 'utf8');
  const partial = healthService.getKnowledgeHealth({
    options: { asOf: AS_OF },
  });
  assert.equal(partial.status, 'PARTIAL');
  assert.equal(partial.rules.length, 8);

  fs.writeFileSync(storage.files.registry, '{', 'utf8');
  const unavailable = healthService.getKnowledgeHealth({
    options: { asOf: AS_OF },
  });
  assert.equal(unavailable.status, 'UNAVAILABLE');

  assert.deepEqual(productionHashes(), productionBefore);
});
