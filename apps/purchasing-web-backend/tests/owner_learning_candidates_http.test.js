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
  HISTORY_SCHEMA_VERSION,
  atomicWriteDecisionHistory,
  createDecisionHistoryEntry,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);
const {
  OwnerLearningCandidatesService,
} = require('../application/owner_learning_candidates_service');

function candidateResult(overrides = {}) {
  return {
    status: 'AVAILABLE',
    generatedAt: '2026-07-25T00:00:00.000Z',
    summary: {
      totalCandidates: 0,
      eligible: 0,
      reviewOnly: 0,
      ineligible: 0,
      highPriority: 0,
      criticalPriority: 0,
      confidenceLevels: {
        LOW: 0,
        MEDIUM: 0,
        HIGH: 0,
        VERY_HIGH: 0,
      },
    },
    candidates: [],
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

async function withServer(ownerLearningCandidatesService, operation, {
  queryService,
} = {}) {
  const server = createPurchasingWebServer({
    registry: {},
    ownerDecisionService: {},
    queryService: queryService || {},
    ownerDecisionAnalyticsService: {
      getAnalytics() {
        return {
          status: 'UNAVAILABLE',
          analytics: null,
          warning: 'OWNER_DECISION_ANALYTICS_UNAVAILABLE',
        };
      },
    },
    ownerLearningCandidatesService,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await operation(server);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('GET candidates returns 200 AVAILABLE with API v1 envelope', async () => {
  await withServer({
    getCandidates() {
      return candidateResult();
    },
  }, async server => {
    const response = await request(
      server,
      '/api/v1/owner-learning/candidates'
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.api_version, 'v1');
    assert.equal(response.body.data.status, 'AVAILABLE');
    assert.equal(
      response.body.data.generated_at,
      '2026-07-25T00:00:00.000Z'
    );
    assert.deepEqual(response.body.data.candidates, []);
  });
});

test('GET candidates returns fail-safe UNAVAILABLE as 200', async () => {
  await withServer({
    getCandidates() {
      return {
        status: 'UNAVAILABLE',
        generatedAt: null,
        summary: null,
        candidates: [],
        warning: 'OWNER_LEARNING_CANDIDATES_UNAVAILABLE',
      };
    },
  }, async server => {
    const response = await request(
      server,
      '/api/v1/owner-learning/candidates'
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data, {
      status: 'UNAVAILABLE',
      generated_at: null,
      summary: null,
      candidates: [],
      warning: 'OWNER_LEARNING_CANDIDATES_UNAVAILABLE',
    });
  });
});

test('candidate history filters and all option groups are forwarded', async () => {
  let received;
  await withServer({
    getCandidates(input) {
      received = input;
      return candidateResult();
    },
  }, async server => {
    const query = new URLSearchParams({
      source: 'OWNER_REVIEW',
      supplier: 'Валта',
      brand: 'AWARD',
      category: 'Корм',
      stableItemKey: 'sku:7177004',
      ownerDecision: 'SKIP',
      reasonCode: 'LOW_SALES',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-25',
      minOccurrences: '2',
      dominantShareThreshold: '0.7',
      maxItems: '50',
      asOf: '2026-07-25T00:00:00.000Z',
      maxEvidenceDecisionIds: '20',
      includeLowConfidence: 'true',
      minOccurrencesForEligibility: '3',
      minDominantShareForEligibility: '0.75',
      maxContradictionShareForEligibility: '0.2',
      includeIneligible: 'false',
      limit: '25',
    });
    const response = await request(
      server,
      `/api/v1/owner-learning/candidates?${query}`
    );
    assert.equal(response.statusCode, 200);
  });

  assert.deepEqual(received, {
    filters: {
      supplier: 'Валта',
      brand: 'AWARD',
      category: 'Корм',
      stableItemKey: 'sku:7177004',
      source: 'OWNER_REVIEW',
      ownerDecision: 'SKIP',
      reasonCode: 'LOW_SALES',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-25',
    },
    analyticsOptions: {
      minOccurrences: 2,
      dominantShareThreshold: 0.7,
      maxItems: 50,
    },
    confidenceOptions: {
      asOf: '2026-07-25T00:00:00.000Z',
      maxEvidenceDecisionIds: 20,
      includeLowConfidence: true,
    },
    rankingOptions: {
      minOccurrencesForEligibility: 3,
      minDominantShareForEligibility: 0.75,
      maxContradictionShareForEligibility: 0.2,
      includeIneligible: false,
      limit: 25,
    },
  });
});

test('invalid candidate query values return the dedicated 400 error', async () => {
  const invalidQueries = [
    'asOf=2026-07-25',
    'asOf=2026-07-25T00%3A00%3A00%2B03%3A00',
    'includeLowConfidence=yes',
    'includeIneligible=1',
    'dominantShareThreshold=1.1',
    'minDominantShareForEligibility=-0.1',
    'maxContradictionShareForEligibility=2',
    'limit=0',
    'limit=101',
    'maxItems=101',
    'unsupported=true',
  ];
  await withServer({
    getCandidates() {
      throw new Error('service must not receive invalid input');
    },
  }, async server => {
    for (const query of invalidQueries) {
      const response = await request(
        server,
        `/api/v1/owner-learning/candidates?${query}`
      );
      assert.equal(response.statusCode, 400, query);
      assert.equal(
        response.body.error.code,
        'OWNER_LEARNING_CANDIDATES_INVALID_INPUT',
        query
      );
    }
  });
});

test('other endpoints still work when candidates are unavailable', async () => {
  await withServer({
    getCandidates() {
      return {
        status: 'UNAVAILABLE',
        generatedAt: null,
        summary: null,
        candidates: [],
        warning: 'OWNER_LEARNING_CANDIDATES_UNAVAILABLE',
      };
    },
  }, async server => {
    const response = await request(server, '/api/v1/runs/run-1');
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.status, 'completed');
  }, {
    queryService: {
      getRunStatus(runId) {
        return { run_id: runId, status: 'completed' };
      },
    },
  });
});

test('corrupted temporary journal keeps candidates and run status safe', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'candidate-http-corrupted-')
  );
  const historyFilePath = path.join(directory, 'history.json');
  fs.writeFileSync(historyFilePath, '{corrupted');
  const service = new OwnerLearningCandidatesService({
    historyFilePath,
    now: () => '2026-07-25T00:00:00.000Z',
    logger: { warn() {} },
  });
  try {
    await withServer(service, async server => {
      const candidates = await request(
        server,
        '/api/v1/owner-learning/candidates'
      );
      assert.equal(candidates.statusCode, 200);
      assert.equal(candidates.body.data.status, 'UNAVAILABLE');

      const runStatus = await request(server, '/api/v1/runs/run-1');
      assert.equal(runStatus.statusCode, 200);
      assert.equal(runStatus.body.data.status, 'completed');
    }, {
      queryService: {
        getRunStatus(runId) {
          return { run_id: runId, status: 'completed' };
        },
      },
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('candidate endpoint is GET-only and exposes no write route', async () => {
  await withServer({
    getCandidates() {
      return candidateResult();
    },
  }, async server => {
    const response = await new Promise((resolve, reject) => {
      const outgoing = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: '/api/v1/owner-learning/candidates',
        method: 'POST',
      }, incoming => {
        const chunks = [];
        incoming.on('data', chunk => chunks.push(chunk));
        incoming.on('end', () => resolve({
          statusCode: incoming.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }));
      });
      outgoing.on('error', reject);
      outgoing.end();
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.error.code, 'ROUTE_NOT_FOUND');
  });
});

test('practical 25-entry HTTP run covers safe ranked candidate review', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'candidate-http-practical-')
  );
  const historyFilePath = path.join(directory, 'history.json');
  const asOf = '2026-07-25T00:00:00.000Z';
  const dayMs = 24 * 60 * 60 * 1000;
  const entries = [];
  const add = ({
    daysBefore,
    stableItemKey,
    sku,
    productName,
    brand,
    supplier,
    ownerDecision = 'BUY',
    reasonCode = 'OTHER',
    agentRecommendation = 'BUY',
  }) => {
    const sequence = entries.length + 1;
    entries.push(createDecisionHistoryEntry({
      recordedAt: new Date(
        Date.parse(asOf) - daysBefore * dayMs
      ).toISOString(),
      source: 'OWNER_REVIEW',
      runId: `practical-run-${sequence}`,
      supplier,
      stableItemKey,
      sku,
      productName,
      brand,
      category: 'Корм',
      agentRecommendation,
      agentQuantity: 5,
      ownerDecision,
      ownerQuantity: ownerDecision === 'BUY' ? 7 : 0,
      reasonCode,
      ownerComment: '<private-comment>',
      ruleId: null,
      applicationMode: 'PREVIEW',
      financialContext: {},
      inventoryContext: {},
      salesContext: {},
      metadata: { private: true },
    }));
  };
  for (const daysBefore of [400, 345, 290, 235, 180, 125, 60, 5]) {
    add({
      daysBefore,
      stableItemKey: 'sku:VERY-HIGH',
      sku: 'VERY-HIGH',
      productName: '<img src=x onerror=alert(1)>',
      brand: 'VH Brand',
      supplier: 'VH Supplier',
    });
  }
  for (let index = 0; index < 5; index += 1) {
    add({
      daysBefore: 120 - index * 28,
      stableItemKey: `sku:HIGH-${index}`,
      sku: `HIGH-${index}`,
      productName: `High ${index}`,
      brand: 'High Brand',
      supplier: 'High Supplier',
      ownerDecision: index === 2 ? 'SKIP' : 'BUY',
    });
  }
  for (let index = 0; index < 2; index += 1) {
    add({
      daysBefore: 15 - index * 10,
      stableItemKey: `sku:MEDIUM-${index}`,
      sku: `MEDIUM-${index}`,
      productName: `Medium ${index}`,
      brand: 'Medium Brand',
      supplier: 'Medium Supplier',
    });
  }
  add({
    daysBefore: 500,
    stableItemKey: 'sku:LOW',
    sku: 'LOW',
    productName: 'Low',
    brand: 'Low Brand',
    supplier: 'Low Supplier',
    reasonCode: 'LOW_SALES',
  });
  for (let index = 0; index < 5; index += 1) {
    add({
      daysBefore: 60 - index * 12,
      stableItemKey: 'sku:DISAGREEMENT',
      sku: 'DISAGREEMENT',
      productName: 'Disagreement',
      brand: 'Disagreement Brand',
      supplier: 'Disagreement Supplier',
      ownerDecision: index === 2 ? 'BUY' : 'SKIP',
      agentRecommendation: 'BUY',
    });
  }
  for (const daysBefore of [150, 50, 10, 3]) {
    add({
      daysBefore,
      stableItemKey: 'sku:ELIGIBLE-B',
      sku: 'ELIGIBLE-B',
      productName: 'Eligible B',
      brand: 'Eligible Brand',
      supplier: 'Eligible Supplier',
    });
  }
  assert.equal(entries.length, 25);
  atomicWriteDecisionHistory(historyFilePath, {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: asOf,
    entries,
  });
  const before = fs.readFileSync(historyFilePath);
  const service = new OwnerLearningCandidatesService({
    historyFilePath,
    now: () => asOf,
    logger: { warn() {} },
  });

  try {
    await withServer(service, async server => {
      const baseQuery =
        'minOccurrences=1&includeLowConfidence=true&' +
        'includeIneligible=true&limit=100';
      const response = await request(
        server,
        `/api/v1/owner-learning/candidates?${baseQuery}`
      );
      assert.equal(response.statusCode, 200);
      const data = response.body.data;
      assert.equal(data.status, 'AVAILABLE');
      assert.ok(data.summary.totalCandidates >= 7);
      assert.ok(data.summary.eligible >= 2);
      assert.ok(data.summary.reviewOnly >= 3);
      assert.ok(data.summary.ineligible >= 1);
      assert.deepEqual(
        new Set(data.candidates.map(value => value.scopeType)),
        new Set(['ITEM', 'BRAND', 'SUPPLIER'])
      );
      assert.deepEqual(
        new Set(data.candidates.map(value => value.confidence.level)),
        new Set(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'])
      );
      assert.deepEqual(
        new Set(data.candidates.map(
          value => value.ranking.priorityLevel
        )),
        new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
      );
      assert.deepEqual(
        data.candidates.map(value => value.ranking.rank),
        Array.from(
          { length: data.candidates.length },
          (_, index) => index + 1
        )
      );
      const unsafe = JSON.stringify(data);
      for (const forbidden of [
        'scopeKey',
        'decisionId',
        'evidenceDecisionIds',
        'ownerComment',
        'metadata',
        '<private-comment>',
      ]) {
        assert.equal(unsafe.includes(forbidden), false);
      }
      assert.equal(
        data.candidates.find(value =>
          value.displayScope.primary.includes('<img')
        ).displayScope.secondary,
        'SKU VERY-HIGH'
      );

      const limited = await request(
        server,
        `/api/v1/owner-learning/candidates?${baseQuery}&limit=3`
      );
      assert.equal(limited.body.data.candidates.length, 3);

      const filtered = await request(
        server,
        `/api/v1/owner-learning/candidates?${baseQuery}` +
          '&supplier=VH%20Supplier'
      );
      assert.ok(
        filtered.body.data.summary.totalCandidates <
          data.summary.totalCandidates
      );

      const eligibleOnly = await request(
        server,
        '/api/v1/owner-learning/candidates?minOccurrences=1&' +
          'includeLowConfidence=true&includeIneligible=false&limit=100'
      );
      assert.equal(
        eligibleOnly.body.data.candidates.some(value =>
          value.eligibility.status === 'INELIGIBLE'
        ),
        false
      );
    });
    assert.deepEqual(fs.readFileSync(historyFilePath), before);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(directory), false);
});
