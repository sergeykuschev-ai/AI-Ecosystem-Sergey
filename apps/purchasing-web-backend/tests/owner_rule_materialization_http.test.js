const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');

const {
  createPurchasingWebServer,
} = require('../server');

const CANDIDATE_ID = 'a'.repeat(64);

function result(status = 'CREATED') {
  return {
    status,
    candidate: {
      candidateId: CANDIDATE_ID,
      displayScope: {
        primary: '<b>AWARD Hairball</b>',
        secondary: 'SKU 7177004',
      },
    },
    rule: {
      ruleId: 'approved-rule-safe',
      status: 'DISABLED',
      ruleType: 'ITEM_DECISION_OVERRIDE',
      approvedDecision: 'SKIP',
      action: { quantityStrategy: 'NO_QUANTITY_CHANGE' },
      createdAt: '2026-07-25T04:00:00.000Z',
    },
  };
}

async function request(server, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const source = body === undefined ? null : JSON.stringify(body);
    const outgoing = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
      method,
      headers: source === null ? {} : {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(source),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    outgoing.on('error', reject);
    if (source !== null) outgoing.write(source);
    outgoing.end();
  });
}

async function withServer(materializationService, operation) {
  const server = createPurchasingWebServer({
    registry: {},
    ownerDecisionService: {},
    queryService: {},
    ownerDecisionAnalyticsService: { getAnalytics() {} },
    ownerLearningCandidatesService: { getCandidates() {} },
    ownerLearningCandidateLifecycleService: {},
    ownerRuleMaterializationService: materializationService,
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

test('confirmed POST returns CREATED 201 with allowlisted DTO', async () => {
  let input;
  await withServer({
    materializeCandidateRule(value) {
      input = value;
      return result();
    },
  }, async server => {
    const response = await request(
      server,
      'POST',
      `/api/v1/owner-learning/candidates/${CANDIDATE_ID}/materialize-rule`,
      { confirmation: true }
    );
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.data.status, 'CREATED');
    assert.equal(response.body.data.rule.status, 'DISABLED');
    assert.equal(
      response.body.data.message,
      'Правило создано как неактивное и пока не влияет на закупку.'
    );
    const json = JSON.stringify(response.body);
    for (const forbidden of [
      'provenance',
      'lifecycleEventId',
      'scopeKey',
      'metadata',
    ]) {
      assert.equal(json.includes(forbidden), false);
    }
  });
  assert.deepEqual(input, { candidateId: CANDIDATE_ID });
});

test('duplicate POST returns ALREADY_MATERIALIZED 200', async () => {
  await withServer({
    materializeCandidateRule() {
      return result('ALREADY_MATERIALIZED');
    },
  }, async server => {
    const response = await request(
      server,
      'POST',
      `/api/v1/owner-learning/candidates/${CANDIDATE_ID}/materialize-rule`,
      { confirmation: true }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.body.data.status,
      'ALREADY_MATERIALIZED'
    );
  });
});

test('confirmation is required and body is strict', async () => {
  await withServer({
    materializeCandidateRule() {
      throw new Error('must not be called');
    },
  }, async server => {
    const endpoint =
      `/api/v1/owner-learning/candidates/${CANDIDATE_ID}/materialize-rule`;
    const missing = await request(server, 'POST', endpoint, {
      confirmation: false,
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(
      missing.body.error.code,
      'OWNER_RULE_MATERIALIZATION_CONFIRMATION_REQUIRED'
    );
    const injected = await request(server, 'POST', endpoint, {
      confirmation: true,
      candidate: { status: 'ACTIVE' },
    });
    assert.equal(injected.statusCode, 400);
    assert.equal(
      injected.body.error.code,
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT'
    );
  });
});

test('GET list and detail expose safe journal projections', async () => {
  const event = {
    candidateId: CANDIDATE_ID,
    ruleId: 'approved-rule-safe',
    ruleStatus: 'DISABLED',
    recordedAt: '2026-07-25T04:00:00.000Z',
    snapshot: {
      proposedRuleType: 'ITEM_DECISION_OVERRIDE',
      proposedDecision: 'SKIP',
    },
  };
  await withServer({
    listMaterializations() {
      return {
        summary: {
          totalEvents: 1,
          created: 1,
          repaired: 0,
          disabledRules: 1,
        },
        materializations: [event],
      };
    },
    getMaterializationByCandidate() {
      return event;
    },
  }, async server => {
    const list = await request(
      server,
      'GET',
      '/api/v1/owner-learning/rule-materializations'
    );
    assert.equal(list.statusCode, 200);
    assert.equal(list.body.data.summary.total, 1);
    const detail = await request(
      server,
      'GET',
      `/api/v1/owner-learning/rule-materializations/${CANDIDATE_ID}`
    );
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.body.data.rule.status, 'DISABLED');
  });
});

test('controlled service errors map to 409 and 503', async () => {
  for (const [code, statusCode] of [
    ['CANDIDATE_NOT_APPROVED', 409],
    ['CANDIDATE_NOT_ELIGIBLE', 409],
    ['CANDIDATE_NOT_AVAILABLE', 409],
    ['CANDIDATE_TYPE_NOT_MATERIALIZABLE', 409],
    ['RULE_REGISTRY_UNAVAILABLE', 503],
    ['RULE_MATERIALIZATION_STORAGE_UNAVAILABLE', 503],
  ]) {
    await withServer({
      materializeCandidateRule() {
        throw Object.assign(new Error('safe failure'), { code });
      },
    }, async server => {
      const response = await request(
        server,
        'POST',
        `/api/v1/owner-learning/candidates/${CANDIDATE_ID}/materialize-rule`,
        { confirmation: true }
      );
      assert.equal(response.statusCode, statusCode);
      assert.equal(response.body.error.code, code);
      assert.equal(
        JSON.stringify(response.body).includes('stack'),
        false
      );
    });
  }
});
