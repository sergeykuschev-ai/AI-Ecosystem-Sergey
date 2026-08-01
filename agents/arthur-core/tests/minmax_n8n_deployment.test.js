'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');

const {
  DEFAULT_WORKFLOW_ID,
  NODE_PUBLIC_API_WRITABLE_FIELDS,
  N8nApiClient,
  canonicalizeWorkflowForComparison,
  deployWorkflow,
  deploymentConfig,
  inspectHttpNodes,
  readRepositoryWorkflow,
  sanitizeNodesForPublicApi,
  semanticWorkflowDiff,
  verificationIssues,
  verifyDeployedWorkflow,
  workflowPayload,
} = require('../../../scripts/arthur/minmax-n8n-workflow-deployment');

const API_KEY = 'n8n-deployment-test-key';
const CREDENTIALS = Object.freeze({
  httpHeaderAuth: 'arthur-http-header-id',
  imap: 'minmax-imap-id',
  smtp: 'minmax-smtp-id',
});
const NODE_PUBLIC_API_FIELDS = new Set(NODE_PUBLIC_API_WRITABLE_FIELDS);

function invalidNodeFields(nodes) {
  return (nodes || []).flatMap((node, index) =>
    Object.keys(node)
      .filter(field => !NODE_PUBLIC_API_FIELDS.has(field))
      .map(field => ({ index, field }))
  );
}

function activeVersion(record, versionId = record.versionId) {
  return {
    versionId,
    workflowId: record.id,
    nodes: structuredClone(record.nodes),
    connections: structuredClone(record.connections),
    ...(record.nodeGroups === undefined
      ? {}
      : { nodeGroups: structuredClone(record.nodeGroups) }),
  };
}

function normalizeLikeN8n(payload) {
  const normalized = structuredClone(payload);
  normalized.settings = {
    ...normalized.settings,
    callerPolicy: 'workflowsFromSameOwner',
    availableInMCP: false,
    saveExecutionProgress: false,
  };
  normalized.nodes = normalized.nodes.map(node => ({
    updatedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    continueOnFail: false,
    alwaysOutputData: false,
    executeOnce: false,
    notesInFlow: false,
    disabled: false,
    ...node,
    parameters: {
      ...node.parameters,
      options: node.parameters?.options || {},
    },
  }));
  return normalized;
}

function workflowRecord(id, payload, options = {}) {
  const record = {
    ...structuredClone(payload),
    id,
    active: options.active ?? false,
    activeVersionId: options.activeVersionId || null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: options.updatedAt || '2026-08-01T00:00:00.000Z',
    isArchived: options.isArchived ?? false,
    versionId: options.versionId || 'draft-old',
  };
  if (record.active) {
    record.activeVersion = options.activeVersion || activeVersion(
      record,
      options.activeVersionId || record.versionId
    );
    record.activeVersionId = record.activeVersion.versionId;
  } else {
    record.activeVersion = null;
  }
  return record;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length > 0
    ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
    : null;
}

function startN8nApi(initialRecords) {
  const records = new Map(initialRecords.map(record => [record.id, record]));
  const calls = [];
  let version = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const body = await readJson(request);
    calls.push({ method: request.method, path: url.pathname, body });
    if (request.headers['x-n8n-api-key'] !== API_KEY) {
      response.writeHead(401, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ message: 'unauthorized' }));
    }
    const send = (status, data) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(data));
    };

    if (request.method === 'GET' && url.pathname === '/api/v1/workflows') {
      return send(200, { data: [...records.values()], nextCursor: null });
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/workflows') {
      const invalid = invalidNodeFields(body?.nodes);
      if (invalid.length > 0) {
        return send(400, {
          message: `request/body/nodes/${invalid[0].index} ` +
            'must NOT have additional properties',
        });
      }
      version += 1;
      const created = workflowRecord(
        `created-workflow-${version}`,
        normalizeLikeN8n(body),
        { versionId: `draft-new-${version}` }
      );
      records.set(created.id, created);
      return send(201, created);
    }
    const match = url.pathname.match(
      /^\/api\/v1\/workflows\/([^/]+)(?:\/(activate|deactivate|archive|unarchive))?$/
    );
    if (!match) return send(404, { message: 'not found' });
    const id = decodeURIComponent(match[1]);
    const operation = match[2];
    const record = records.get(id);
    if (!record) return send(404, { message: 'not found' });

    if (request.method === 'GET' && !operation) return send(200, record);
    if (request.method === 'PUT' && !operation) {
      const invalid = invalidNodeFields(body?.nodes);
      if (invalid.length > 0) {
        return send(400, {
          message: `request/body/nodes/${invalid[0].index} ` +
            'must NOT have additional properties',
        });
      }
      version += 1;
      Object.assign(record, normalizeLikeN8n(body), {
        versionId: `draft-new-${version}`,
        updatedAt: `2026-08-01T00:00:0${version}.000Z`,
      });
      // n8n 2.28.6 uses publishIfActive=true for Public API PUT.
      if (record.active) {
        record.activeVersion = activeVersion(record);
        record.activeVersionId = record.versionId;
      }
      return send(200, record);
    }
    if (request.method === 'POST' && operation === 'activate') {
      if (body?.versionId !== record.versionId) {
        return send(400, { message: 'version mismatch' });
      }
      record.active = true;
      record.activeVersionId = body.versionId;
      record.activeVersion = activeVersion(record, body.versionId);
      return send(200, record);
    }
    if (request.method === 'POST' && operation === 'deactivate') {
      record.active = false;
      record.activeVersionId = null;
      record.activeVersion = null;
      return send(200, record);
    }
    if (request.method === 'POST' && operation === 'archive') {
      record.active = false;
      record.activeVersionId = null;
      record.activeVersion = null;
      record.isArchived = true;
      return send(200, record);
    }
    if (request.method === 'POST' && operation === 'unarchive') {
      record.isArchived = false;
      return send(200, record);
    }
    return send(404, { message: 'not found' });
  });
  server.listen(0, '127.0.0.1');
  return once(server, 'listening').then(() => ({
    calls,
    client: new N8nApiClient({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      apiKey: API_KEY,
    }),
    records,
    server,
  }));
}

