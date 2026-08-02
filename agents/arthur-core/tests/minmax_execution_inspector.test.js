'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  DEFAULT_WORKFLOW_ID,
  readRepositoryWorkflow,
  workflowPayload,
} = require('../../../scripts/arthur/minmax-n8n-workflow-deployment');
const {
  computedRegistryRequest,
  executionHttpEvidence,
  inspectExecution,
  inspectorConfig,
  printInspection,
  replayFromContainer,
} = require('../../../scripts/arthur/inspect-minmax-execution');

const CREDENTIAL_ID = 'pjXec1bxtt81cy0u';
const CREDENTIALS = Object.freeze({
  httpHeaderAuth: CREDENTIAL_ID,
  imap: 'imap-id',
  smtp: 'smtp-id',
});
const IDEMPOTENCY_KEY = 'minmax-INBOX-272-report.xlsx-1234-abcd1234abcd1234';

function runOutput(json) {
  return [{
    data: { main: [[{ json }]] },
    source: [],
    startTime: 1,
    executionTime: 1,
  }];
}

function executionFixture(options = {}) {
  const workflow = workflowPayload(readRepositoryWorkflow(), CREDENTIALS);
  workflow.id = DEFAULT_WORKFLOW_ID;
  workflow.versionId = options.versionId || 'published-version-272';
  return {
    id: '272',
    workflowId: DEFAULT_WORKFLOW_ID,
    mode: options.mode || 'trigger',
    status: 'error',
    workflowData: workflow,
    data: {
      resultData: {
        runData: {
          'Конфигурация MinMax': runOutput({
            config: { apiBaseUrl: 'http://host.docker.internal:3210' },
          }),
          'Письмо подходит?': runOutput({
            idempotencyKey: IDEMPOTENCY_KEY,
          }),
          'Проверить реестр': [{
            source: [{
              previousNode: 'Письмо подходит?',
              previousNodeRun: 0,
              previousNodeOutput: 0,
            }],
            error: {
              message: 'Response body is not valid JSON. Change "Response Format" to "Text"',
              itemIndex: 0,
            },
          }],
        },
      },
    },
  };
}

function workflowRecord(versionId = 'published-version-272') {
  return {
    id: DEFAULT_WORKFLOW_ID,
    versionId,
    active: true,
    activeVersionId: versionId,
    activeVersion: { versionId },
  };
}

function fakeClient(execution, record = workflowRecord()) {
  return {
    async request(method, endpoint) {
      assert.equal(method, 'GET');
      if (endpoint.startsWith('/executions/272?')) return execution;
      if (endpoint === `/credentials/${CREDENTIAL_ID}`) {
        return {
          id: CREDENTIAL_ID,
          name: 'Arthur Core API',
          type: 'httpHeaderAuth',
        };
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    },
    async getWorkflow(id) {
      assert.equal(id, DEFAULT_WORKFLOW_ID);
      return record;
    },
  };
}

function options() {
  return {
    baseUrl: 'http://n8n.example',
    n8nApiKey: 'n8n-key',
    executionId: '272',
    workflowId: DEFAULT_WORKFLOW_ID,
    credentialId: CREDENTIAL_ID,
    expectedCredentialId: CREDENTIAL_ID,
    container: 'n8n-main',
    purchasingApiToken: 'backend-token',
  };
}

test('inspector reconstructs exact registry GET and published trigger version', async () => {
  const execution = executionFixture();
  const result = await inspectExecution(options(), {
    client: fakeClient(execution),
    replay: request => {
      assert.equal(request.container, 'n8n-main');
      assert.equal(request.apiToken, 'backend-token');
      assert.equal(
        request.url,
        `http://host.docker.internal:3210/api/v1/upload-idempotency/${IDEMPOTENCY_KEY}`
      );
      return {
        status: 404,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          error: { code: 'UPLOAD_IDEMPOTENCY_RECORD_NOT_FOUND' },
        }),
        json: { error: { code: 'UPLOAD_IDEMPOTENCY_RECORD_NOT_FOUND' } },
      };
    },
  });

  assert.equal(result.classification.mode, 'trigger');
  assert.equal(result.classification.usesPublishedVersion, true);
  assert.equal(result.request.credential.id, CREDENTIAL_ID);
  assert.equal(result.request.responseFormat, 'json');
  assert.equal(result.request.accept, 'application/json');
  assert.equal(result.evidence.body, null);
  assert.match(result.cause, /discarded the historical raw response/);
});

