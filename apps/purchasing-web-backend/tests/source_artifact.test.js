const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { once } = require('node:events');

const {
  DEFAULT_SERVER_PATHS,
} = require('../config');
const {
  FileRunRegistry,
} = require('../storage/file_run_registry');
const {
  FileArtifactStore,
} = require('../storage/file_artifact_store');
const {
  cleanupExpiredRuns,
} = require('../storage/retention_cleanup');
const {
  createPurchasingWebServer,
} = require('../server');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const WORKBOOK_PATH = path.join(
  REPOSITORY_ROOT,
  'tests/fixtures/SmartZapas_synthetic.xlsx'
);

let temporaryRoot;
let server;
let baseUrl;
let runId;
let logCalls;

test.before(async () => {
  temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'purchasing-source-artifact-')
  );
  logCalls = [];
  const registry = new FileRunRegistry({
    runsRoot: path.join(temporaryRoot, 'runs'),
  });
  server = createPurchasingWebServer({
    registry,
    serverPaths: {
      ...DEFAULT_SERVER_PATHS,
      ownerDecisionsPath: path.join(temporaryRoot, 'owner-decisions.json'),
      ownerDecisionHistoryPath: path.join(
        temporaryRoot,
        'owner-decision-history.json'
      ),
      ownerLearningHistoryPath: path.join(
        temporaryRoot,
        'owner-learning-history.json'
      ),
    },
    uploadRoot: path.join(temporaryRoot, 'uploads'),
    uploadIdempotencyStore: null,
    logger: {
      warn: (...args) => logCalls.push(['warn', ...args]),
      error: (...args) => logCalls.push(['error', ...args]),
      info: (...args) => logCalls.push(['info', ...args]),
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(WORKBOOK_PATH)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'MinMax-отчёт июль.xlsx');
  const created = await fetch(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    body: form,
  });
  assert.equal(created.status, 201);
  runId = (await created.json()).data.run_id;
});

test.after(async () => {
  if (server) {
    server.close();
    await once(server, 'close').catch(() => {});
  }
});

// ЭТАП 14 (artifact): исходный Excel сохраняется как artifact run с
// очищенным именем, sha256, размером и датой получения в manifest.
test('manifest содержит source-report.xlsx с метаданными', async () => {
  const response = await fetch(`${baseUrl}/api/v1/runs/${runId}/artifacts`);
  assert.equal(response.status, 200);
  const body = await response.json();
  const artifacts = Array.isArray(body.data) ? body.data : body.data.artifacts;
  const source = artifacts.find(item => item.name === 'source-report.xlsx');
  assert.ok(source, 'source-report.xlsx присутствует в списке artifacts');

  const workbook = fs.readFileSync(WORKBOOK_PATH);
  const expectedSha = crypto.createHash('sha256')
    .update(workbook)
    .digest('hex');
  assert.equal(source.sha256, expectedSha);
  assert.equal(source.size_bytes, workbook.length);
  assert.equal(source.original_name, 'MinMax-отчёт июль.xlsx');
  assert.ok(
    Number.isFinite(new Date(source.received_at).getTime()),
    'received_at — валидная дата'
  );
});

test('source-report.xlsx скачивается и совпадает с оригиналом', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/runs/${runId}/artifacts/source-report.xlsx`
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  const downloaded = Buffer.from(await response.arrayBuffer());
  const workbook = fs.readFileSync(WORKBOOK_PATH);
  assert.ok(downloaded.equals(workbook));
});

// Нельзя получить исходник не того run: имя не из manifest отклоняется.
test('source-report.xls для run с .xlsx недоступен (404)', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/runs/${runId}/artifacts/source-report.xls`
  );
  assert.equal(response.status, 404);
});

// Retention удаляет исходник вместе с run.
test('retention удаляет исходный Excel вместе с run', () => {
  const sourcePath = path.join(
    temporaryRoot,
    'runs',
    runId,
    'artifacts',
    'source-report.xlsx'
  );
  assert.equal(fs.existsSync(sourcePath), true);
  const result = cleanupExpiredRuns({
    runsRoot: path.join(temporaryRoot, 'runs'),
    ttlMs: 0,
    now: new Date(Date.now() + 60 * 1000),
  });
  assert.deepEqual(result.removed, [runId]);
  assert.equal(fs.existsSync(sourcePath), false);
});

// Бинарное содержимое не попадает в логи.
test('логирование не содержит бинарных данных', () => {
  for (const call of logCalls) {
    for (const arg of call) {
      assert.ok(
        !Buffer.isBuffer(arg),
        'логи не должны содержать Buffer с бинарными данными'
      );
    }
  }
});

test('saveSourceArtifact отклоняет не-Excel расширение', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'purchasing-source-artifact-')
  );
  const store = new FileArtifactStore({
    runsRoot: path.join(root, 'runs'),
  });
  const badFile = path.join(root, 'source.txt');
  fs.writeFileSync(badFile, 'not excel', 'utf8');
  assert.throws(
    () => store.saveSourceArtifact(
      '123e4567-e89b-42d3-a456-426614174000',
      badFile
    ),
    error => error.code === 'INVALID_ARTIFACT_CONTENT'
  );
});
