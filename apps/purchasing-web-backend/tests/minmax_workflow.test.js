const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const WORKFLOW_PATH = path.resolve(
  __dirname,
  '../../../n8n/workflows/arthur-minmax-yandex-mail-intake.json'
);
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

function jsCode(nodeId) {
  const node = workflow.nodes.find(item => item.id === nodeId);
  assert.ok(node, `node ${nodeId} существует`);
  return node.parameters.jsCode;
}

// vm-harness: выполняет jsCode Code-ноды с моками $json/$binary/$env/$
// так же, как n8n исполняет Code node v2.
function runCodeNode(code, context = {}) {
  const sandbox = {
    $json: context.json ?? {},
    $binary: context.binary ?? {},
    $env: context.env ?? {},
    Buffer,
    Date,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
  };
  sandbox.$ = name => {
    if (!context.nodes || !(name in context.nodes)) {
      throw new Error(`Node "${name}" has no execution data in this test`);
    }
    const items = context.nodes[name];
    const first = items[0] ?? {};
    return {
      first: () => ({ json: first.json ?? first }),
      item: { json: first.json ?? first },
      all: () => items.map(item => ({ json: item.json ?? item })),
    };
  };
  vm.createContext(sandbox);
  const script = new vm.Script(
    `(function () {\n${code}\n})()`
  );
  return script.runInContext(sandbox);
}

const FILTER_ENV = {
  MINMAX_ALLOWED_SENDER: 'minmax@supplier.ru',
  MINMAX_SUBJECT_PATTERN: 'min/max отчёт',
  MINMAX_IMAP_MAILBOX: 'INBOX',
  MINMAX_MAX_ATTACHMENT_BYTES: '20971520',
};

const XLSX_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(64, 7),
]);
const XLS_BYTES = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
  ...Buffer.alloc(32, 3),
]);

function letter(overrides = {}, binary = null) {
  return {
    json: {
      from: { text: 'SmartZapas <minmax@supplier.ru>' },
      subject: 'Min/Max отчёт за июль',
      uid: 1742,
      uidvalidity: 38505,
      date: '2026-07-31T08:00:00.000Z',
      ...overrides,
    },
    binary: binary ?? {
      attachment_0: {
        fileName: 'minmax-july.xlsx',
        data: XLSX_BYTES.toString('base64'),
        fileSize: XLSX_BYTES.length,
      },
    },
    env: FILTER_ENV,
  };
}

function filterOutcome(input) {
  return runCodeNode(jsCode('filter-letter'), input)[0];
}

// --- ЭТАП 14 (workflow): фильтрация писем -------------------------------

test('1. подходящее письмо → process, стабильный idempotency key', () => {
  const result = filterOutcome(letter());
  assert.equal(result.json.outcome, 'process');
  assert.match(result.json.idempotencyKey, /^minmax-[A-Za-z0-9._:-]+$/);
  assert.ok(result.json.idempotencyKey.length >= 8);
  assert.ok(result.json.idempotencyKey.length <= 512);
  assert.equal(result.json.attachmentName, 'minmax-july.xlsx');
  assert.equal(result.json.attachmentSize, XLSX_BYTES.length);
  assert.equal(result.json.messageUid, '1742');
  assert.ok(result.binary.attachment_0, 'binary передан дальше');

  // Ключ стабилен: то же письмо → тот же ключ (идемпотентность).
  const repeat = filterOutcome(letter());
  assert.equal(repeat.json.idempotencyKey, result.json.idempotencyKey);
});

test('2. чужой отправитель → ignored', () => {
  const result = filterOutcome(letter({
    from: { text: 'Кто-то <other@example.ru>' },
  }));
  assert.equal(result.json.outcome, 'ignored');
  assert.equal(result.json.reasonCode, 'SENDER_NOT_ALLOWED');
});

test('3. неверная тема → ignored', () => {
  const result = filterOutcome(letter({ subject: 'Счёт на оплату' }));
  assert.equal(result.json.outcome, 'ignored');
  assert.equal(result.json.reasonCode, 'SUBJECT_MISMATCH');
});

test('4. письмо без вложений → ignored', () => {
  const result = filterOutcome(letter({}, {}));
  assert.equal(result.json.outcome, 'ignored');
  assert.equal(result.json.reasonCode, 'NO_ATTACHMENT');
});

test('5. вложение не Excel → rejected', () => {
  const result = filterOutcome(letter({}, {
    attachment_0: {
      fileName: 'invoice.pdf',
      data: Buffer.from('%PDF-1.4 fake').toString('base64'),
      fileSize: 15,
    },
  }));
  assert.equal(result.json.outcome, 'rejected');
  assert.equal(result.json.reasonCode, 'ATTACHMENT_TYPE_UNSUPPORTED');
});

