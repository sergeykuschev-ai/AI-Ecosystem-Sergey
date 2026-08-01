'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');

const {
  DEFAULT_WORKFLOW_ID,
  N8nApiClient,
  deployWorkflow,
  inspectHttpNodes,
  readRepositoryWorkflow,
  verifyDeployedWorkflow,
  workflowPayload,
} = require('../../../scripts/arthur/minmax-n8n-workflow-deployment');

const API_KEY = 'n8n-deployment-test-key';
const CREDENTIALS = Object.freeze({
  httpHeaderAuth: 'arthur-http-header-id',
  imap: 'minmax-imap-id',
  smtp: 'minmax-smtp-id',
});

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
      version += 1;
      const created = workflowRecord(
        `created-workflow-${version}`,
        body,
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
      version += 1;
      Object.assign(record, structuredClone(body), {
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
  assert.equal(runtime.records.get('old-duplicate-workflow').isArchived, true);
  assert.ok(runtime.calls.some(call =>
    call.method === 'PUT' &&
    call.path === `/api/v1/workflows/${DEFAULT_WORKFLOW_ID}`
  ));
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
      error.message.includes('published structure hash differs')
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
