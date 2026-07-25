const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');

const {
  createPurchasingWebServer,
} = require('../server');

const RULE_ID = 'approved-rule-safe';

function rule() {
  return {
    ruleId: RULE_ID,
    status: 'DISABLED',
    ruleType: 'ITEM_DECISION_OVERRIDE',
    displayScope: {
      primary: '<img src=x onerror=alert(1)>',
      secondary: '7177004',
    },
    action: {
      decision: 'SKIP',
      quantityStrategy: 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    source: {
      type: 'OWNER_LEARNING_CANDIDATE',
      label: 'Кандидат Owner Learning',
    },
    provenance: {
      candidateId: 'a'.repeat(64),
      patternType: 'SAME_ITEM_SAME_DECISION',
      confidenceScore: 91,
      confidenceLevel: 'VERY_HIGH',
      priorityScore: 88,
      priorityLevel: 'HIGH',
      eligibilityStatus: 'ELIGIBLE',
      materializedAt: '2026-07-25T04:00:00.000Z',
      materializationVersion: 'v0.9.0',
      lifecycleEventId: 'private',
    },
    lifecycle: {
      status: 'APPROVED',
      lastAction: 'APPROVE',
      lastRecordedAt: '2026-07-24T04:00:00.000Z',
      reasonCode: 'READY_FOR_RULE',
    },
    candidateAvailability: { status: 'AVAILABLE' },
    timestamps: {
      createdAt: '2026-07-25T04:00:00.000Z',
      updatedAt: '2026-07-25T04:00:00.000Z',
    },
    safety: {
      affectsPurchasing: false,
      message: 'Правило неактивно и не влияет на закупку.',
    },
    scopeKey: 'private',
    stableItemKey: 'private',
    fingerprint: 'private',
    metadata: { private: true },
    ownerComment: 'private',
  };
}

function listResult(overrides = {}) {
  return {
    status: 'AVAILABLE',
    generatedAt: '2026-07-25T08:00:00.000Z',
    summary: {
      totalRules: 1,
      activeRules: 0,
      disabledRules: 1,
      buyRules: 0,
      skipRules: 1,
      deferRules: 0,
      currentCandidateAvailable: 1,
      currentCandidateUnavailable: 0,
    },
    rules: [rule()],
    warning: null,
    ...overrides,
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

async function withServer(materializedRulesService, operation, extra = {}) {
  const server = createPurchasingWebServer({
    registry: {
      getStatus(runId) {
        return { run_id: runId, status: 'completed' };
      },
    },
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
    ownerLearningCandidatesService: {
      getCandidates() {
        return {
          status: 'AVAILABLE',
          generatedAt: '2026-07-25T08:00:00.000Z',
          summary: {
            totalCandidates: 0,
            historyEntries: 0,
            patternsFound: 0,
          },
          candidates: [],
          warning: null,
        };
      },
    },
    ownerLearningCandidateLifecycleService: {
      getCandidateStates() {
        return { summary: {}, states: [] };
      },
    },
    ownerRuleMaterializationService: {},
    ownerMaterializedRulesService: materializedRulesService,
    ...extra,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await operation(server);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('GET list returns v1 envelope and strict allowlist DTO', async () => {
  await withServer({
    listRules() {
      return listResult();
    },
  }, async server => {
    const response = await request(
      server,
      '/api/v1/owner-learning/materialized-rules'
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.api_version, 'v1');
    assert.equal(response.body.data.status, 'AVAILABLE');
    assert.equal(response.body.data.summary.totalRules, 1);
    assert.equal(response.body.data.rules[0].ruleId, RULE_ID);
    const json = JSON.stringify(response.body);
    for (const forbidden of [
      'scopeKey',
      'stableItemKey',
      'fingerprint',
      'metadata',
      'ownerComment',
      'lifecycleEventId',
      'stack',
    ]) {
      assert.equal(json.includes(forbidden), false, forbidden);
    }
  });
});

test('GET list validates and forwards filters, sorting and limit', async () => {
  let input;
  await withServer({
    listRules(value) {
      input = value;
      return listResult({ rules: [], summary: {
        ...listResult().summary,
        totalRules: 0,
      } });
    },
  }, async server => {
    const query = new URLSearchParams({
      status: 'disabled',
      decision: 'skip',
      confidenceLevel: 'very_high',
      priorityLevel: 'high',
      lifecycleStatus: 'approved',
      candidateAvailability: 'available',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-25',
      search: 'AWARD 7177004',
      sortBy: 'confidenceScore',
      sortDirection: 'asc',
      limit: '25',
    });
    const response = await request(
      server,
      `/api/v1/owner-learning/materialized-rules?${query}`
    );
    assert.equal(response.statusCode, 200);
  });
  assert.deepEqual(input, {
    filters: {
      status: 'DISABLED',
      decision: 'SKIP',
      confidenceLevel: 'VERY_HIGH',
      priorityLevel: 'HIGH',
      lifecycleStatus: 'APPROVED',
      candidateAvailability: 'AVAILABLE',
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-25T23:59:59.999Z',
      search: 'AWARD 7177004',
    },
    options: {
      sortBy: 'confidenceScore',
      sortDirection: 'asc',
      limit: 25,
    },
  });
});

test('invalid query values return 400 with required code', async () => {
  await withServer({
    listRules() {
      throw new Error('must not be called');
    },
  }, async server => {
    for (const query of [
      'status=BROKEN',
      'dateFrom=2026-02-30',
      'limit=0',
      'sortBy=name',
      'unknown=value',
    ]) {
      const response = await request(
        server,
        `/api/v1/owner-learning/materialized-rules?${query}`
      );
      assert.equal(response.statusCode, 400, query);
      assert.equal(
        response.body.error.code,
        'OWNER_MATERIALIZED_RULES_INVALID_INPUT',
        query
      );
    }
  });
});

test('GET detail returns allowlisted rule and missing returns 404', async () => {
  await withServer({
    listRules() {
      return listResult();
    },
    getRule({ ruleId }) {
      if (ruleId !== RULE_ID) {
        throw Object.assign(new Error('not found'), {
          code: 'OWNER_MATERIALIZED_RULE_NOT_FOUND',
        });
      }
      return {
        status: 'AVAILABLE',
        generatedAt: '2026-07-25T08:00:00.000Z',
        rule: rule(),
        warning: null,
      };
    },
  }, async server => {
    const detail = await request(
      server,
      `/api/v1/owner-learning/materialized-rules/${RULE_ID}`
    );
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.body.data.rule.ruleId, RULE_ID);
    const missing = await request(
      server,
      '/api/v1/owner-learning/materialized-rules/missing-rule'
    );
    assert.equal(missing.statusCode, 404);
    assert.equal(
      missing.body.error.code,
      'OWNER_MATERIALIZED_RULE_NOT_FOUND'
    );
  });
});

test('registry unavailable remains a successful fail-safe envelope', async () => {
  await withServer({
    listRules() {
      return {
        status: 'UNAVAILABLE',
        generatedAt: null,
        summary: null,
        rules: [],
        warning: 'OWNER_MATERIALIZED_RULES_UNAVAILABLE',
      };
    },
  }, async server => {
    const response = await request(
      server,
      '/api/v1/owner-learning/materialized-rules'
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.status, 'UNAVAILABLE');
    assert.equal(response.body.data.generated_at, null);
    assert.deepEqual(response.body.data.rules, []);
  });
});

test('existing candidates, lifecycle, run-status and Owner Review remain readable',
  async () => {
    await withServer({
      listRules() {
        return listResult();
      },
    }, async server => {
      const runId = '11111111-1111-4111-8111-111111111111';
      for (const [requestPath, expected] of [
        ['/api/v1/owner-learning/candidates', 200],
        ['/api/v1/owner-learning/candidate-lifecycle', 200],
        [`/api/v1/runs/${runId}`, 200],
        [`/api/v1/runs/${runId}/owner-review`, 200],
      ]) {
        const response = await request(server, requestPath);
        assert.equal(response.statusCode, expected, requestPath);
      }
    });
  }
);
