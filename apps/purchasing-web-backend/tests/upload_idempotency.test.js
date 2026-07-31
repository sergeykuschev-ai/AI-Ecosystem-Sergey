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
  UploadIdempotencyStore,
} = require('../storage/upload_idempotency_store');
const {
  createPurchasingWebServer,
} = require('../server');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const WORKBOOK_PATH = path.join(
  REPOSITORY_ROOT,
  'tests/fixtures/SmartZapas_synthetic.xlsx'
);
const KEY_A = 'minmax-a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const KEY_B = 'minmax-b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1';
const KEY_C = 'minmax-c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2';
const KEY_IGNORED = 'minmax-ignored0718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3';

function workbookBuffer(mutate = false) {
  const buffer = fs.readFileSync(WORKBOOK_PATH);
  if (mutate) {
    // Flip a trailing byte: the file keeps a valid xlsx signature but
    // gets a different sha256.
    buffer[buffer.length - 1] ^= 0xff;
  }
  return buffer;
}

function workbookForm(mutate = false, fields = {}) {
  const form = new FormData();
  form.append('file', new Blob([workbookBuffer(mutate)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'minmax-report.xlsx');
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  return form;
}

async function jsonResponse(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  return { response, body, text };
}

const activeServers = [];

async function startServer(root) {
  const registry = new FileRunRegistry({
    runsRoot: path.join(root, 'runs'),
  });
  const server = createPurchasingWebServer({
    registry,
    serverPaths: {
      ...DEFAULT_SERVER_PATHS,
      ownerDecisionsPath: path.join(root, 'owner-decisions.json'),
      ownerDecisionHistoryPath: path.join(
        root,
        'owner-decision-history.json'
      ),
      ownerLearningHistoryPath: path.join(
        root,
        'owner-learning-history.json'
      ),
    },
    uploadRoot: path.join(root, 'uploads'),
    uploadIdempotencyPath: path.join(root, 'upload-idempotency.json'),
    logger: { warn() {}, error() {}, info() {} },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  activeServers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function stopServer(server) {
  server.close();
  await once(server, 'close').catch(() => {});
}

test.after(async () => {
  for (const server of activeServers.splice(0)) {
    await stopServer(server);
  }
});

// ЭТАП 14 (idempotency): повторная загрузка с тем же ключом возвращает
// существующий run и не создаёт второй.
test('повтор с тем же ключом возвращает существующий run (replay)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const baseUrl = await startServer(root);

  const first = await jsonResponse(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    headers: { 'x-idempotency-key': KEY_A },
    body: workbookForm(),
  });
  assert.equal(first.response.status, 201);
  const runId = first.body.data.run_id;
  assert.match(runId, /^[0-9a-f-]{36}$/);

  const replay = await jsonResponse(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    headers: { 'x-idempotency-key': KEY_A },
    body: workbookForm(),
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.data.run_id, runId);
  assert.equal(replay.body.data.idempotent_replay, true);
  assert.equal(
    replay.response.headers.get('location'),
    `/api/v1/runs/${runId}`
  );

  const record = await jsonResponse(
    `${baseUrl}/api/v1/upload-idempotency/${KEY_A}`
  );
  assert.equal(record.response.status, 200);
  assert.equal(record.body.data.state, 'completed');
  assert.equal(record.body.data.run_id, runId);
  assert.equal(record.body.data.sha256.length, 64);
});

// ЭТАП 14: тот же ключ с другим содержимым — конфликт, второй run
// не создаётся.
test('тот же ключ с другим sha256 даёт 409 без нового run', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const baseUrl = await startServer(root);

  const first = await jsonResponse(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    headers: { 'x-idempotency-key': KEY_B },
    body: workbookForm(),
  });
  assert.equal(first.response.status, 201);

  const conflict = await jsonResponse(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    headers: { 'x-idempotency-key': KEY_B },
    body: workbookForm(true),
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, 'IDEMPOTENCY_KEY_CONFLICT');

  const record = await jsonResponse(
    `${baseUrl}/api/v1/upload-idempotency/${KEY_B}`
  );
  assert.equal(record.body.data.run_id, first.body.data.run_id);
  assert.equal(record.body.data.state, 'completed');
});

// ЭТАП 14: registry переживает перезапуск backend — replay работает
// после полного пересоздания сервера.
test('replay переживает перезапуск backend', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const firstUrl = await startServer(root);
  const created = await jsonResponse(`${firstUrl}/api/v1/runs`, {
    method: 'POST',
    headers: { 'x-idempotency-key': KEY_C },
    body: workbookForm(),
  });
  assert.equal(created.response.status, 201);
  const runId = created.body.data.run_id;
  const firstServer = activeServers.pop();
  await stopServer(firstServer);

  const secondUrl = await startServer(root);
  const replay = await jsonResponse(`${secondUrl}/api/v1/runs`, {
    method: 'POST',
    headers: { 'x-idempotency-key': KEY_C },
    body: workbookForm(),
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.data.run_id, runId);
  assert.equal(replay.body.data.idempotent_replay, true);
});

// Ключ может прийти multipart-полем idempotency_key; header имеет
// приоритет, расхождение запрещено.
test('ключ из multipart-поля работает, расхождение с header запрещено', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const baseUrl = await startServer(root);
  const fieldKey = 'minmax-field000000000000000000000000000000000000000000000000000000000001';

  const created = await jsonResponse(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    body: workbookForm(false, {
      idempotency_key: fieldKey,
      mailbox: 'minmax@yandex.ru',
      message_uid: '1742',
    }),
  });
  assert.equal(created.response.status, 201);
  const runId = created.body.data.run_id;

  const record = await jsonResponse(
    `${baseUrl}/api/v1/upload-idempotency/${fieldKey}`
  );
  assert.equal(record.body.data.mailbox, 'minmax@yandex.ru');
  assert.equal(record.body.data.message_uid, '1742');
  assert.equal(record.body.data.run_id, runId);

  await t.test('совпадающий header + поле → replay', async () => {
    const replay = await jsonResponse(`${baseUrl}/api/v1/runs`, {
      method: 'POST',
      headers: { 'x-idempotency-key': fieldKey },
      body: workbookForm(false, { idempotency_key: fieldKey }),
    });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.data.run_id, runId);
  });

  await t.test('разные header и поле → 400', async () => {
    const mismatch = await jsonResponse(`${baseUrl}/api/v1/runs`, {
      method: 'POST',
      headers: { 'x-idempotency-key': KEY_A },
      body: workbookForm(false, { idempotency_key: fieldKey }),
    });
    assert.equal(mismatch.response.status, 400);
    assert.equal(mismatch.body.error.code, 'INVALID_IDEMPOTENCY_KEY');
  });
});