test('6. два Excel-вложения → rejected', () => {
  const result = filterOutcome(letter({}, {
    attachment_0: {
      fileName: 'a.xlsx',
      data: XLSX_BYTES.toString('base64'),
      fileSize: XLSX_BYTES.length,
    },
    attachment_1: {
      fileName: 'b.xlsx',
      data: XLSX_BYTES.toString('base64'),
      fileSize: XLSX_BYTES.length,
    },
  }));
  assert.equal(result.json.outcome, 'rejected');
  assert.equal(result.json.reasonCode, 'MULTIPLE_ATTACHMENTS');
});

test('6b. слишком большое вложение → rejected', () => {
  const result = filterOutcome(
    letter({}, {
      attachment_0: {
        fileName: 'big.xlsx',
        data: XLSX_BYTES.toString('base64'),
        fileSize: XLSX_BYTES.length,
      },
    })
  );
  // Лимит меньше реального размера.
  const limited = runCodeNode(jsCode('filter-letter'), {
    ...letter({}, {
      attachment_0: {
        fileName: 'big.xlsx',
        data: XLSX_BYTES.toString('base64'),
      },
    }),
    env: { ...FILTER_ENV, MINMAX_MAX_ATTACHMENT_BYTES: '10' },
  })[0];
  assert.equal(result.json.outcome, 'process');
  assert.equal(limited.json.outcome, 'rejected');
  assert.equal(limited.json.reasonCode, 'ATTACHMENT_TOO_LARGE');
});

test('6c. поддельная сигнатура Excel → rejected', () => {
  const result = filterOutcome(letter({}, {
    attachment_0: {
      fileName: 'fake.xlsx',
      data: Buffer.from('this is not an excel file at all').toString('base64'),
    },
  }));
  assert.equal(result.json.outcome, 'rejected');
  assert.equal(result.json.reasonCode, 'ATTACHMENT_SIGNATURE_INVALID');
});

test('6d. классический .xls (OLE2) принимается', () => {
  const result = filterOutcome(letter({}, {
    attachment_0: {
      fileName: 'minmax-july.xls',
      data: XLS_BYTES.toString('base64'),
    },
  }));
  assert.equal(result.json.outcome, 'process');
});

// --- Реестр: решение по существующей записи -----------------------------

const FILTER_JSON = {
  outcome: 'process',
  idempotencyKey: 'minmax-INBOX-38505-1742-minmax-july.xlsx-68',
  attachmentName: 'minmax-july.xlsx',
  mailbox: 'INBOX',
  messageUid: '1742',
};

function decideByRegistry(apiResponse) {
  return runCodeNode(jsCode('decide-by-registry'), {
    json: apiResponse,
    nodes: { 'Отфильтровать письмо': [{ json: FILTER_JSON }] },
  })[0].json;
}

test('22a. записи нет (404) → upload', () => {
  const result = decideByRegistry({
    api_version: 'v1',
    error: { code: 'UPLOAD_IDEMPOTENCY_RECORD_NOT_FOUND' },
  });
  assert.equal(result.action, 'upload');
  assert.equal(result.runId, undefined);
});

test('22b. completed без уведомления → notify (без повторного run)', () => {
  const result = decideByRegistry({
    data: {
      idempotency_key: FILTER_JSON.idempotencyKey,
      state: 'completed',
      run_id: 'run-1',
      notification_sent_at: null,
    },
  });
  assert.equal(result.action, 'notify');
  assert.equal(result.runId, 'run-1');
});

test('22c. completed с отправленным уведомлением → done', () => {
  const result = decideByRegistry({
    data: {
      idempotency_key: FILTER_JSON.idempotencyKey,
      state: 'completed',
      run_id: 'run-1',
      notification_sent_at: '2026-07-31T09:00:00.000Z',
    },
  });
  assert.equal(result.action, 'done');
});

test('22d. run уже создан (обрыв после run_created) → poll, не upload', () => {
  const result = decideByRegistry({
    data: {
      idempotency_key: FILTER_JSON.idempotencyKey,
      state: 'run_created',
      run_id: 'run-2',
    },
  });
  assert.equal(result.action, 'poll');
  assert.equal(result.runId, 'run-2');
});

