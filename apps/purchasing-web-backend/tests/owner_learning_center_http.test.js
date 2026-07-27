const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { once } = require('node:events');

const {
  createPurchasingWebServer,
} = require('../server');

const GENERATED_AT = '2026-07-27T00:00:00.000Z';

function centerResult(status = 'AVAILABLE') {
  const unavailable = status === 'UNAVAILABLE';
  return {
    status,
    generatedAt: unavailable ? null : GENERATED_AT,
    summary: unavailable
      ? null
      : {
        decisions: { total: 4, uniqueItems: 2, agreementRate: 0.5 },
        candidates: {
          total: 1,
          eligible: 1,
          reviewOnly: 0,
          ineligible: 0,
          approved: 0,
          postponed: 0,
          rejected: 0,
        },
        rules: {
          total: 1,
          active: 1,
          disabled: 0,
          buy: 1,
          skip: 0,
          defer: 0,
        },
        effectiveness: status === 'PARTIAL'
          ? null
          : {
            withData: 1,
            effective: 1,
            occasional: 0,
            noEffectYet: 0,
            stale: 0,
            reviewRecommended: 0,
            insufficientData: 0,
            totalOrderAmountDelta: -25,
          },
      },
    attention: { total: 0, items: [] },
    recentActivity: [],
    systemHealth: {
      overallStatus: unavailable
        ? 'UNAVAILABLE'
        : (status === 'PARTIAL' ? 'DEGRADED' : 'HEALTHY'),
      components: {},
      dataQualityWarnings: [],
      lastKnowledgeChangeAt: null,
      lastRuleStatusChangeAt: null,
      lastRuleEffectAt: null,
    },
    sections: {},
    warnings: unavailable
      ? ['OWNER_LEARNING_CENTER_UNAVAILABLE']
      : (
        status === 'PARTIAL'
          ? ['OWNER_RULE_EFFECTIVENESS_UNAVAILABLE']
          : []
      ),
  };
}

async function withServer(service, operation) {
  const server = createPurchasingWebServer({
    ownerLearningCenterService: service,
    logger: { warn() {}, error() {} },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await operation(server.address().port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function request(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body,
          json: JSON.parse(body),
        });
      });
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('GET center returns AVAILABLE in the API v1 envelope', async () => {
  await withServer({
    getOverview() {
      return centerResult('AVAILABLE');
    },
  }, async port => {
    const response = await request(
      port,
      '/api/v1/owner-learning/center'
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.json.api_version, 'v1');
    assert.equal(response.json.data.status, 'AVAILABLE');
    assert.equal(response.json.data.generated_at, GENERATED_AT);
    assert.equal(
      response.json.data.summary.effectiveness
        .total_order_amount_delta,
      -25
    );
  });
});

test('GET center returns PARTIAL with HTTP 200', async () => {
  await withServer({
    getOverview() {
      return centerResult('PARTIAL');
    },
  }, async port => {
    const response = await request(
      port,
      '/api/v1/owner-learning/center'
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.json.data.status, 'PARTIAL');
    assert.equal(response.json.data.summary.effectiveness, null);
  });
});

test('GET center returns the safe UNAVAILABLE contract', async () => {
  await withServer({
    getOverview() {
      return centerResult('UNAVAILABLE');
    },
  }, async port => {
    const response = await request(
      port,
      '/api/v1/owner-learning/center'
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.json.data.status, 'UNAVAILABLE');
    assert.equal(response.json.data.generated_at, null);
    assert.equal(response.json.data.summary, null);
    assert.deepEqual(response.json.data.attention, {
      total: 0,
      items: [],
    });
  });
});

test('center query filters and options reach the service', async () => {
  let captured;
  await withServer({
    getOverview(input) {
      captured = input;
      return centerResult();
    },
  }, async port => {
    const response = await request(
      port,
      '/api/v1/owner-learning/center?' +
      'supplier=%D0%92%D0%B0%D0%BB%D1%82%D0%B0&brand=AWARD&' +
      'category=%D0%9A%D0%BE%D1%80%D0%BC&dateFrom=2026-07-01&' +
      'dateTo=2026-07-27&attentionLimit=5&activityLimit=6&' +
      'asOf=2026-07-27T00%3A00%3A00.000Z'
    );
    assert.equal(response.statusCode, 200);
  });
  assert.deepEqual(captured, {
    filters: {
      supplier: 'Валта',
      brand: 'AWARD',
      category: 'Корм',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-27',
    },
    options: {
      attentionLimit: 5,
      activityLimit: 6,
      asOf: GENERATED_AT,
    },
  });
});

for (const query of [
  'attentionLimit=0',
  'activityLimit=101',
  'asOf=2026-07-27',
  'asOf=2026-02-30T00%3A00%3A00.000Z',
  'unknown=value',
  'dateFrom=2026-07-28&dateTo=2026-07-27',
]) {
  test(`invalid center query returns 400: ${query}`, async () => {
    await withServer({
      getOverview() {
        throw new Error('must not run');
      },
    }, async port => {
      const response = await request(
        port,
        `/api/v1/owner-learning/center?${query}`
      );
      assert.equal(response.statusCode, 400);
      assert.equal(
        response.json.error.code,
        'OWNER_LEARNING_CENTER_INVALID_INPUT'
      );
    });
  });
}

test('there is no write route for the center', async () => {
  await withServer({
    getOverview() {
      return centerResult();
    },
  }, async port => {
    const response = await request(
      port,
      '/api/v1/owner-learning/center',
      'POST'
    );
    assert.equal(response.statusCode, 404);
    assert.equal(response.json.error.code, 'ROUTE_NOT_FOUND');
  });
});

test('existing owner-learning endpoint remains routable', async () => {
  await withServer({
    getOverview() {
      return centerResult();
    },
  }, async port => {
    const response = await request(
      port,
      '/api/v1/owner-learning/decision-history/analytics'
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.json.api_version, 'v1');
    assert.ok(['AVAILABLE', 'UNAVAILABLE'].includes(
      response.json.data.status
    ));
  });
});

test('run-status and Owner Review routes remain registered', async () => {
  await withServer({
    getOverview() {
      return centerResult();
    },
  }, async port => {
    const id = '00000000-0000-4000-8000-000000000000';
    const status = await request(port, `/api/v1/runs/${id}`);
    const review = await request(
      port,
      `/api/v1/runs/${id}/owner-review`
    );
    assert.equal(status.statusCode, 404);
    assert.equal(status.json.error.code, 'RUN_NOT_FOUND');
    assert.equal(review.statusCode, 404);
    assert.equal(review.json.error.code, 'RUN_NOT_FOUND');
  });
});