test('невалидный ключ отклоняется с INVALID_IDEMPOTENCY_KEY', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const baseUrl = await startServer(root);
  const bad = await jsonResponse(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    headers: { 'x-idempotency-key': 'no/slash' },
    body: workbookForm(),
  });
  assert.equal(bad.response.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_IDEMPOTENCY_KEY');
});

test('загрузка без ключа не создаёт idempotency record', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const baseUrl = await startServer(root);
  const created = await jsonResponse(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    body: workbookForm(),
  });
  assert.equal(created.response.status, 201);
  assert.equal(
    fs.existsSync(path.join(root, 'upload-idempotency.json')),
    false
  );
});

test('GET неизвестного ключа возвращает 404', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const baseUrl = await startServer(root);
  const missing = await jsonResponse(
    `${baseUrl}/api/v1/upload-idempotency/${KEY_A}`
  );
  assert.equal(missing.response.status, 404);
  assert.equal(
    missing.body.error.code,
    'UPLOAD_IDEMPOTENCY_RECORD_NOT_FOUND'
  );
});

// Отметка об отправленном уведомлении: n8n фиксирует факт письма,
// чтобы не отправить его дважды после обрыва.
test('POST notification фиксирует notification_sent_at', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const baseUrl = await startServer(root);
  await jsonResponse(`${baseUrl}/api/v1/upload-idempotency`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      idempotency_key: KEY_IGNORED,
      mailbox: 'minmax@yandex.ru',
      message_uid: '900',
      state: 'ignored',
    }),
  });

  const marked = await jsonResponse(
    `${baseUrl}/api/v1/upload-idempotency/${KEY_IGNORED}/notification`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sent_at: '2026-07-31T10:15:00.000Z' }),
    }
  );
  assert.equal(marked.response.status, 200);
  assert.equal(
    marked.body.data.notification_sent_at,
    '2026-07-31T10:15:00.000Z'
  );

  const invalid = await jsonResponse(
    `${baseUrl}/api/v1/upload-idempotency/${KEY_IGNORED}/notification`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sent_at: 'not-a-date' }),
    }
  );
  assert.equal(invalid.response.status, 400);
});