test('22e. failed run → notify-error, повторный run не создаётся', () => {
  const result = decideByRegistry({
    data: {
      idempotency_key: FILTER_JSON.idempotencyKey,
      state: 'failed',
      run_id: 'run-3',
      error_code: 'INVALID_WORKBOOK',
    },
  });
  assert.equal(result.action, 'notify-error');
  assert.equal(result.runId, 'run-3');
  assert.equal(result.runError, 'INVALID_WORKBOOK');
});

test('22f. ignored/rejected запись → done', () => {
  const result = decideByRegistry({
    data: {
      idempotency_key: FILTER_JSON.idempotencyKey,
      state: 'ignored',
      run_id: null,
    },
  });
  assert.equal(result.action, 'done');
});

// --- Ответ загрузки ------------------------------------------------------

test('23a. 201 с run_id → runId получен', () => {
  const [result] = runCodeNode(jsCode('check-upload-response'), {
    json: {
      ...FILTER_JSON,
      api_version: 'v1',
      data: { run_id: 'run-new', status: 'completed' },
    },
  });
  assert.equal(result.json.runId, 'run-new');
  assert.equal(result.json.uploadError, null);
  assert.equal(result.json.uploadReplay, false);
  // Контекст письма сохранён для следующих нод.
  assert.equal(result.json.idempotencyKey, FILTER_JSON.idempotencyKey);
});

test('23b. 200 replay → runId существующего run, дубликат не создан', () => {
  const [result] = runCodeNode(jsCode('check-upload-response'), {
    json: {
      ...FILTER_JSON,
      api_version: 'v1',
      data: { run_id: 'run-existing', status: 'completed', idempotent_replay: true },
    },
  });
  assert.equal(result.json.runId, 'run-existing');
  assert.equal(result.json.uploadReplay, true);
});

test('23c. 409 IDEMPOTENCY_KEY_CONFLICT → ошибка без runId', () => {
  const [result] = runCodeNode(jsCode('check-upload-response'), {
    json: {
      ...FILTER_JSON,
      api_version: 'v1',
      error: { code: 'IDEMPOTENCY_KEY_CONFLICT' },
    },
  });
  assert.equal(result.json.runId, null);
  assert.equal(result.json.uploadError, 'IDEMPOTENCY_KEY_CONFLICT');
});

// --- Polling статуса ------------------------------------------------------

function evaluateStatus(json, env = {}) {
  return runCodeNode(jsCode('evaluate-run-status'), {
    json,
    env,
  })[0].json;
}

test('24a. completed → verdict completed', () => {
  const result = evaluateStatus({
    runId: 'run-1',
    pollCount: 1,
    pollDeadline: Date.now() + 60000,
    data: { run_id: 'run-1', status: 'completed' },
  });
  assert.equal(result.verdict, 'completed');
  assert.equal(result.runId, 'run-1');
});

test('24b. processing → wait, счётчик растёт, deadline не продлевается', () => {
  const deadline = Date.now() + 30000;
  const result = evaluateStatus({
    runId: 'run-1',
    pollCount: 2,
    pollDeadline: deadline,
    data: { run_id: 'run-1', status: 'processing' },
  });
  assert.equal(result.verdict, 'wait');
  assert.equal(result.pollCount, 3);
  assert.equal(result.pollDeadline, deadline);
});

test('24c. processing после deadline → timeout (без бесконечного цикла)', () => {
  const result = evaluateStatus({
    runId: 'run-1',
    pollCount: 30,
    pollDeadline: Date.now() - 1000,
    data: { run_id: 'run-1', status: 'processing' },
  });
  assert.equal(result.verdict, 'timeout');
});

test('24d. failed run → verdict failed с кодом ошибки', () => {
  const result = evaluateStatus({
    runId: 'run-1',
    pollCount: 0,
    pollDeadline: 0,
    data: {
      run_id: 'run-1',
      status: 'failed',
      error: { code: 'INVALID_WORKBOOK' },
    },
  });
  assert.equal(result.verdict, 'failed');
  assert.equal(result.runError, 'INVALID_WORKBOOK');
});

// --- Уведомления ------------------------------------------------------------

