const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');
const { once } = require('node:events');

const {
  createPurchasingWebServer,
} = require('../server');

let server;
let port;

function request(requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

before(async () => {
  const rule = {
    ruleId: 'rule-1',
    displayScope: { primary: 'Товар', secondary: '100' },
    status: 'ACTIVE',
    decision: 'SKIP',
    confidence: { score: 90, level: 'VERY_HIGH' },
    priority: { score: 80, level: 'CRITICAL' },
    effectiveness: {
      population: {
        totalEvents: 1,
        evaluatedRuns: 1,
        unavailableRuns: 0,
        fallbackRuns: 0,
      },
      effects: {
        appliedEffectRuns: 1,
        matchedNoChangeRuns: 0,
        noMatchRuns: 0,
        effectRate: 1,
        matchRate: 1,
      },
      impact: { totalOrderAmountDelta: -100 },
      activity: {
        lastAppliedAt: '2026-01-01T00:00:00.000Z',
      },
      quality: { warnings: [] },
      classification: 'INSUFFICIENT_DATA',
      explanationCodes: [
        'EFFECTIVENESS_IS_OBSERVATIONAL_ONLY',
      ],
    },
    safety: {
      observationalOnly: true,
      changesRuleStatus: false,
    },
  };
  const service = {
    listRuleEffectiveness() {
      return {
        status: 'AVAILABLE',
        generatedAt: '2026-03-01T00:00:00.000Z',
        summary: {
          totalRules: 1,
          appliedRules: 1,
          noEffectRules: 0,
          staleRules: 0,
          reviewRecommendedRules: 0,
          totalOrderAmountDelta: -100,
        },
        rules: [rule],
        warning: null,
      };
    },
    getRuleEffectiveness({ ruleId }) {
      if (ruleId !== 'rule-1') {
        const error = new Error('Правило не найдено.');
        error.code = 'OWNER_RULE_EFFECTIVENESS_RULE_NOT_FOUND';
        throw error;
      }
      return {
        status: 'AVAILABLE',
        rule,
        effectiveness: rule.effectiveness,
      };
    },
    getRuleEffectivenessEvents() {
      return {
        status: 'AVAILABLE',
        generatedAt: '2026-03-01T00:00:00.000Z',
        events: [{
          recordedAt: '2026-01-01T00:00:00.000Z',
          runId: '12345678-1234-1234-8234-123456789012',
          evaluationStatus: 'EVALUATED',
          effectStatus: 'APPLIED_EFFECT',
          impact: {
            affectedRows: 1,
            quantityDelta: -1,
            orderAmountDelta: -100,
          },
          fallback: { occurred: false },
          eventId: 'private',
          registryFingerprint: 'private',
        }],
      };
    },
  };
  server = createPurchasingWebServer({
    ownerRuleEffectivenessService: service,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
});

after(async () => {
  if (!server) return;
  server.close();
  await once(server, 'close');
});

test('list, detail and events endpoints expose v1 safe DTOs', async () => {
  const list = await request(
    '/api/v1/owner-learning/rule-effectiveness'
  );
  const detail = await request(
    '/api/v1/owner-learning/rule-effectiveness/rule-1'
  );
  const events = await request(
    '/api/v1/owner-learning/rule-effectiveness/rule-1/events?limit=20'
  );
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.api_version, 'v1');
  assert.equal(list.body.data.summary.totalRules, 1);
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.data.rule.ruleId, 'rule-1');
  assert.equal(events.statusCode, 200);
  assert.equal(events.body.data.events[0].runId, '12345678…');
  assert.doesNotMatch(JSON.stringify(events.body), /fingerprint|eventId/i);
});

test('invalid query is 400 and missing rule is 404', async () => {
  const invalid = await request(
    '/api/v1/owner-learning/rule-effectiveness?limit=101'
  );
  const missing = await request(
    '/api/v1/owner-learning/rule-effectiveness/missing'
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(
    invalid.body.error.code,
    'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT'
  );
  assert.equal(missing.statusCode, 404);
  assert.equal(
    missing.body.error.code,
    'OWNER_RULE_EFFECTIVENESS_RULE_NOT_FOUND'
  );
});

test('effectiveness endpoints are read-only', async () => {
  const response = await request(
    '/api/v1/owner-learning/rule-effectiveness',
    'POST'
  );
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error.code, 'ROUTE_NOT_FOUND');
});
