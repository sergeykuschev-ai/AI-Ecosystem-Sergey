const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { afterEach, test } = require('node:test');

const {
  XLS_SIGNATURE,
  cleanupUploadDirectory,
  parseExcelUpload,
} = require('../http/upload_handler');
const { sendError, sendSuccess } = require('../http/responses');
const {
  createPurchasingWebServer,
} = require('../server');

const temporaryRoots = [];

function createRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-validation-'));
  temporaryRoots.push(root);
  return root;
}

async function startUploadServer(options = {}) {
  const uploadRoot = createRoot();
  const server = http.createServer(async (request, response) => {
    const requestId = randomUUID();
    try {
      const upload = await parseExcelUpload(request, {
        uploadRoot,
        requestId,
        ...options,
      });
      sendSuccess(response, 200, {
        extension: upload.extension,
        original_name: upload.originalName,
        size_bytes: upload.sizeBytes,
      });
    } catch (error) {
      if (!response.destroyed) {
        sendError(response, error, { requestId });
      }
    } finally {
      cleanupUploadDirectory(uploadRoot, requestId);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    uploadRoot,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function closeServer(server) {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}

function excelForm(buffer, filename, mimeType, reportDate) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  if (reportDate !== undefined) form.append('report_date', reportDate);
  return form;
}

async function post(url, form) {
  const response = await fetch(url, { method: 'POST', body: form });
  return { response, body: await response.json() };
}

function stagedEntries(uploadRoot) {
  return fs.existsSync(uploadRoot) ? fs.readdirSync(uploadRoot) : [];
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

test('valid xlsx and xls signatures are accepted with safe disk handling', async () => {
  const { server, uploadRoot, url } = await startUploadServer();
  try {
    const xlsx = await post(url, excelForm(
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]),
      '../unsafe/source.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ));
    const xls = await post(url, excelForm(
      Buffer.concat([XLS_SIGNATURE, Buffer.from([1, 2, 3, 4])]),
      'legacy.xls',
      'application/vnd.ms-excel'
    ));
    assert.equal(xlsx.response.status, 200);
    assert.equal(xlsx.body.data.extension, '.xlsx');
    assert.equal(xlsx.body.data.original_name, 'source.xlsx');
    assert.equal(xls.response.status, 200);
    assert.equal(xls.body.data.extension, '.xls');
    assert.deepEqual(stagedEntries(uploadRoot), []);
  } finally {
    await closeServer(server);
  }
});

test('missing file and multiple files are rejected', async () => {
  const { server, uploadRoot, url } = await startUploadServer();
  try {
    const missingForm = new FormData();
    missingForm.append('report_date', '2026-07-23');
    const missing = await post(url, missingForm);

    const twoFiles = new FormData();
    const payload = new Blob([
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]),
    ], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    twoFiles.append('file', payload, 'one.xlsx');
    twoFiles.append('file', payload, 'two.xlsx');
    const multiple = await post(url, twoFiles);

    assert.equal(missing.response.status, 400);
    assert.equal(missing.body.error.code, 'FILE_REQUIRED');
    assert.equal(multiple.response.status, 400);
    assert.equal(multiple.body.error.code, 'MULTIPLE_FILES');
    assert.deepEqual(stagedEntries(uploadRoot), []);
  } finally {
    await closeServer(server);
  }
});

test('non-multipart request is rejected as INVALID_MULTIPART', async () => {
  const { server, uploadRoot, url } = await startUploadServer();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'INVALID_MULTIPART');
    assert.deepEqual(stagedEntries(uploadRoot), []);
  } finally {
    await closeServer(server);
  }
});

test('file and request size limits return 413 and clean staging', async () => {
  const { server, uploadRoot, url } = await startUploadServer({
    maxFileBytes: 8,
    maxRequestBytes: 1024,
  });
  try {
    const tooLarge = await post(url, excelForm(
      Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.alloc(32),
      ]),
      'large.xlsx',
      'application/octet-stream'
    ));
    assert.equal(tooLarge.response.status, 413);
    assert.equal(tooLarge.body.error.code, 'UPLOAD_TOO_LARGE');
    assert.deepEqual(stagedEntries(uploadRoot), []);
  } finally {
    await closeServer(server);
  }
});

test('wrong extension, MIME and fake Excel signature return 415', async () => {
  const { server, uploadRoot, url } = await startUploadServer();
  try {
    const wrongExtension = await post(url, excelForm(
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      'source.csv',
      'text/csv'
    ));
    const wrongMime = await post(url, excelForm(
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      'source.xlsx',
      'text/plain'
    ));
    const fake = await post(url, excelForm(
      Buffer.from('not an Excel file'),
      'source.xlsx',
      'application/octet-stream'
    ));
    for (const result of [wrongExtension, wrongMime, fake]) {
      assert.equal(result.response.status, 415);
      assert.equal(result.body.error.code, 'UNSUPPORTED_FILE_TYPE');
    }
    assert.deepEqual(stagedEntries(uploadRoot), []);
  } finally {
    await closeServer(server);
  }
});

test('invalid report_date is rejected and cleanup runs', async () => {
  const { server, uploadRoot, url } = await startUploadServer();
  try {
    const result = await post(url, excelForm(
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]),
      'source.xlsx',
      'application/octet-stream',
      '2026-02-30'
    ));
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, 'INVALID_REPORT_DATE');
    assert.deepEqual(stagedEntries(uploadRoot), []);
  } finally {
    await closeServer(server);
  }
});

test('corrupted workbook passes signature check but is rejected by adapter', async () => {
  const root = createRoot();
  const runsRoot = path.join(root, 'runs');
  const uploadRoot = path.join(root, 'uploads');
  const server = createPurchasingWebServer({ runsRoot, uploadRoot });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const result = await post(
      `http://127.0.0.1:${server.address().port}/api/v1/runs`,
      excelForm(
        Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]),
        'corrupted.xlsx',
        'application/octet-stream'
      )
    );
    assert.equal(result.response.status, 422);
    assert.equal(result.body.error.code, 'INVALID_WORKBOOK');
    assert.deepEqual(stagedEntries(uploadRoot), []);
  } finally {
    await closeServer(server);
  }
});

test('aborted multipart upload removes upload.tmp', async () => {
  const { server, uploadRoot } = await startUploadServer({
    timeoutMs: 1000,
  });
  try {
    const boundary = 'abort-boundary';
    const prefix = Buffer.from(
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="source.xlsx"\r\n' +
      'Content-Type: application/octet-stream\r\n\r\n'
    );
    const request = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Transfer-Encoding': 'chunked',
      },
    });
    request.on('error', () => {});
    request.write(prefix);
    request.write(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const closed = new Promise(resolve => request.once('close', resolve));
    request.destroy();
    await closed;

    const deadline = Date.now() + 1000;
    while (stagedEntries(uploadRoot).length > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual(stagedEntries(uploadRoot), []);
  } finally {
    await closeServer(server);
  }
});