test('inspector keeps actual HTTP Request parameters strict beside replay', () => {
  const execution = executionFixture();
  const request = computedRegistryRequest(execution);
  assert.equal(request.method, 'GET');
  assert.equal(request.responseFormat, 'json');
  assert.equal(request.accept, 'application/json');
  execution.workflowData.nodes.find(node => node.id === 'check-registry')
    .parameters.options.response.response.responseFormat = 'text';
  assert.equal(computedRegistryRequest(execution).responseFormat, 'text');
});

test('inspector extracts raw HTTP evidence when n8n retains underlying cause', () => {
  const evidence = executionHttpEvidence({
    error: {
      message: 'Response body is not valid JSON',
      cause: {
        response: {
          statusCode: 502,
          headers: { 'content-type': 'text/html' },
          body: '<html>Bad Gateway</html>',
        },
      },
    },
  });
  assert.equal(evidence.status, 502);
  assert.equal(evidence.contentType, 'text/html');
  assert.equal(evidence.body, '<html>Bad Gateway</html>');
});

test('container replay passes x-api-key without exposing it in argv', () => {
  let captured;
  const response = replayFromContainer({
    container: 'n8n-main',
    url: 'http://host.docker.internal:3210/api/v1/upload-idempotency/key',
    apiToken: 'secret-token',
  }, {
    spawn(command, args, spawnOptions) {
      captured = { command, args, spawnOptions };
      return {
        status: 0,
        stdout: JSON.stringify({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: '{"data":{"state":"processing"}}',
        }),
        stderr: '',
      };
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { data: { state: 'processing' } });
  assert.equal(captured.command, 'docker');
  assert.deepEqual(captured.args.slice(0, 2), ['exec', '-i']);
  assert.deepEqual(captured.args.slice(-3), [
    'node', '-',
    'http://host.docker.internal:3210/api/v1/upload-idempotency/key',
  ]);
  assert.match(captured.spawnOptions.input, /process\.argv\[2\]/);
  assert.ok(!captured.args.includes(captured.spawnOptions.input));
  assert.ok(!captured.args.includes('secret-token'));
  assert.equal(
    captured.spawnOptions.env.MINMAX_INSPECT_API_KEY,
    'secret-token'
  );
});

test('inspector rejects stale/manual execution and non-JSON replay precisely', async () => {
  const execution = executionFixture({
    mode: 'manual',
    versionId: 'autosave-draft-version',
  });
  const result = await inspectExecution(options(), {
    client: fakeClient(execution),
    replay: () => ({
      status: 502,
      contentType: 'text/html',
      body: '<html>Bad Gateway</html>',
      json: null,
    }),
  });
  assert.equal(result.classification.isProductionTrigger, false);
  assert.equal(result.classification.usesPublishedVersion, false);
  assert.match(result.cause, /not published/);
  assert.throws(
    () => printInspection(result, { log() {} }, ['backend-token']),
    /Exact container replay is not a JSON response/
  );
});

test('inspector config requires execution, container and production secrets', () => {
  const environment = {
    N8N_BASE_URL: 'http://n8n.example',
    N8N_API_KEY: 'api-key',
    N8N_ARTHUR_CREDENTIAL_ID: CREDENTIAL_ID,
    PURCHASING_API_TOKEN: 'backend-token',
  };
  assert.throws(
    () => inspectorConfig(['--execution-id', '272'], environment),
    /n8n container is required/
  );
  const config = inspectorConfig([
    '--execution-id',
    '272',
    '--n8n-container',
    'n8n-main',
  ], environment);
  assert.equal(config.executionId, '272');
  assert.equal(config.expectedCredentialId, CREDENTIAL_ID);
});