function oldPayload(payload) {
  const old = structuredClone(payload);
  const check = old.nodes.find(node => node.id === 'check-registry');
  check.parameters.headerParameters.parameters = [];
  check.parameters.options.response.response.responseFormat = 'text';
  return old;
}

test('deploy updates stable record, publishes saved version and archives duplicate', async t => {
  const repositoryWorkflow = readRepositoryWorkflow();
  const expected = workflowPayload(repositoryWorkflow, CREDENTIALS);
  const target = workflowRecord(DEFAULT_WORKFLOW_ID, oldPayload(expected), {
    active: true,
    versionId: 'draft-old-target',
  });
  const duplicate = workflowRecord('old-duplicate-workflow', oldPayload(expected), {
    active: true,
    versionId: 'draft-old-duplicate',
  });
  const runtime = await startN8nApi([target, duplicate]);
  t.after(async () => {
    runtime.server.close();
    await once(runtime.server, 'close').catch(() => {});
  });

  const result = await deployWorkflow({
    client: runtime.client,
    credentials: CREDENTIALS,
    repositoryWorkflow,
    workflowId: DEFAULT_WORKFLOW_ID,
  });

  assert.equal(result.action, 'updated');
  assert.equal(result.workflowId, DEFAULT_WORKFLOW_ID);
  assert.deepEqual(result.archivedDuplicateIds, ['old-duplicate-workflow']);
  assert.equal(result.verification.record.active, true);
  assert.equal(
    result.verification.record.versionId,
    result.verification.record.activeVersionId
  );
  assert.equal(result.verification.httpNodes.length, 8);
  assert.equal(result.verification.publishedHttpNodes.length, 8);
  assert.equal(
    result.verification.hashes.repoDraft,
    result.verification.hashes.deployedDraft
  );
  assert.equal(
    result.verification.hashes.repoPublished,
    result.verification.hashes.deployedPublished
  );
  assert.notEqual(
    result.verification.rawHashes.repoDraft,
    result.verification.rawHashes.deployedDraft
  );
  assert.ok(result.verification.normalizations.draft.length > 0);
  assert.equal(runtime.records.get('old-duplicate-workflow').isArchived, true);
  assert.ok(runtime.calls.some(call =>
    call.method === 'PUT' &&
    call.path === `/api/v1/workflows/${DEFAULT_WORKFLOW_ID}`
  ));
  const update = runtime.calls.find(call =>
    call.method === 'PUT' &&
    call.path === `/api/v1/workflows/${DEFAULT_WORKFLOW_ID}`
  );
  assert.deepEqual(invalidNodeFields(update.body.nodes), []);
  assert.equal(update.body.nodes[8].maxTries, 3);
  assert.equal(update.body.nodes[8].waitBetweenTries, 30000);
  assert.equal(update.body.nodes[8].maxRetries, undefined);
  assert.equal(update.body.nodes[8].waitBetweenRetries, undefined);
  const publish = runtime.calls.find(call =>
    call.method === 'POST' &&
    call.path === `/api/v1/workflows/${DEFAULT_WORKFLOW_ID}/activate`
  );
  assert.equal(publish.body.versionId, result.publishedVersionId);
  assert.ok(runtime.calls.some(call =>
    call.path === '/api/v1/workflows/old-duplicate-workflow/deactivate'
  ));
  assert.ok(runtime.calls.some(call =>
    call.path === '/api/v1/workflows/old-duplicate-workflow/archive'
  ));
  const deployedCheck = result.verification.httpNodes.find(
    node => node.id === 'check-registry'
  );
  assert.equal(deployedCheck.accept, 'application/json');
  assert.equal(deployedCheck.responseFormat, 'json');
  assert.equal(deployedCheck.credentialId, CREDENTIALS.httpHeaderAuth);
  const publishedCheck = result.verification.publishedHttpNodes.find(
    node => node.id === 'check-registry'
  );
  assert.deepEqual(publishedCheck, deployedCheck);
});

