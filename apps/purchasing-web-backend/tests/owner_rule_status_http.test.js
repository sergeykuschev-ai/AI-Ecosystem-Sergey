const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');

const {
  createPurchasingWebServer,
} = require('../server');

const RULE_ID = 'approved-rule-safe';
const RUN_ID = '11111111-1111-4111-8111-111111111111';

function baseOptions(ownerRuleStatusService) {
  return {
    registry: {},
    ownerDecisionService: {},
    queryService: {},
    ownerDecisionAnalyticsService: { getAnalytics() {} },
    ownerLearningCandidatesService: {
      getCandidates() {
        return { status: 'AVAILABLE', candidates: [] };
      },
    },
    ownerLearningCandidateLifecycleService: {},
    ownerRuleMaterializationService: {},
    ownerMaterializedRulesService: {},
    ownerRuleStatusService,
  };
}

async function request(server, method, requestPath, body = null) {
  return new Promise((resolve, reject) => {
    const source = body === null ? null : JSON.stringify(body);
    const outgoing = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
      method,
      headers: source === null ? {} : {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(source),
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

async function withServer(service, operation) {
  const server = createPurchasingWebServer(baseOptions(service));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await operation(server);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function previewResult() {
  return {
    status: 'AVAILABLE',
    previewId: 'a'.repeat(64),
    previewedAt: '2026-07-26T04:01:00.000Z',
    expiresAt: '2026-07-26T04:16:00.000Z',
    rule: {
      ruleId: RULE_ID,
      currentStatus: 'DISABLED',
      targetStatus: 'ACTIVE',
      decision: 'SKIP',
      displayScope: {
        primary: '<img src=x onerror=alert(1)>',
        secondary: 'SKU-1',
      },
    },
    impact: {
      affectedItems: 1,
      affectedRows: 1,
      decisionChanges: 1,
      quantityChanges: 1,
      orderAmountBefore: 50,
      orderAmountAfter: 0,
      orderAmountDelta: -50,
      unitsBefore: 5,
      unitsAfter: 0,
      unitsDelta: -5,
      financialStatusBefore: 'APPROVED',
      financialStatusAfter: 'APPROVED',
      financiallyPermitted: true,
    },
    changedItems: [{
      productName: '<script>alert(1)</script>',
      sku: 'SKU-1',
      decisionBefore: 'BUY',
      decisionAfter: 'SKIP',
      quantityBefore: 5,
      quantityAfter: 0,
      stableItemKey: 'private',
    }],
    warnings: [],
    registryFingerprint: 'private',
  };
}

test('POST status-preview maps safe v1 response', async () => {
  let input;
  await withServer({
    previewStatusChange(value) {
      input = value;
      return previewResult();
    },
  }, async server => {
    const response = await request(
      server,
      'POST',
      `/api/v1/owner-learning/materialized-rules/${RULE_ID}/status-preview`,
      { targetStatus: 'ACTIVE', runId: RUN_ID }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.api_version, 'v1');
    assert.equal(response.body.data.status, 'AVAILABLE');
    assert.equal(
      response.body.data.preview.impact.order_amount_delta,
      -50
    );
    assert.equal(
      response.body.data.preview.changed_items[0].product_name,
      '<script>alert(1)</script>'
    );
    const json = JSON.stringify(response.body);
    for (const forbidden of [
      'stableItemKey',
      'registryFingerprint',
      'runFingerprint',
      'scopeKey',
      'stack',
    ]) {
      assert.equal(json.includes(forbidden), false, forbidden);
    }
  });
  assert.deepEqual(input, {
    ruleId: RULE_ID,
    targetStatus: 'ACTIVE',
    runId: RUN_ID,
  });
});

test('POST status accepts only confirmation payload', async () => {
  let input;
  await withServer({
    changeStatus(value) {
      input = value;
      return {
        status: 'CHANGED',
        rule: {
          ruleId: RULE_ID,
          previousStatus: 'DISABLED',
          currentStatus: 'ACTIVE',
          updatedAt: '2026-07-26T04:02:00.000Z',
        },
        repair: { repaired: false },
      };
    },
  }, async server => {
    const response = await request(
      server,
      'POST',
      `/api/v1/owner-learning/materialized-rules/${RULE_ID}/status`,
      {
        targetStatus: 'ACTIVE',
        previewId: 'a'.repeat(64),
        confirmation: true,
        reasonCode: 'READY_TO_APPLY',
        ownerComment: 'Проверено',
      }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.status, 'CHANGED');
    assert.equal(response.body.data.rule.current_status, 'ACTIVE');
    assert.match(response.body.data.message, /будет учитываться/);
  });
  assert.deepEqual(input, {
    ruleId: RULE_ID,
    targetStatus: 'ACTIVE',
    previewId: 'a'.repeat(64),
    confirmation: true,
    reasonCode: 'READY_TO_APPLY',
    ownerComment: 'Проверено',
  });
});

test('GET status-history returns safe event fields', async () => {
  await withServer({
    getRuleStatusHistory() {
      return {
        ruleId: RULE_ID,
        events: [{
          eventId: 'event-1',
          recordedAt: '2026-07-26T04:02:00.000Z',
          fromStatus: 'DISABLED',
          toStatus: 'ACTIVE',
          action: 'ACTIVATE',
          actor: 'OWNER',
          reasonCode: 'READY_TO_APPLY',
          ownerComment: 'Проверено',
          previewId: 'preview-1',
          previewSnapshot: { stableItemKey: 'private' },
          ruleSnapshot: { stableItemKeyHash: 'private' },
        }],
      };
    },
  }, async server => {
    const response = await request(
      server,
      'GET',
      `/api/v1/owner-learning/materialized-rules/${RULE_ID}/status-history`
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.events.length, 1);
    assert.equal(response.body.data.events[0].action, 'ACTIVATE');
    assert.equal(
      JSON.stringify(response.body).includes('stableItemKey'),
      false
    );
  });
});

test('unsupported fields and missing confirmation are controlled', async () => {
  await withServer({
    changeStatus() {
      const error = new Error('confirmation required');
      error.code = 'OWNER_RULE_STATUS_CONFIRMATION_REQUIRED';
      throw error;
    },
  }, async server => {
    const unsupported = await request(
      server,
      'POST',
      `/api/v1/owner-learning/materialized-rules/${RULE_ID}/status`,
      {
        targetStatus: 'ACTIVE',
        previewId: 'preview',
        confirmation: true,
        rule: { status: 'DISABLED' },
      }
    );
    assert.equal(unsupported.statusCode, 400);
    assert.equal(
      unsupported.body.error.code,
      'OWNER_RULE_STATUS_INVALID_INPUT'
    );
    const confirmation = await request(
      server,
      'POST',
      `/api/v1/owner-learning/materialized-rules/${RULE_ID}/status`,
      {
        targetStatus: 'ACTIVE',
        previewId: 'preview',
        confirmation: false,
      }
    );
    assert.equal(confirmation.statusCode, 400);
    assert.equal(
      confirmation.body.error.code,
      'OWNER_RULE_STATUS_CONFIRMATION_REQUIRED'
    );
  });
});

for (const [code, expectedStatus] of [
  ['OWNER_MATERIALIZED_RULE_NOT_FOUND', 404],
  ['PREVIEW_EXPIRED', 409],
  ['PREVIEW_STALE', 409],
  ['PREVIEW_TARGET_MISMATCH', 409],
  ['OWNER_RULE_STATUS_TRANSITION_INVALID', 409],
  ['RULE_ACTIVATION_NOT_FINANCIALLY_PERMITTED', 422],
  ['RULE_REGISTRY_UNAVAILABLE', 503],
  ['RULE_STATUS_STORAGE_UNAVAILABLE', 503],
  ['RULE_ACTIVATION_PREVIEW_UNAVAILABLE', 503],
]) {
  test(`${code} maps to ${expectedStatus}`, async () => {
    await withServer({
      previewStatusChange() {
        const error = new Error('safe message');
        error.code = code;
        throw error;
      },
    }, async server => {
      const response = await request(
        server,
        'POST',
        `/api/v1/owner-learning/materialized-rules/${RULE_ID}/status-preview`,
        { targetStatus: 'ACTIVE', runId: RUN_ID }
      );
      assert.equal(response.statusCode, expectedStatus);
      assert.equal(response.body.error.code, code);
      assert.equal(JSON.stringify(response.body).includes('stack'), false);
    });
  });
}
