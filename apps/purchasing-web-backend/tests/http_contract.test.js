const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { once } = require('node:events');

const {
  RunQueryService,
} = require('../application/run_query_service');
const {
  FileRunRegistry,
} = require('../storage/file_run_registry');
const {
  createPurchasingWebServer,
} = require('../server');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const PROCESSING_RUN_ID = '88888888-8888-4888-8888-888888888888';
const FAILED_RUN_ID = '99999999-9999-4999-8999-999999999999';
let temporaryRoot;
let runsRoot;
let uploadsRoot;
let registry;
let server;
let baseUrl;
let completedRunId;
let creationLocation;

async function jsonResponse(url, options) {
  const response = await fetch(url, options);
  return {
    response,
    body: await response.json(),
  };
}

before(async () => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-http-'));
  runsRoot = path.join(temporaryRoot, 'runs');
  uploadsRoot = path.join(temporaryRoot, 'uploads');
  registry = new FileRunRegistry({ runsRoot });
  const queryService = new RunQueryService(registry);
  server = createPurchasingWebServer({
    registry,
    queryService,
    uploadRoot: uploadsRoot,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const workbook = fs.readFileSync(path.join(
    REPOSITORY_ROOT,
    'tests/fixtures/SmartZapas_synthetic.xlsx'
  ));
  const form = new FormData();
  form.append('file', new Blob([workbook], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), '../../private/SmartZapas_synthetic.xlsx');
  const created = await jsonResponse(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    body: form,
  });
  assert.equal(created.response.status, 201);
  completedRunId = created.body.data.run_id;
  creationLocation = created.response.headers.get('location');

  registry.createProcessingRun({
    runId: PROCESSING_RUN_ID,
    createdAt: '2026-07-23T00:00:00.000Z',
    source: { original_name: 'fixture.xlsx' },
  });
  registry.createProcessingRun({
    runId: FAILED_RUN_ID,
    createdAt: '2026-07-23T00:00:00.000Z',
    source: { original_name: 'fixture.xlsx' },
  });
  registry.saveFailedRun(FAILED_RUN_ID, new Error('fixture failure'), {
    completedAt: '2026-07-23T00:01:00.000Z',
  });
});

after(async () => {
  if (server?.listening) {
    server.close();
    await once(server, 'close');
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('POST run returns 201, Location, v1 status and sanitized source', async () => {
  const status = await jsonResponse(
    `${baseUrl}/api/v1/runs/${completedRunId}`
  );
  assert.equal(status.response.status, 200);
  assert.equal(status.body.api_version, 'v1');
  assert.equal(status.body.data.status, 'completed');
  assert.equal(creationLocation, `/api/v1/runs/${completedRunId}`);
  assert.equal(
    status.body.data.source.original_name,
    'SmartZapas_synthetic.xlsx'
  );
  assert.equal(
    JSON.stringify(status.body).includes(REPOSITORY_ROOT),
    false
  );
  assert.equal(status.response.headers.has('access-control-allow-origin'), false);

  const runDirectory = path.join(runsRoot, completedRunId);
  assert.equal(fs.existsSync(path.join(runDirectory, 'run.json')), true);
});

test('GET summary, items, owner-review and artifacts expose compact DTOs', async () => {
  const [summary, items, ownerReview, artifacts] = await Promise.all([
    jsonResponse(`${baseUrl}/api/v1/runs/${completedRunId}/summary`),
    jsonResponse(
      `${baseUrl}/api/v1/runs/${completedRunId}/items?page_size=2`
    ),
    jsonResponse(
      `${baseUrl}/api/v1/runs/${completedRunId}/owner-review` +
      '?section=top_priority&page_size=2'
    ),
    jsonResponse(
      `${baseUrl}/api/v1/runs/${completedRunId}/artifacts`
    ),
  ]);

  for (const result of [summary, items, ownerReview, artifacts]) {
    assert.equal(result.response.status, 200);
    assert.equal(result.body.api_version, 'v1');
  }
  assert.equal(summary.body.data.sku_count, 6);
  assert.equal('total_order_sum' in summary.body.data, false);
  assert.equal(items.body.data.items.length, 2);
  assert.equal(items.body.data.pagination.page_size, 2);
  assert.equal(ownerReview.body.data.run_id, completedRunId);
  assert.equal(ownerReview.body.data.section, 'top_priority');
  assert.equal(artifacts.body.data.run_id, completedRunId);
  assert.equal(artifacts.body.data.artifacts.length, 18);
  assert.ok(artifacts.body.data.artifacts.every(artifact =>
    artifact.download_url.startsWith(
      `/api/v1/runs/${completedRunId}/artifacts/`
    )
  ));
});

test('unknown run and invalid UUID return safe v1 errors', async () => {
  const unknown = await jsonResponse(
    `${baseUrl}/api/v1/runs/77777777-7777-4777-8777-777777777777`
  );
  const invalid = await jsonResponse(
    `${baseUrl}/api/v1/runs/..%2F..%2Fprivate`
  );
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.body.api_version, 'v1');
  assert.equal(unknown.body.error.code, 'RUN_NOT_FOUND');
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_RUN_ID');
});

test('not-ready and failed payload queries return 409', async () => {
  const processing = await jsonResponse(
    `${baseUrl}/api/v1/runs/${PROCESSING_RUN_ID}/summary`
  );
  const failed = await jsonResponse(
    `${baseUrl}/api/v1/runs/${FAILED_RUN_ID}/items`
  );
  assert.equal(processing.response.status, 409);
  assert.equal(processing.body.error.code, 'RUN_NOT_READY');
  assert.equal(failed.response.status, 409);
  assert.equal(failed.body.error.code, 'RUN_FAILED');
});

test('invalid query returns 400 and responses never leak stack or paths', async () => {
  const result = await jsonResponse(
    `${baseUrl}/api/v1/runs/${completedRunId}/items?page_size=101`
  );
  assert.equal(result.response.status, 400);
  assert.equal(result.body.api_version, 'v1');
  assert.equal(result.body.error.code, 'INVALID_QUERY');
  const serialized = JSON.stringify(result.body);
  assert.equal(serialized.includes('stack'), false);
  assert.equal(serialized.includes('/Users/'), false);
  assert.equal(serialized.includes('/private/'), false);
});

test('server is bound to localhost and artifact download is available', async () => {
  assert.equal(server.address().address, '127.0.0.1');
  const artifact = await jsonResponse(
    `${baseUrl}/api/v1/runs/${completedRunId}/artifacts/result.json`
  );
  assert.equal(artifact.response.status, 200);
  assert.ok(Array.isArray(artifact.body));
  assert.equal(artifact.response.headers.get('cache-control'), 'no-store');
});

test('successful upload staging directory is cleaned', () => {
  const entries = fs.existsSync(uploadsRoot)
    ? fs.readdirSync(uploadsRoot)
    : [];
  assert.deepEqual(entries, []);
});