test('verify rejects updated draft with stale published version', async t => {
  const repositoryWorkflow = readRepositoryWorkflow();
  const expected = workflowPayload(repositoryWorkflow, CREDENTIALS);
  const old = oldPayload(expected);
  const record = workflowRecord(DEFAULT_WORKFLOW_ID, expected, {
    active: true,
    versionId: 'draft-current',
    activeVersionId: 'published-old',
    activeVersion: {
      versionId: 'published-old',
      workflowId: DEFAULT_WORKFLOW_ID,
      nodes: old.nodes,
      connections: old.connections,
    },
  });
  const runtime = await startN8nApi([record]);
  t.after(async () => {
    runtime.server.close();
    await once(runtime.server, 'close').catch(() => {});
  });

  await assert.rejects(
    () => verifyDeployedWorkflow({
      client: runtime.client,
      credentials: CREDENTIALS,
      repositoryWorkflow,
      workflowId: DEFAULT_WORKFLOW_ID,
    }),
    error =>
      error.message.includes('published version published-old differs') &&
      error.message.includes('published: Проверить реестр') &&
      error.message.includes('parameters.headerParameters')
  );
});

test('deploy creates exactly one workflow when stable id and name are absent', async t => {
  const repositoryWorkflow = readRepositoryWorkflow();
  const runtime = await startN8nApi([]);
  t.after(async () => {
    runtime.server.close();
    await once(runtime.server, 'close').catch(() => {});
  });

  const result = await deployWorkflow({
    client: runtime.client,
    credentials: CREDENTIALS,
    repositoryWorkflow,
    workflowId: DEFAULT_WORKFLOW_ID,
  });

  assert.equal(result.action, 'created');
  assert.equal(runtime.records.size, 1);
  assert.equal(result.verification.record.active, true);
  assert.equal(result.verification.httpNodes.length, 8);
  assert.equal(result.verification.publishedHttpNodes.length, 8);
  assert.equal(
    runtime.calls.filter(call =>
      call.method === 'POST' && call.path === '/api/v1/workflows'
    ).length,
    1
  );
});

test('HTTP contract requires all eight nodes, JSON response and bound auth', () => {
  const repositoryWorkflow = readRepositoryWorkflow();
  const expected = workflowPayload(repositoryWorkflow, CREDENTIALS);
  const valid = inspectHttpNodes(expected, CREDENTIALS.httpHeaderAuth);
  assert.deepEqual(valid.issues, []);
  assert.equal(valid.summaries.length, 8);

  const invalid = oldPayload(expected);
  invalid.nodes.find(node => node.id === 'check-registry').parameters.url =
    'http://stale.example/api/v1/upload-idempotency/old';
  const inspected = inspectHttpNodes(
    invalid,
    CREDENTIALS.httpHeaderAuth,
    expected
  );
  assert.ok(inspected.issues.includes(
    'Проверить реестр: Accept must be application/json'
  ));
  assert.ok(inspected.issues.includes(
    'Проверить реестр: Response Format must be json'
  ));
  assert.ok(inspected.issues.includes(
    'Проверить реестр: URL differs from repository'
  ));
});

