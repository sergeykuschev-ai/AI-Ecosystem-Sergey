const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');

const {
  createPurchasingWebServer,
} = require('../server');

const GENERATED_AT = '2026-07-27T00:00:00.000Z';

function result(status = 'AVAILABLE') {
  const unavailable = status === 'UNAVAILABLE';
  return {
    status,
    generatedAt: unavailable ? null : GENERATED_AT,
    score: unavailable ? null : 82,
    grade: unavailable ? null : 'GOOD',
    summary: unavailable ? null : {
      totalRules: 1,
      activeRules: 1,
      disabledRules: 0,
      healthyRules: 1,
      attentionRules: 0,
      criticalRules: 0,
      duplicateGroups: 0,
      conflictGroups: 0,
      staleRules: 0,
      noEffectRules: 0,
      inconsistentRules: 0,
    },
    dimensions: unavailable ? null : Object.fromEntries([
      ['consistency', 25],
      ['effectiveness', 20],
      ['freshness', 15],
      ['dataQuality', 15],
      ['safety', 15],
      ['maintainability', 10],
    ].map(([name, weight]) => [name, {
      score: 82,
      weight,
      findingsCount: 0,
      criticalFindings: 0,
      explanationCodes: [],
    }])),
    findings: [],
    rules: [],
    dataQuality: unavailable ? null : {
      warnings: [],
    },
    explanationCodes: [],
    warnings: status === 'PARTIAL'
      ? ['OWNER_RULE_EFFECTIVENESS_UNAVAILABLE']
      : [],
  };
}

async function withServer(service, operation) {
  const server = createPurchasingWebServer({
    ownerKnowledgeHealthService: service,
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
          json: JSON.parse(body),
        });
      });
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

for (const status of ['AVAILABLE', 'PARTIAL', 'UNAVAILABLE']) {
  test(`GET health returns ${status} in API v1 envelope`, async () => {
    await withServer({
      getKnowledgeHealth() {
        return result(status);
      },
      getRuleHealth() {},
      getFindings() {},
    }, async port => {
      const response = await request(
        port,
        '/api/v1/owner-learning/knowledge-health'
      );
      assert.equal(response.statusCode, 200);
      assert.equal(response.json.api_version, 'v1');
      assert.equal(response.json.data.status, status);
    });
  });
}

test('GET rule detail and findings are mapped', async () => {
  await withServer({
    getKnowledgeHealth() {},
    getRuleHealth({ ruleId }) {
      return {
        status: 'AVAILABLE',
        generatedAt: GENERATED_AT,
        rule: {
          ruleId,
          status: 'ACTIVE',
          decision: 'BUY',
          displayScope: { primary: '<b>Товар</b>' },
          score: 100,
          grade: 'EXCELLENT',
          classification: 'HEALTHY',
          signals: {},
          findings: [],
          explanationCodes: [],
        },
        warnings: [],
      };
    },
    getFindings() {
      return {
        status: 'AVAILABLE',
        generatedAt: GENERATED_AT,
        findings: [],
        warnings: [],
      };
    },
  }, async port => {
    const detail = await request(
      port,
      '/api/v1/owner-learning/knowledge-health/rules/rule-1'
    );
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json.data.rule.rule_id, 'rule-1');
    assert.equal(
      detail.json.data.rule.display_scope.primary,
      '<b>Товар</b>'
    );
    const findings = await request(
      port,
      '/api/v1/owner-learning/knowledge-health/findings'
    );
    assert.equal(findings.statusCode, 200);
    assert.deepEqual(findings.json.data.findings, []);
  });
});

test('query parsing passes filters and numeric options', async () => {
  let received;
  await withServer({
    getKnowledgeHealth(input) {
      received = input;
      return result();
    },
    getRuleHealth() {},
    getFindings() {},
  }, async port => {
    await request(
      port,
      '/api/v1/owner-learning/knowledge-health' +
      '?status=ACTIVE&limit=7&staleRuleAfterDays=45'
    );
  });
  assert.equal(received.filters.status, 'ACTIVE');
  assert.equal(received.options.limit, 7);
  assert.equal(received.options.staleRuleAfterDays, 45);
});

test('invalid query is 400 and rule not found is 404', async () => {
  await withServer({
    getKnowledgeHealth() {
      return result();
    },
    getRuleHealth() {
      const error = new Error('Правило не найдено.');
      error.code = 'OWNER_KNOWLEDGE_HEALTH_RULE_NOT_FOUND';
      throw error;
    },
    getFindings() {},
  }, async port => {
    const invalid = await request(
      port,
      '/api/v1/owner-learning/knowledge-health?limit=0'
    );
    assert.equal(invalid.statusCode, 400);
    assert.equal(
      invalid.json.error.code,
      'OWNER_KNOWLEDGE_HEALTH_INVALID_INPUT'
    );
    const missing = await request(
      port,
      '/api/v1/owner-learning/knowledge-health/rules/missing'
    );
    assert.equal(missing.statusCode, 404);
    assert.equal(
      missing.json.error.code,
      'OWNER_KNOWLEDGE_HEALTH_RULE_NOT_FOUND'
    );
  });
});

test('knowledge health has no write routes', async () => {
  await withServer({
    getKnowledgeHealth() {
      return result();
    },
    getRuleHealth() {},
    getFindings() {},
  }, async port => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await request(
        port,
        '/api/v1/owner-learning/knowledge-health',
        method
      );
      assert.equal(response.statusCode, 404);
      assert.equal(response.json.error.code, 'ROUTE_NOT_FOUND');
    }
  });
});
