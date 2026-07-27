const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { afterEach, test } = require('node:test');

const {
  createPurchasingWebServer,
} = require('../server');
const {
  OwnerLearningCandidateLifecycleService,
} = require(
  '../application/owner_learning_candidate_lifecycle_service'
);
const {
  OwnerLearningCandidatesService,
} = require('../application/owner_learning_candidates_service');
const {
  HISTORY_SCHEMA_VERSION,
  atomicWriteDecisionHistory,
  createDecisionHistoryEntry,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);
const {
  loadCandidateLifecycle,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_candidate_lifecycle'
);

const CANDIDATE_ID = 'a'.repeat(64);
const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), {
      recursive: true,
      force: true,
    });
  }
});

function temporaryLifecyclePath() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'candidate-lifecycle-http-')
  );
  temporaryDirectories.push(directory);
  return path.join(directory, 'lifecycle.json');
}

function sha256(filePath) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function candidateService(available = true) {
  return {
    getCandidates() {
      return {
        status: 'AVAILABLE',
        candidates: available ? [{
          candidateId: CANDIDATE_ID,
          patternType: 'REPEATED_ITEM_DECISION',
          scopeType: 'ITEM',
          displayScope: {
            primary: 'AWARD Hairball',
            secondary: 'SKU 7177004',
          },
          proposedRuleType: 'ITEM_DECISION',
          proposedAction: { decision: 'SKIP' },
          confidence: { score: 91, level: 'VERY_HIGH' },
          ranking: { priorityScore: 88, priorityLevel: 'HIGH' },
          eligibility: { status: 'ELIGIBLE' },
        }] : [],
      };
    },
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

async function withServer(operation, options = {}) {
  const filePath = options.filePath || temporaryLifecyclePath();
  const candidates = options.candidatesService ||
    candidateService(options.available !== false);
  const lifecycle = new OwnerLearningCandidateLifecycleService({
    lifecycleFilePath: filePath,
    candidatesService: candidates,
    logger: { warn() {} },
    now: options.now || (() => '2026-07-25T01:02:03.000Z'),
  });
  const server = createPurchasingWebServer({
    registry: {},
    ownerDecisionService: {},
    queryService: options.queryService || {
      getRunStatus() {
        return { run_id: 'safe-run', status: 'COMPLETED' };
      },
    },
    ownerDecisionAnalyticsService: { getAnalytics() {} },
    ownerLearningCandidatesService: candidates,
    ownerLearningCandidateLifecycleService: lifecycle,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await operation(server, filePath);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('GET lifecycle list starts empty', async () => {
  await withServer(async server => {
    const response = await request(
      server,
      'GET',
      '/api/v1/owner-learning/candidate-lifecycle'
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.api_version, 'v1');
    assert.equal(response.body.data.summary.totalEvents, 0);
    assert.deepEqual(response.body.data.states, []);
  });
});

test('POST changes status and GET detail returns the safe comment', async () => {
  await withServer(async server => {
    const changed = await request(
      server,
      'POST',
      `/api/v1/owner-learning/candidate-lifecycle/${CANDIDATE_ID}/status`,
      {
        targetStatus: 'APPROVED',
        action: 'APPROVE',
        reasonCode: 'READY_FOR_RULE',
        ownerComment: '<b>Проверено владельцем</b>',
      }
    );
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.body.data.status, 'APPROVED');
    assert.equal(changed.body.data.last_event.action, 'APPROVE');
    assert.equal(
      Object.hasOwn(changed.body.data.last_event, 'owner_comment'),
      false
    );

    const detail = await request(
      server,
      'GET',
      `/api/v1/owner-learning/candidate-lifecycle/${CANDIDATE_ID}`
    );
    assert.equal(detail.statusCode, 200);
    assert.equal(
      detail.body.data.last_event.owner_comment,
      '<b>Проверено владельцем</b>'
    );
    assert.equal(JSON.stringify(detail.body).includes('metadata'), false);
    assert.equal(
      JSON.stringify(detail.body).includes('candidateSnapshot'),
      false
    );
  });
});

test('repeated POST is successful and does not append a duplicate', async () => {
  await withServer(async (server, filePath) => {
    const endpoint =
      `/api/v1/owner-learning/candidate-lifecycle/${CANDIDATE_ID}/status`;
    const body = {
      targetStatus: 'APPROVED',
      action: 'APPROVE',
      reasonCode: 'READY_FOR_RULE',
    };
    assert.equal(
      (await request(server, 'POST', endpoint, body)).body.data.duplicate,
      false
    );
    assert.equal(
      (await request(server, 'POST', endpoint, body)).body.data.duplicate,
      true
    );
    assert.equal(
      loadCandidateLifecycle({ filePath }).events.length,
      1
    );
  });
});

test('invalid transition returns 409 without a stack trace', async () => {
  await withServer(async server => {
    const endpoint =
      `/api/v1/owner-learning/candidate-lifecycle/${CANDIDATE_ID}/status`;
    await request(server, 'POST', endpoint, {
      targetStatus: 'APPROVED',
      action: 'APPROVE',
      reasonCode: 'READY_FOR_RULE',
    });
    const response = await request(server, 'POST', endpoint, {
      targetStatus: 'POSTPONED',
      action: 'POSTPONE',
      reasonCode: 'NEEDS_MORE_HISTORY',
    });
    assert.equal(response.statusCode, 409);
    assert.equal(
      response.body.error.code,
      'OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID'
    );
    assert.equal(JSON.stringify(response.body).includes('stack'), false);
  });
});

test('missing candidate returns 409 and creates no event', async () => {
  await withServer(async (server, filePath) => {
    const response = await request(
      server,
      'POST',
      `/api/v1/owner-learning/candidate-lifecycle/${CANDIDATE_ID}/status`,
      {
        targetStatus: 'APPROVED',
        action: 'APPROVE',
        reasonCode: 'READY_FOR_RULE',
      }
    );
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.error.code, 'CANDIDATE_NOT_AVAILABLE');
    assert.equal(
      loadCandidateLifecycle({ filePath }).events.length,
      0
    );
  }, { available: false });
});

test('body allowlist blocks frontend snapshots and invalid reasons', async () => {
  await withServer(async server => {
    const endpoint =
      `/api/v1/owner-learning/candidate-lifecycle/${CANDIDATE_ID}/status`;
    for (const body of [{
      targetStatus: 'APPROVED',
      action: 'APPROVE',
      reasonCode: 'READY_FOR_RULE',
      candidateSnapshot: { confidenceScore: 100 },
    }, {
      targetStatus: 'REJECTED',
      action: 'REJECT',
      reasonCode: 'NOT_SPECIFIED',
    }]) {
      const response = await request(server, 'POST', endpoint, body);
      assert.equal(response.statusCode, 400);
      assert.equal(
        response.body.error.code,
        'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT'
      );
    }
  });
});

test('corrupted lifecycle returns 503 while run status remains available', async () => {
  const filePath = temporaryLifecyclePath();
  fs.writeFileSync(filePath, '{broken', 'utf8');
  await withServer(async server => {
    const lifecycle = await request(
      server,
      'GET',
      '/api/v1/owner-learning/candidate-lifecycle'
    );
    assert.equal(lifecycle.statusCode, 503);
    assert.equal(
      lifecycle.body.error.code,
      'OWNER_LEARNING_LIFECYCLE_UNAVAILABLE'
    );
    const run = await request(
      server,
      'GET',
      '/api/v1/runs/safe-run'
    );
    assert.equal(run.statusCode, 200);
    assert.equal(run.body.data.status, 'COMPLETED');
  }, { filePath });
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{broken');
});

test('practical lifecycle run stays isolated from history, registry and result', async () => {
  const lifecycleFilePath = temporaryLifecyclePath();
  const directory = path.dirname(lifecycleFilePath);
  const historyFilePath = path.join(directory, 'history.json');
  const approvedRulesPath = path.join(directory, 'approved-rules.json');
  const resultPath = path.join(directory, 'result.json');
  const entries = Array.from({ length: 4 }, (_, index) =>
    createDecisionHistoryEntry({
      recordedAt:
        `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      source: 'OWNER_REVIEW',
      runId: `practical-run-${index + 1}`,
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
  atomicWriteDecisionHistory(historyFilePath, {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: entries.at(-1).recordedAt,
    entries,
  });
  fs.writeFileSync(
    approvedRulesPath,
    '{"schemaVersion":"sentinel","rules":[]}\n',
    'utf8'
  );
  fs.writeFileSync(
    resultPath,
    '{"run_id":"safe-run","status":"COMPLETED"}\n',
    'utf8'
  );
  const before = {
    history: sha256(historyFilePath),
    registry: sha256(approvedRulesPath),
    result: sha256(resultPath),
  };
  const candidates = new OwnerLearningCandidatesService({
    historyFilePath,
    lifecycleFilePath,
    logger: { warn() {} },
    now: () => '2026-07-25T00:00:00.000Z',
  });
  const initial = candidates.getCandidates();
  assert.ok(initial.candidates.length >= 3);
  const ids = initial.candidates.slice(0, 3).map(value =>
    value.candidateId
  );
  let second = 0;

  await withServer(async server => {
    const change = (candidateId, body) => request(
      server,
      'POST',
      `/api/v1/owner-learning/candidate-lifecycle/${candidateId}/status`,
      body
    );
    await change(ids[0], {
      targetStatus: 'UNDER_REVIEW',
      action: 'START_REVIEW',
      reasonCode: 'NOT_SPECIFIED',
    });
    const approval = {
      targetStatus: 'APPROVED',
      action: 'APPROVE',
      reasonCode: 'READY_FOR_RULE',
    };
    await change(ids[0], approval);
    const duplicate = await change(ids[0], approval);
    assert.equal(duplicate.body.data.duplicate, true);

    await change(ids[1], {
      targetStatus: 'POSTPONED',
      action: 'POSTPONE',
      reasonCode: 'NEEDS_MORE_HISTORY',
    });
    await change(ids[1], {
      targetStatus: 'UNDER_REVIEW',
      action: 'REOPEN',
      reasonCode: 'NOT_SPECIFIED',
    });
    await change(ids[1], {
      targetStatus: 'REJECTED',
      action: 'REJECT',
      reasonCode: 'NOT_RELEVANT',
    });

    await change(ids[2], {
      targetStatus: 'REJECTED',
      action: 'REJECT',
      reasonCode: 'TOO_BROAD',
    });
    await change(ids[2], {
      targetStatus: 'UNDER_REVIEW',
      action: 'REOPEN',
      reasonCode: 'NOT_SPECIFIED',
    });

    const lifecycle = await request(
      server,
      'GET',
      '/api/v1/owner-learning/candidate-lifecycle'
    );
    assert.equal(lifecycle.body.data.summary.totalEvents, 7);
    assert.equal(
      lifecycle.body.data.summary.currentStates.APPROVED,
      1
    );
    assert.equal(
      lifecycle.body.data.summary.currentStates.REJECTED,
      1
    );
    assert.equal(
      lifecycle.body.data.summary.currentStates.UNDER_REVIEW,
      1
    );

    const overlay = await request(
      server,
      'GET',
      '/api/v1/owner-learning/candidates'
    );
    const statusById = Object.fromEntries(
      overlay.body.data.candidates.map(value => [
        value.candidateId,
        value.lifecycle.status,
      ])
    );
    assert.equal(statusById[ids[0]], 'APPROVED');
    assert.equal(statusById[ids[1]], 'REJECTED');
    assert.equal(statusById[ids[2]], 'UNDER_REVIEW');

    fs.writeFileSync(lifecycleFilePath, '{broken', 'utf8');
    const unavailable = await request(
      server,
      'GET',
      '/api/v1/owner-learning/candidate-lifecycle'
    );
    assert.equal(unavailable.statusCode, 503);
    const safeCandidates = await request(
      server,
      'GET',
      '/api/v1/owner-learning/candidates'
    );
    assert.equal(safeCandidates.statusCode, 200);
    assert.equal(safeCandidates.body.data.status, 'AVAILABLE');
    assert.equal(
      safeCandidates.body.data.lifecycle_warning,
      'OWNER_LEARNING_LIFECYCLE_UNAVAILABLE'
    );
    const runStatus = await request(
      server,
      'GET',
      '/api/v1/runs/safe-run'
    );
    assert.equal(runStatus.statusCode, 200);
  }, {
    filePath: lifecycleFilePath,
    candidatesService: candidates,
    now: () =>
      `2026-07-25T02:00:${String(second++).padStart(2, '0')}.000Z`,
  });

  assert.deepEqual({
    history: sha256(historyFilePath),
    registry: sha256(approvedRulesPath),
    result: sha256(resultPath),
  }, before);
});