test('Public API sanitizer allowlists every node and normalizes nodes[8]', () => {
  const repositoryWorkflow = readRepositoryWorkflow();
  const original = repositoryWorkflow.nodes[8];
  assert.equal(original.name, 'Загрузить Excel в Purchasing API');
  assert.equal(original.type, 'n8n-nodes-base.httpRequest');
  assert.deepEqual(Object.keys(original), [
    'parameters',
    'id',
    'name',
    'type',
    'typeVersion',
    'position',
    'retryOnFail',
    'maxRetries',
    'waitBetweenRetries',
    'credentials',
  ]);

  const bound = workflowPayload(repositoryWorkflow, CREDENTIALS);
  assert.deepEqual(invalidNodeFields(bound.nodes), []);
  for (const node of bound.nodes) {
    assert.ok(Object.keys(node).every(field =>
      NODE_PUBLIC_API_FIELDS.has(field)
    ));
  }

  const sanitized = sanitizeNodesForPublicApi(repositoryWorkflow.nodes)[8];
  assert.equal(sanitized.maxRetries, undefined);
  assert.equal(sanitized.waitBetweenRetries, undefined);
  assert.equal(sanitized.maxTries, 3);
  assert.equal(sanitized.waitBetweenTries, 30000);
  assert.deepEqual(sanitized.parameters, original.parameters);
  assert.deepEqual(sanitized.credentials, original.credentials);
  assert.equal(sanitized.typeVersion, original.typeVersion);
  assert.deepEqual(sanitized.position, original.position);
});

test('semantic comparison accepts n8n defaults and read-only node fields', () => {
  const expected = workflowPayload(readRepositoryWorkflow(), CREDENTIALS);
  const actual = normalizeLikeN8n(expected);
  assert.deepEqual(semanticWorkflowDiff(expected, actual).differences, []);
});

test('semantic comparison accepts generated webhookId absent from repository', () => {
  const expected = workflowPayload(readRepositoryWorkflow(), CREDENTIALS);
  const actual = structuredClone(expected);
  actual.nodes.find(node => node.id === 'send-error-letter').webhookId =
    'a2a65ebb-8863-4223-9e91-3924337eaaa6';
  actual.nodes.find(node => node.id === 'send-owner-notification').webhookId =
    '8b58995c-3d47-43eb-abb3-e420f472358f';
  assert.deepEqual(semanticWorkflowDiff(expected, actual).differences, []);
});

test('generated webhookId does not hide a neighboring parameter change', () => {
  const expected = workflowPayload(readRepositoryWorkflow(), CREDENTIALS);
  const actual = structuredClone(expected);
  const email = actual.nodes.find(node => node.id === 'send-error-letter');
  email.webhookId = 'a2a65ebb-8863-4223-9e91-3924337eaaa6';
  email.parameters.subject = 'changed subject';
  const differences = semanticWorkflowDiff(expected, actual).differences;
  assert.ok(differences.some(difference =>
    difference.scope === 'Отправить письмо об ошибке' &&
    difference.path === 'parameters.subject'
  ));
});

test('different generated webhookIds in draft and published remain neutral', () => {
  const expected = workflowPayload(readRepositoryWorkflow(), CREDENTIALS);
  const record = workflowRecord(DEFAULT_WORKFLOW_ID, expected, {
    active: true,
    versionId: 'current-version',
  });
  record.nodes.find(node => node.id === 'send-error-letter').webhookId =
    'draft-generated-id';
  record.activeVersion.nodes.find(
    node => node.id === 'send-error-letter'
  ).webhookId = 'published-generated-id';
  const result = verificationIssues(
    record,
    expected,
    [],
    CREDENTIALS,
    DEFAULT_WORKFLOW_ID
  );
  assert.deepEqual(result.issues, []);
});

test('explicit repository webhookId remains semantically strict', () => {
  const expected = workflowPayload(readRepositoryWorkflow(), CREDENTIALS);
  const actual = structuredClone(expected);
  actual.nodes.find(node => node.id === 'wait-poll-interval').webhookId =
    'different-explicit-id';
  const differences = semanticWorkflowDiff(expected, actual).differences;
  assert.ok(differences.some(difference =>
    difference.scope === 'Подождать' && difference.path === 'webhookId'
  ));
});

test('semantic comparison accepts object key and node array order changes', () => {
  const expected = workflowPayload(readRepositoryWorkflow(), CREDENTIALS);
  const reordered = {
    settings: Object.fromEntries(Object.entries(expected.settings).reverse()),
    connections: Object.fromEntries(
      Object.entries(expected.connections).reverse()
    ),
    nodes: [...expected.nodes].reverse().map(node =>
      Object.fromEntries(Object.entries(node).reverse())
    ),
    name: expected.name,
  };
  assert.deepEqual(semanticWorkflowDiff(expected, reordered).differences, []);
});

test('semantic comparison normalizes legacy and Public API retry fields', () => {
  const repository = readRepositoryWorkflow();
  const legacy = bindForComparison(repository);
  const canonical = workflowPayload(repository, CREDENTIALS);
  assert.deepEqual(semanticWorkflowDiff(legacy, canonical).differences, []);
  const upload = canonicalizeWorkflowForComparison(legacy).nodes.find(
    node => node.id === 'upload-excel'
  );
  assert.equal(upload.maxTries, 3);
  assert.equal(upload.waitBetweenTries, 30000);
});