test('25. уведомление владельцу: состав и deep link', () => {
  const [result] = runCodeNode(jsCode('compose-owner-notification'), {
    json: { runId: 'run-9' },
    env: {
      MINMAX_OWNER_UI_BASE_URL: 'http://localhost:3210',
      MINMAX_NOTIFY_EMAIL: 'owner@example.ru',
    },
    nodes: {
      'Отфильтровать письмо': [{ json: FILTER_JSON }],
      'Сводка run': [{
        json: {
          data: {
            run_id: 'run-9',
            sku_count: 42,
            financial: {
              status: 'CONFIRMED',
              recommendation: 'ORDER_WITHIN_LIMIT',
            },
          },
        },
      }],
      'Счётчики решений': [{
        json: {
          data: {
            items: [{ supplier: 'СмартЗапас' }],
            owner_decisions: { needs_decision: 3 },
          },
        },
      }],
    },
  });
  const text = result.json.notifyText;
  assert.ok(text.includes('СмартЗапас'), 'поставщик');
  assert.ok(text.includes('minmax-july.xlsx'), 'файл');
  assert.ok(text.includes('run-9'), 'runId');
  assert.ok(text.includes('ORDER_WITHIN_LIMIT'), 'рекомендация');
  assert.ok(text.includes('42'), 'количество позиций');
  assert.ok(text.includes('3'), 'требующих решения');
  assert.ok(text.includes('CONFIRMED'), 'финансовый статус');
  assert.ok(
    text.includes('http://localhost:3210/?runId=run-9'),
    'deep link на Owner Review'
  );
  assert.ok(
    text.includes('автоматически не отправляется'),
    'явно указано, что заказ не уходит поставщику'
  );
  assert.equal(result.json.notifyTo, 'owner@example.ru');
  assert.match(result.json.notifySubject, /run-9/);
});

test('26. письмо об ошибке: письмо не отмечается успешным', () => {
  const [result] = runCodeNode(jsCode('compose-error-letter'), {
    json: { uploadError: 'IDEMPOTENCY_KEY_CONFLICT' },
    env: { MINMAX_NOTIFY_EMAIL: 'owner@example.ru' },
    nodes: { 'Отфильтровать письмо': [{ json: FILTER_JSON }] },
  });
  assert.equal(result.json.errorCode, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.ok(result.json.notifyText.includes(FILTER_JSON.idempotencyKey));
  assert.ok(result.json.notifyText.includes('НЕ отмечено'));
  assert.ok(result.json.notifyText.includes('дубликат run не будет создан'));
});

// --- Валидатор workflow JSON ------------------------------------------------

test('27. workflow JSON: структура, отсутствие секретов, credentials', () => {
  assert.equal(workflow.name, 'Arthur — MinMax Yandex Mail Intake');
  assert.equal(workflow.active, false);
  assert.ok(Array.isArray(workflow.nodes) && workflow.nodes.length > 10);

  const serialized = JSON.stringify(workflow);
  // Никаких реальных секретов: только placeholders и env-имена.
  assert.ok(!/password["']?\s*[:=]\s*["'][^"']+/.test(serialized));
  assert.ok(!/x-api-key["']?\s*:\s*["'][A-Za-z0-9_-]{16,}/.test(serialized));
  assert.ok(!serialized.includes('yandex.ru password'));

  // Все credential ссылки — placeholders.
  for (const node of workflow.nodes) {
    for (const cred of Object.values(node.credentials ?? {})) {
      assert.equal(
        cred.id,
        'REPLACE_IN_N8N',
        `credential ${cred.name} в ${node.name} — placeholder`
      );
    }
  }

  // IMAP/SMTP используют стандартные хосты Яндекса через credentials,
  // а не хардкод в параметрах.
  const imap = workflow.nodes.find(n => n.type === 'n8n-nodes-base.emailReadImap');
  assert.ok(imap, 'IMAP trigger присутствует');
  assert.equal(imap.parameters.postProcessAction, 'nothing');

  // Upload несёт idempotency key и multipart-файл.
  const upload = workflow.nodes.find(n => n.id === 'upload-excel');
  const uploadParams = JSON.stringify(upload.parameters);
  assert.ok(uploadParams.includes('x-idempotency-key'));
  assert.ok(uploadParams.includes('idempotency_key'));
  assert.equal(upload.parameters.contentType, 'multipart-form-data');
  assert.ok(upload.parameters.options.timeout >= 600000);

  // Polling ограничен по времени.
  const evalCode = jsCode('evaluate-run-status');
  assert.ok(evalCode.includes('MINMAX_POLL_TIMEOUT_SECONDS'));
  assert.ok(evalCode.includes('pollDeadline'));

  // Все connections ссылаются на существующие ноды.
  const names = new Set(workflow.nodes.map(n => n.name));
  for (const [from, conn] of Object.entries(workflow.connections)) {
    assert.ok(names.has(from), `connection source ${from}`);
    for (const outputs of conn.main) {
      for (const edge of outputs) {
        assert.ok(names.has(edge.node), `connection target ${edge.node}`);
      }
    }
  }
});
