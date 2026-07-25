const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');

const {
  createPurchasingWebServer,
} = require('../server');
const {
  OwnerLearningCandidatesService,
} = require('../application/owner_learning_candidates_service');
const {
  createMaterializedRuleCard,
} = require('../public/app');
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

function decisionEntries() {
  return Array.from({ length: 5 }, (_, index) =>
    createDecisionHistoryEntry({
      recordedAt:
        `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      source: 'OWNER_REVIEW',
      runId: `run-${index + 1}`,
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
    })
  );
}

function materializedRule({
  index,
  candidateId,
  decision,
  status,
  confidenceScore,
  confidenceLevel,
  priorityScore,
  priorityLevel,
  name,
}) {
  const materializedAt =
    `2026-07-${String(20 + index).padStart(2, '0')}T04:00:00.000Z`;
  return {
    ruleId: `approved-rule-practical-${index}`,
    proposalId: `materialization-practical-${index}`,
    stableItemKey: `sku:${7177003 + index}`,
    name,
    brand: null,
    ruleType: 'ITEM_DECISION_OVERRIDE',
    approvedDecision: decision,
    approvedAt: materializedAt,
    status,
    createdFromVersion: 'owner-rule-materialization-v0.9.0',
    notes: null,
    scopeType: 'ITEM',
    scopeKey: `sku:${7177003 + index}`,
    action: {
      decision,
      quantityStrategy: decision === 'BUY'
        ? 'KEEP_AGENT_QUANTITY'
        : 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    source: 'OWNER_LEARNING_CANDIDATE',
    createdAt: materializedAt,
    updatedAt: materializedAt,
    provenance: {
      source: 'OWNER_LEARNING_CANDIDATE',
      candidateId,
      lifecycleEventId: `lifecycle-practical-${index}`,
      patternType: 'SAME_ITEM_SAME_DECISION',
      confidenceScore,
      confidenceLevel,
      priorityScore,
      priorityLevel,
      eligibilityStatus: 'ELIGIBLE',
      materializedAt,
      materializationVersion: 'v0.9.0',
    },
  };
}

function legacyRule() {
  return {
    ruleId: 'approved-rule-legacy-practical',
    proposalId: 'proposal-legacy-practical',
    stableItemKey: 'sku:legacy',
    name: 'Legacy rule',
    brand: null,
    ruleType: 'ITEM_DECISION',
    approvedDecision: 'BUY',
    approvedAt: '2026-06-01T00:00:00.000Z',
    status: 'ACTIVE',
    createdFromVersion: 'owner-rule-proposals-v0.3',
    notes: null,
  };
}

function materializationEvent(rule) {
  return {
    schemaVersion: MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
    materializationId: rule.proposalId,
    recordedAt: rule.provenance.materializedAt,
    candidateId: rule.provenance.candidateId,
    lifecycleEventId: rule.provenance.lifecycleEventId,
    ruleId: rule.ruleId,
    resultStatus: 'CREATED',
    ruleStatus: 'DISABLED',
    fingerprint: `fingerprint-${rule.ruleId}`,
    snapshot: {
      patternType: rule.provenance.patternType,
      proposedRuleType: rule.ruleType,
      proposedDecision: rule.approvedDecision,
      confidenceScore: rule.provenance.confidenceScore,
      confidenceLevel: rule.provenance.confidenceLevel,
      priorityScore: rule.provenance.priorityScore,
      priorityLevel: rule.provenance.priorityLevel,
    },
    metadata: {},
  };
}

async function request(server, requestPath) {
  return new Promise((resolve, reject) => {
    const outgoing = http.get({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    outgoing.on('error', reject);
  });
}

function fakeElement() {
  return {
    children: [],
    className: '',
    dataset: {},
    textContent: '',
    append(...children) {
      this.children.push(...children);
    },
    addEventListener() {},
    set innerHTML(value) {
      throw new Error(`Unsafe innerHTML: ${value}`);
    },
  };
}

function visibleText(element) {
  return [
    element.textContent,
    ...(element.children || []).map(visibleText),
  ].join(' ');
}

test('practical read-only materialized rules registry is safe and fail-soft',
  async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'materialized-rules-practical-')
    );
    const historyPath = path.join(directory, 'history.json');
    const lifecyclePath = path.join(directory, 'lifecycle.json');
    const materializationsPath = path.join(
      directory,
      'materializations.json'
    );
    const registryPath = path.join(directory, 'rules.json');
    const registryMarkdownPath = path.join(directory, 'rules.md');
    try {
      const entries = decisionEntries();
      atomicWriteDecisionHistory(historyPath, {
        schemaVersion: HISTORY_SCHEMA_VERSION,
        updatedAt: entries.at(-1).recordedAt,
        entries,
      });
      const candidatesService = new OwnerLearningCandidatesService({
        historyFilePath: historyPath,
        lifecycleFilePath: lifecyclePath,
        materializationsFilePath: materializationsPath,
        now: () => '2026-07-25T08:00:00.000Z',
        logger: { warn() {} },
      });
      const currentCandidate =
        candidatesService.getCandidates().candidates.find(candidate =>
          candidate.patternType === 'SAME_ITEM_SAME_DECISION' &&
          candidate.scopeType === 'ITEM'
        );
      assert.ok(currentCandidate);
      const lifecycleEvent = createCandidateLifecycleEvent({
        recordedAt: '2026-07-19T04:00:00.000Z',
        candidateId: currentCandidate.candidateId,
        fromStatus: 'NEW',
        toStatus: 'APPROVED',
        action: 'APPROVE',
        actor: 'OWNER',
        reasonCode: 'READY_FOR_RULE',
        ownerComment: null,
        candidateSnapshot: {
          patternType: currentCandidate.patternType,
          scopeType: currentCandidate.scopeType,
          displayScope: currentCandidate.displayScope,
          proposedRuleType: currentCandidate.proposedRuleType,
          proposedDecision: currentCandidate.proposedAction.decision,
          confidenceScore: currentCandidate.confidence.score,
          confidenceLevel: currentCandidate.confidence.level,
          priorityScore: currentCandidate.ranking.priorityScore,
          priorityLevel: currentCandidate.ranking.priorityLevel,
          eligibilityStatus: currentCandidate.eligibility.status,
        },
        metadata: { source: 'PRACTICAL_TEST' },
      });
      atomicWriteCandidateLifecycle(lifecyclePath, {
        schemaVersion: LIFECYCLE_SCHEMA_VERSION,
        updatedAt: lifecycleEvent.recordedAt,
        events: [lifecycleEvent],
      });

      const rules = [
        materializedRule({
          index: 1,
          candidateId: currentCandidate.candidateId,
          decision: 'SKIP',
          status: 'DISABLED',
          confidenceScore: 91,
          confidenceLevel: 'VERY_HIGH',
          priorityScore: 88,
          priorityLevel: 'HIGH',
          name: '<img src=x onerror=alert(1)>',
        }),
        materializedRule({
          index: 2,
          candidateId: 'b'.repeat(64),
          decision: 'BUY',
          status: 'ACTIVE',
          confidenceScore: 75,
          confidenceLevel: 'HIGH',
          priorityScore: 61,
          priorityLevel: 'MEDIUM',
          name: 'BUY product',
        }),
        materializedRule({
          index: 3,
          candidateId: 'c'.repeat(64),
          decision: 'DEFER',
          status: 'DISABLED',
          confidenceScore: 58,
          confidenceLevel: 'MEDIUM',
          priorityScore: 45,
          priorityLevel: 'LOW',
          name: 'DEFER product',
        }),
        materializedRule({
          index: 4,
          candidateId: 'd'.repeat(64),
          decision: 'BUY',
          status: 'DISABLED',
          confidenceScore: 82,
          confidenceLevel: 'HIGH',
          priorityScore: 96,
          priorityLevel: 'CRITICAL',
          name: 'Second BUY product',
        }),
      ];
      saveApprovedRules({
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        updatedAt: rules.at(-1).updatedAt,
        rules: [...rules, legacyRule()],
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

      const server = createPurchasingWebServer({
        registry: {},
        ownerDecisionService: {},
        queryService: {
          getRunStatus(runId) {
            return { run_id: runId, status: 'completed' };
          },
          getOwnerReview(runId) {
            return { run_id: runId, items: [] };
          },
        },
        ownerDecisionAnalyticsService: { getAnalytics() {} },
        ownerLearningCandidatesService: candidatesService,
        ownerDecisionHistoryFilePath: historyPath,
        ownerLearningCandidateLifecycleFilePath: lifecyclePath,
        ownerLearningRuleMaterializationsFilePath:
          materializationsPath,
        approvedRulesPath: registryPath,
        logger: { warn() {}, error() {} },
        now: () => '2026-07-25T08:00:00.000Z',
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        const list = await request(
          server,
          '/api/v1/owner-learning/materialized-rules'
        );
        assert.equal(list.statusCode, 200);
        assert.deepEqual(list.body.data.summary, {
          totalRules: 4,
          activeRules: 1,
          disabledRules: 3,
          buyRules: 2,
          skipRules: 1,
          deferRules: 1,
          currentCandidateAvailable: 1,
          currentCandidateUnavailable: 3,
        });
        assert.equal(list.body.data.rules.length, 4);
        assert.equal(
          list.body.data.rules.some(value =>
            value.ruleId === 'approved-rule-legacy-practical'
          ),
          false
        );
        assert.equal(
          list.body.data.rules.find(value =>
            value.status === 'ACTIVE'
          ).safety.affectsPurchasing,
          true
        );
        assert.equal(
          list.body.data.rules.filter(value =>
            value.status === 'DISABLED'
          ).every(value => value.safety.affectsPurchasing === false),
          true
        );

        for (const [query, expected] of [
          ['status=DISABLED', 3],
          ['decision=BUY', 2],
          ['confidenceLevel=VERY_HIGH', 1],
          ['priorityLevel=CRITICAL', 1],
          ['candidateAvailability=UNAVAILABLE', 3],
          ['dateFrom=2026-07-23&dateTo=2026-07-23', 1],
          ['search=DEFER%20product', 1],
          ['sortBy=confidenceScore&sortDirection=asc&limit=2', 2],
        ]) {
          const response = await request(
            server,
            `/api/v1/owner-learning/materialized-rules?${query}`
          );
          assert.equal(response.statusCode, 200, query);
          assert.equal(response.body.data.rules.length, expected, query);
        }
        const sorted = await request(
          server,
          '/api/v1/owner-learning/materialized-rules?' +
          'sortBy=confidenceScore&sortDirection=asc&limit=2'
        );
        assert.deepEqual(
          sorted.body.data.rules.map(value =>
            value.provenance.confidenceScore
          ),
          [58, 75]
        );
        const detail = await request(
          server,
          '/api/v1/owner-learning/materialized-rules/' +
          rules[0].ruleId
        );
        assert.equal(detail.statusCode, 200);
        assert.equal(
          detail.body.data.rule.displayScope.primary,
          '<img src=x onerror=alert(1)>'
        );
        const json = JSON.stringify(list.body);
        for (const forbidden of [
          'stableItemKey',
          'scopeKey',
          'fingerprint',
          'metadata',
          'ownerComment',
          'lifecycleEventId',
        ]) {
          assert.equal(json.includes(forbidden), false, forbidden);
        }

        const documentObject = {
          createElement() {
            return fakeElement();
          },
        };
        const card = createMaterializedRuleCard(
          documentObject,
          list.body.data.rules.find(value =>
            value.candidateAvailability.status === 'UNAVAILABLE'
          )
        );
        const visible = visibleText(card);
        assert.match(visible, /Подробнее/);
        assert.match(visible, /Текущий кандидат больше не формируется/);
        assert.doesNotMatch(
          visible,
          /Активировать|Выключить|Удалить|Изменить|Применить/
        );
        assert.equal(visible.includes('approved-rule-practical'), false);

        const registrySource = fs.readFileSync(registryPath, 'utf8');
        fs.writeFileSync(registryPath, '{broken', 'utf8');
        const unavailable = await request(
          server,
          '/api/v1/owner-learning/materialized-rules'
        );
        assert.equal(unavailable.statusCode, 200);
        assert.equal(unavailable.body.data.status, 'UNAVAILABLE');
        assert.equal(
          (await request(server, '/api/v1/runs/safe-run')).statusCode,
          200
        );
        fs.writeFileSync(registryPath, registrySource, 'utf8');

        fs.writeFileSync(materializationsPath, '{broken', 'utf8');
        const journalFallback = await request(
          server,
          '/api/v1/owner-learning/materialized-rules'
        );
        assert.equal(journalFallback.statusCode, 200);
        assert.equal(journalFallback.body.data.rules.length, 4);
        assert.equal(
          journalFallback.body.data.warning,
          'OWNER_RULE_MATERIALIZATION_HISTORY_UNAVAILABLE'
        );
      } finally {
        server.close();
        await once(server, 'close');
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
);
