const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
  loadApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_registry'
);
const {
  loadMaterializationJournal,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_materialization_journal'
);
const {
  buildApprovedRulePreview,
} = require(
  '../../../agents/purchasing/owner_learning/approved_rule_preview'
);
const {
  processApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/approved_rule_application'
);

function sha256(filePath) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
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

function agentResult() {
  return [{
    json: {
      decisions: [{
        rowIdentity: 'row-1',
        decision: 'recommended',
        approvedOrderQuantity: 5,
      }],
      workingOrderProducts: [{
        rowIdentity: 'row-1',
        article: '7177004',
        name: 'AWARD Hairball',
        priceNum: 10,
        workflowStatus: 'auto_approved',
        phase2Decision: 'recommended',
        approvedOrderQuantity: 5,
        approvedLineSum: 50,
        provisionalOrderQuantity: null,
      }],
      autoApprovedLines: 1,
      autoApprovedSum: 50,
      workingMaximumLines: 1,
      workingMaximumSum: 50,
      financial_assessment: {
        currency: 'RUB',
        status: 'APPROVED_WITH_WARNING',
        proposed_order_amount: 50,
        available_after_expenses: 200,
        available_after_order: 150,
        minimum_reserve: 100,
        reserve_surplus: 50,
        missing_fields: [],
        financially_permitted: true,
      },
    },
  }];
}

test('practical materialization creates one disabled rule without order effects', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'materialization-practical-')
  );
  const historyPath = path.join(directory, 'history.json');
  const lifecyclePath = path.join(directory, 'lifecycle.json');
  const materializationsPath = path.join(
    directory,
    'materializations.json'
  );
  const registryPath = path.join(directory, 'rules.json');
  const resultPath = path.join(directory, 'result.json');
  try {
    const entries = Array.from({ length: 4 }, (_, index) =>
      createDecisionHistoryEntry({
        recordedAt:
          `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        source: 'OWNER_REVIEW',
        runId: `run-${index + 1}`,
        supplier: 'Валта',
        stableItemKey: 'sku:7177004',
        sku: '7177004',
        productName: 'AWARD Hairball',
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
    atomicWriteDecisionHistory(historyPath, {
      schemaVersion: HISTORY_SCHEMA_VERSION,
      updatedAt: entries.at(-1).recordedAt,
      entries,
    });
    fs.writeFileSync(
      resultPath,
      JSON.stringify(agentResult(), null, 2),
      'utf8'
    );
    const historySha = sha256(historyPath);
    const resultSha = sha256(resultPath);
    let second = 0;
    const server = createPurchasingWebServer({
      registry: {},
      ownerDecisionService: {},
      queryService: {
        getRunStatus() {
          return { run_id: 'safe-run', status: 'COMPLETED' };
        },
        getOwnerReview() {
          return { sections: [], total: 0 };
        },
      },
      ownerDecisionAnalyticsService: { getAnalytics() {} },
      ownerDecisionHistoryFilePath: historyPath,
      ownerLearningCandidateLifecycleFilePath: lifecyclePath,
      ownerLearningRuleMaterializationsFilePath:
        materializationsPath,
      approvedRulesPath: registryPath,
      logger: { warn() {}, error() {} },
      now: () => new Date(
        `2026-07-25T04:00:${String(second++).padStart(2, '0')}.000Z`
      ),
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const candidates = await request(
        server,
        'GET',
        '/api/v1/owner-learning/candidates'
      );
      const candidate = candidates.body.data.candidates.find(value =>
        value.patternType === 'SAME_ITEM_SAME_DECISION' &&
        value.scopeType === 'ITEM' &&
        value.eligibility.status === 'ELIGIBLE'
      );
      assert.ok(candidate);
      assert.equal(
        candidate.materialization.status,
        'NOT_MATERIALIZED'
      );

      const approve = await request(
        server,
        'POST',
        `/api/v1/owner-learning/candidate-lifecycle/${
          candidate.candidateId
        }/status`,
        {
          targetStatus: 'APPROVED',
          action: 'APPROVE',
          reasonCode: 'READY_FOR_RULE',
        }
      );
      assert.equal(approve.statusCode, 200);
      const lifecycleShaAfterApproval = sha256(lifecyclePath);

      const endpoint =
        `/api/v1/owner-learning/candidates/${
          candidate.candidateId
        }/materialize-rule`;
      const missingConfirmation = await request(
        server,
        'POST',
        endpoint,
        { confirmation: false }
      );
      assert.equal(missingConfirmation.statusCode, 400);
      const created = await request(
        server,
        'POST',
        endpoint,
        { confirmation: true }
      );
      assert.equal(created.statusCode, 201);
      assert.equal(created.body.data.status, 'CREATED');
      assert.equal(created.body.data.rule.status, 'DISABLED');

      const duplicate = await request(
        server,
        'POST',
        endpoint,
        { confirmation: true }
      );
      assert.equal(duplicate.statusCode, 200);
      assert.equal(
        duplicate.body.data.status,
        'ALREADY_MATERIALIZED'
      );

      const registry = loadApprovedRules({
        registryPath,
        markdownPath: registryPath.replace('.json', '.md'),
        logger: { error() {} },
      });
      assert.equal(registry.rules.length, 1);
      assert.equal(registry.rules[0].status, 'DISABLED');
      assert.equal(
        registry.rules[0].provenance.candidateId,
        candidate.candidateId
      );
      assert.equal(
        registry.rules[0].ruleType,
        'ITEM_DECISION_OVERRIDE'
      );
      assert.equal(
        loadMaterializationJournal({
          filePath: materializationsPath,
        }).events.length,
        1
      );

      const baseline = agentResult();
      const preview = buildApprovedRulePreview({
        agentResult: baseline,
        approvedRules: registry,
        generatedAt: '2026-07-25T05:00:00.000Z',
      });
      assert.equal(preview.activeRulesCount, 0);
      assert.equal(preview.ignoredInactiveRulesCount, 1);
      const applied = processApprovedRules({
        agentResult: baseline,
        approvedRuleMode: 'APPLY_SAFE',
        approvedRules: registry,
        generatedAt: '2026-07-25T05:00:00.000Z',
      });
      assert.deepEqual(applied.agentResult, baseline);

      assert.equal(sha256(historyPath), historySha);
      assert.equal(sha256(lifecyclePath), lifecycleShaAfterApproval);
      assert.equal(sha256(resultPath), resultSha);

      fs.writeFileSync(materializationsPath, '{broken', 'utf8');
      const safeCandidates = await request(
        server,
        'GET',
        '/api/v1/owner-learning/candidates'
      );
      assert.equal(safeCandidates.statusCode, 200);
      assert.equal(safeCandidates.body.data.status, 'AVAILABLE');
      assert.equal(
        safeCandidates.body.data.materialization_warning,
        'RULE_MATERIALIZATION_STORAGE_UNAVAILABLE'
      );
      assert.equal(
        (await request(server, 'GET', '/api/v1/runs/safe-run'))
          .statusCode,
        200
      );
      assert.equal(
        (await request(
          server,
          'GET',
          '/api/v1/runs/safe-run/owner-review'
        )).statusCode,
        200
      );
    } finally {
      server.close();
      await once(server, 'close');
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