// Письма без подходящего вложения фиксируются как ignored/rejected,
// чтобы workflow не обрабатывал их повторно.
test('register record: ignored/rejected без run, повтор → replay', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const baseUrl = await startServer(root);

  const created = await jsonResponse(`${baseUrl}/api/v1/upload-idempotency`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      idempotency_key: 'minmax-rejected0000000000000000000000000000000000000000000000000000000001',
      mailbox: 'minmax@yandex.ru',
      message_uid: '901',
      attachment_name: 'invoice.pdf',
      state: 'rejected',
      error_code: 'ATTACHMENT_TYPE_UNSUPPORTED',
    }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.data.state, 'rejected');
  assert.equal(created.body.data.run_id, null);

  const again = await jsonResponse(`${baseUrl}/api/v1/upload-idempotency`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      idempotency_key: 'minmax-rejected0000000000000000000000000000000000000000000000000000000001',
      state: 'ignored',
    }),
  });
  assert.equal(again.response.status, 200);
  // Первое состояние сохраняется, повторная запись не перезаписывает.
  assert.equal(again.body.data.state, 'rejected');

  const badState = await jsonResponse(`${baseUrl}/api/v1/upload-idempotency`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      idempotency_key: 'minmax-badstate000000000000000000000000000000000000000000000000000000000002',
      state: 'completed',
    }),
  });
  assert.equal(badState.response.status, 400);
});

// Workflow может пометить письмо uncertain (обрыв соединения, таймаут
// polling) — но не может отметить его completed или ignored при run.
test('POST state: uncertain разрешён, completed запрещён', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const baseUrl = await startServer(root);
  const stateKey = 'minmax-state0000000000000000000000000000000000000000000000000000000000000003';
  await jsonResponse(`${baseUrl}/api/v1/upload-idempotency`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idempotency_key: stateKey }),
  });

  const uncertain = await jsonResponse(
    `${baseUrl}/api/v1/upload-idempotency/${stateKey}/state`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: 'uncertain',
        error_code: 'POLL_TIMEOUT',
      }),
    }
  );
  assert.equal(uncertain.response.status, 200);
  assert.equal(uncertain.body.data.state, 'uncertain');
  assert.equal(uncertain.body.data.error_code, 'POLL_TIMEOUT');

  const completed = await jsonResponse(
    `${baseUrl}/api/v1/upload-idempotency/${stateKey}/state`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'completed' }),
    }
  );
  assert.equal(completed.response.status, 400);

  const missing = await jsonResponse(
    `${baseUrl}/api/v1/upload-idempotency/${KEY_A}/state`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'uncertain' }),
    }
  );
  assert.equal(missing.response.status, 404);
});

test('store: атомарная запись, конфликт sha256, переживает reload', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const filePath = path.join(root, 'nested', 'registry.json');
  const shaA = crypto.createHash('sha256').update('a').digest('hex');
  const shaB = crypto.createHash('sha256').update('b').digest('hex');

  const store = new UploadIdempotencyStore({ filePath });
  const first = await store.registerReceived({
    idempotencyKey: KEY_A,
    sha256: shaA,
    attachmentName: 'minmax.xlsx',
    attachmentSize: 12345,
  });
  assert.equal(first.created, true);
  assert.equal(first.record.state, 'received');

  const duplicate = await store.registerReceived({
    idempotencyKey: KEY_A,
    sha256: shaA,
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.conflict, false);

  const conflict = await store.registerReceived({
    idempotencyKey: KEY_A,
    sha256: shaB,
  });
  assert.equal(conflict.created, false);
  assert.equal(conflict.conflict, true);

  await store.update(KEY_A, { state: 'run_created', runId: 'r-1' });
  await store.update(KEY_A, { state: 'completed' });

  const reloaded = new UploadIdempotencyStore({ filePath });
  const record = reloaded.get(KEY_A);
  assert.equal(record.state, 'completed');
  assert.equal(record.runId, 'r-1');
  assert.equal(record.attachmentName, 'minmax.xlsx');
  assert.equal(record.attachmentSize, 12345);
  assert.equal(record.sha256, shaA);

  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(persisted.version, 1);
  assert.ok(persisted.records[KEY_A]);
});

test('store: повреждённый файл вызывает STORAGE-ошибку', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const filePath = path.join(root, 'registry.json');
  fs.writeFileSync(filePath, '{broken json', 'utf8');
  assert.throws(
    () => new UploadIdempotencyStore({ filePath }),
    error => error.code === 'UPLOAD_IDEMPOTENCY_STORAGE_ERROR'
  );
});

test('store: неизвестный state отклоняется', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-idem-'));
  const store = new UploadIdempotencyStore({
    filePath: path.join(root, 'registry.json'),
  });
  await store.registerReceived({ idempotencyKey: KEY_A });
  await assert.rejects(
    () => store.update(KEY_A, { state: 'teleported' }),
    error => error.code === 'UPLOAD_IDEMPOTENCY_STORAGE_ERROR'
  );
});