test('semantic verification rejects a different credential id with exact path', () => {
  const expected = workflowPayload(readRepositoryWorkflow(), CREDENTIALS);
  const record = workflowRecord(DEFAULT_WORKFLOW_ID, expected, {
    active: true,
    versionId: 'current-version',
  });
  record.nodes.find(node => node.id === 'check-registry')
    .credentials.httpHeaderAuth.id = 'wrong-id';
  const result = verificationIssues(
    record,
    expected,
    [],
    CREDENTIALS,
    DEFAULT_WORKFLOW_ID
  );
  assert.ok(result.issues.some(issue =>
    issue === 'draft: Проверить реестр → credentials.httpHeaderAuth.id → ' +
      `expected "${CREDENTIALS.httpHeaderAuth}" → actual "wrong-id"`
  ));
});

test('semantic verification rejects a different URL with exact path', () => {
  const expected = workflowPayload(readRepositoryWorkflow(), CREDENTIALS);
  const record = workflowRecord(DEFAULT_WORKFLOW_ID, expected, {
    active: true,
    versionId: 'current-version',
  });
  record.nodes.find(node => node.id === 'check-registry').parameters.url =
    'http://stale.example/api/v1/upload-idempotency/key';
  const result = verificationIssues(
    record,
    expected,
    [],
    CREDENTIALS,
    DEFAULT_WORKFLOW_ID
  );
  assert.ok(result.issues.some(issue =>
    issue.startsWith(
      'draft: Проверить реестр → parameters.url → expected '
    ) && issue.endsWith(
      '→ actual "http://stale.example/api/v1/upload-idempotency/key"'
    )
  ));
});

test('workflow invariants reject a missing Accept header', () => {
  const expected = workflowPayload(readRepositoryWorkflow(), CREDENTIALS);
  const record = workflowRecord(DEFAULT_WORKFLOW_ID, expected, {
    active: true,
    versionId: 'current-version',
  });
  for (const workflow of [record, record.activeVersion]) {
    workflow.nodes.find(node => node.id === 'check-registry')
      .parameters.headerParameters.parameters = [];
  }
  const result = verificationIssues(
    record,
    expected,
    [],
    CREDENTIALS,
    DEFAULT_WORKFLOW_ID
  );
  assert.ok(result.issues.includes(
    'Проверить реестр: Accept must be application/json'
  ));
  assert.ok(result.issues.includes(
    'published: Проверить реестр: Accept must be application/json'
  ));
});

test('workflow invariants reject duplicate active workflow', () => {
  const expected = workflowPayload(readRepositoryWorkflow(), CREDENTIALS);
  const record = workflowRecord(DEFAULT_WORKFLOW_ID, expected, {
    active: true,
    versionId: 'current-version',
  });
  const duplicate = workflowRecord('duplicate-active', expected, {
    active: true,
    versionId: 'duplicate-version',
  });
  const result = verificationIssues(
    record,
    expected,
    [duplicate],
    CREDENTIALS,
    DEFAULT_WORKFLOW_ID
  );
  assert.ok(result.issues.includes(
    'duplicate non-archived workflow ids: duplicate-active'
  ));
});

test('deployment config identifies N88N credential variable typo', () => {
  assert.throws(
    () => deploymentConfig({
      N8N_BASE_URL: 'http://n8n.example',
      N8N_API_KEY: 'api-key',
      N88N_ARTHUR_CREDENTIAL_ID: 'mistyped-id',
      N8N_MINMAX_IMAP_CREDENTIAL_ID: 'imap-id',
      N8N_MINMAX_SMTP_CREDENTIAL_ID: 'smtp-id',
    }),
    error =>
      error.message.includes('N8N_ARTHUR_CREDENTIAL_ID is required') &&
      error.message.includes('Possible typo detected') &&
      error.message.includes('N88N_ARTHUR_CREDENTIAL_ID')
  );
});

function bindForComparison(repositoryWorkflow) {
  const bound = structuredClone(repositoryWorkflow);
  for (const node of bound.nodes) {
    if (node.credentials?.httpHeaderAuth) {
      node.credentials.httpHeaderAuth.id = CREDENTIALS.httpHeaderAuth;
    }
    if (node.credentials?.imap) node.credentials.imap.id = CREDENTIALS.imap;
    if (node.credentials?.smtp) node.credentials.smtp.id = CREDENTIALS.smtp;
  }
  return bound;
}
