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
const FIXED_WORKFLOW_PATH = path.resolve(
  __dirname,
  '../../../n8n/workflows/arthur-minmax-yandex-mail-intake-fixed.json'
);
const fixedWorkflow = JSON.parse(fs.readFileSync(FIXED_WORKFLOW_PATH, 'utf8'));

function jsCode(nodeId) {
  const node = workflow.nodes.find(item => item.id === nodeId);
  assert.ok(node, `node ${nodeId} существует`);
  return node.parameters.jsCode;
}

function fixedJsCode(nodeId) {
  const node = fixedWorkflow.nodes.find(item => item.id === nodeId);
  assert.ok(node, `fixed workflow node ${nodeId} существует`);
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

// Форма объекта соответствует Email Trigger (IMAP) v2, формат resolved:
// UID лежит в attributes.uid; uidvalidity нода НЕ возвращает.
function letter(overrides = {}, binary = null) {
  return {
    json: {
      from: { text: 'SmartZapas <minmax@supplier.ru>' },
      subject: 'Min/Max отчёт за июль',
      attributes: { uid: 1742 },
      messageId: '<202607310800.1742@supplier.ru>',
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
  // Формат: minmax-<mailbox>-<UID>-<имя файла>-<размер>-<sha256-16>
  // (имя файла само может содержать '-', поэтому проверяем голову и хвост).
  const parts = result.json.idempotencyKey.split('-');
  assert.equal(parts[0], 'minmax');
  assert.equal(parts[1], 'INBOX');
  assert.equal(parts[2], '1742');
  assert.equal(parts.at(-2), String(XLSX_BYTES.length));
  assert.match(parts.at(-1), /^[0-9a-f]{16}$/);
  assert.ok(result.json.idempotencyKey.includes('minmax-july.xlsx'));
  assert.equal(result.json.attachmentName, 'minmax-july.xlsx');
  assert.equal(result.json.attachmentSize, XLSX_BYTES.length);
  assert.equal(result.json.messageUid, '1742');
  assert.ok(result.binary.attachment_0, 'binary передан дальше');

  // Ключ стабилен: то же письмо → тот же ключ (идемпотентность).
  const repeat = filterOutcome(letter());
  assert.equal(repeat.json.idempotencyKey, result.json.idempotencyKey);
});

test('1a. ключ не зависит от uidvalidity (нода его не возвращает)', () => {
  // Даже если поле uidvalidity каким-то образом появится в $json,
  // оно не должно влиять на ключ: реальный UIDVALIDITY недоступен,
  // и выдуманная константа в ключе недопустима.
  const withField = filterOutcome(letter({ uidvalidity: 38505 }));
  const withoutField = filterOutcome(letter());
  const otherValue = filterOutcome(letter({ uidvalidity: 99999 }));
  assert.equal(withField.json.idempotencyKey, withoutField.json.idempotencyKey);
  assert.equal(otherValue.json.idempotencyKey, withoutField.json.idempotencyKey);
  assert.ok(!withoutField.json.idempotencyKey.includes('38505'));
});

test('1b. усиление ключа sha256: тот же UID/имя/размер, другое содержимое → другой ключ', () => {
  const altered = Buffer.concat([XLSX_BYTES, Buffer.from([0x42])]);
  // Размер подгоняем, чтобы отличалось ТОЛЬКО содержимое.
  const sameSizeAltered = Buffer.concat([XLSX_BYTES.slice(0, -1), Buffer.from([0x42])]);
  assert.equal(sameSizeAltered.length, XLSX_BYTES.length);
  const result = filterOutcome(letter({}, {
    attachment_0: {
      fileName: 'minmax-july.xlsx',
      data: sameSizeAltered.toString('base64'),
      fileSize: sameSizeAltered.length,
    },
  }));
  const original = filterOutcome(letter());
  assert.equal(result.json.attachmentSize, original.json.attachmentSize);
  assert.notEqual(result.json.idempotencyKey, original.json.idempotencyKey);
  void altered;
});

test('1c. sha256 в ключе соответствует эталонному вектору', () => {
  // sha256('abc') = ba7816bf8f01cfea... — первые 16 hex попадают в ключ.
  const abc = Buffer.from('abc');
  const result = filterOutcome(letter({}, {
    attachment_0: { fileName: 'bad.xlsx', data: abc.toString('base64') },
  }));
  // 'abc' не проходит сигнатуру Excel → rejected, но ключ уже содержит хэш.
  assert.equal(result.json.outcome, 'rejected');
  assert.ok(result.json.idempotencyKey.endsWith('-3-ba7816bf8f01cfea'));
});

test('1d. UID берётся из attributes.uid, фолбэки: uid, messageId', () => {
  assert.equal(filterOutcome(letter()).json.messageUid, '1742');
  // attributes отсутствует → верхнеуровневый uid.
  const topLevel = filterOutcome(letter({ attributes: undefined, uid: 2077 }));
  assert.equal(topLevel.json.messageUid, '2077');
  assert.ok(topLevel.json.idempotencyKey.split('-')[2] === '2077');
  // Нет ни attributes, ни uid → messageId (санитизированный).
  const byMessageId = filterOutcome(letter({
    attributes: undefined,
    uid: undefined,
    messageId: '<abc.123@supplier.ru>',
  }));
  assert.equal(byMessageId.json.messageUid, '<abc.123@supplier.ru>');
  assert.equal(byMessageId.json.idempotencyKey.split('-')[2], 'abc.123_supplier.ru');
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

// Фикстура downstream-нод выводится из реального jsCode фильтра,
// чтобы ключ всегда соответствовал фактическому формату.
const FILTER_JSON = (() => {
  const filtered = filterOutcome(letter()).json;
  assert.equal(filtered.outcome, 'process');
  return {
    outcome: 'process',
    idempotencyKey: filtered.idempotencyKey,
    attachmentName: filtered.attachmentName,
    mailbox: filtered.mailbox,
    messageUid: filtered.messageUid,
  };
})();

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
  // Формат resolved обязателен: вложения всегда попадают в binary,
  // а UID письма — в $json.attributes.uid (в simple без downloadAttachments
  // вложения не скачиваются, и фильтр игнорировал бы все письма).
  assert.equal(imap.parameters.format, 'resolved');
  // UIDVALIDITY нода не возвращает: jsCode не должен читать его из $json
  // (упоминания в комментариях допустимы), ключ усилен sha256 вложения.
  const filterCode = jsCode('filter-letter');
  assert.ok(!filterCode.includes('$json.uidvalidity'), '$json.uidvalidity не используется');
  assert.ok(filterCode.includes('$json.attributes'));
  assert.ok(filterCode.includes('sha256hex'));

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

test('28. fixed-config workflow не обращается к env и использует production endpoints', () => {
  assert.equal(
    fixedWorkflow.name,
    'Arthur — MinMax Yandex Mail Intake (Fixed Config)'
  );
  assert.equal(fixedWorkflow.active, false);

  const serialized = JSON.stringify(fixedWorkflow);
  assert.ok(!serialized.includes('$env'));
  assert.ok(!serialized.includes('process.env'));
  for (const node of fixedWorkflow.nodes.filter(
    item => item.type === 'n8n-nodes-base.code'
  )) {
    assert.doesNotThrow(
      () => new vm.Script(`(function () {\n${node.parameters.jsCode}\n})()`),
      `Code-нода ${node.name} синтаксически корректна`
    );
  }

  const configNode = fixedWorkflow.nodes.find(
    node => node.id === 'minmax-fixed-config'
  );
  assert.ok(configNode, 'единая конфигурационная нода присутствует');
  const configCode = configNode.parameters.jsCode;
  assert.ok(configCode.includes("apiBaseUrl: 'http://host.docker.internal:3210'"));
  assert.ok(configCode.includes("ownerUiBaseUrl: 'http://<SERVER-IP>:3210'"));
  assert.ok(configCode.includes("mailbox: 'INBOX'"));
  assert.ok(configCode.includes("notifyTo: 'miskakhv@yandex.ru'"));
  assert.ok(configCode.includes('maxAttachmentBytes: 20971520'));
  assert.ok(configCode.includes('pollIntervalSeconds: 10'));
  assert.ok(configCode.includes('pollTimeoutSeconds: 600'));
  assert.ok(configCode.includes('binary: item.binary'));

  const imap = fixedWorkflow.nodes.find(
    node => node.type === 'n8n-nodes-base.emailReadImap'
  );
  assert.equal(imap.parameters.mailbox, 'INBOX');
  assert.equal(imap.parameters.format, 'resolved');

  const upload = fixedWorkflow.nodes.find(node => node.id === 'upload-excel');
  assert.ok(upload.parameters.url.includes("+ '/api/v1/runs'"));
  assert.ok(upload.parameters.url.includes("$('Конфигурация MinMax')"));
  assert.equal(
    serialized.match(/http:\/\/host\.docker\.internal:3210/g)?.length,
    1,
    'production API URL задан только в конфигурационной ноде'
  );

  const httpNodes = fixedWorkflow.nodes.filter(
    node => node.credentials?.httpHeaderAuth
  );
  assert.ok(httpNodes.length > 0);
  for (const node of httpNodes) {
    assert.equal(node.credentials.httpHeaderAuth.id, 'REPLACE_IN_N8N');
    assert.equal(node.credentials.httpHeaderAuth.name, 'Arthur Core API');
  }
});

test('29. fixed-config workflow пропускает письмо без env и сохраняет фильтры опциональными', () => {
  const config = {
    apiBaseUrl: 'http://host.docker.internal:3210',
    ownerUiBaseUrl: 'http://<SERVER-IP>:3210',
    allowedSender: '',
    subjectPattern: '',
    mailbox: 'INBOX',
    notifyTo: 'miskakhv@yandex.ru',
    notifyFrom: 'miskakhv@yandex.ru',
    maxAttachmentBytes: 20971520,
    pollIntervalSeconds: 10,
    pollTimeoutSeconds: 600,
  };
  const input = letter({ config });
  input.env = new Proxy({}, {
    get() {
      throw new Error('access to env vars denied');
    },
  });

  const [result] = runCodeNode(fixedJsCode('filter-letter'), input);
  assert.equal(result.json.outcome, 'process');
  assert.equal(result.json.mailbox, 'INBOX');
  assert.ok(result.binary.attachment_0);
});

test('30. fixed-config connections начинаются с IMAP → конфигурация → фильтр', () => {
  assert.equal(
    fixedWorkflow.connections['IMAP — отчёт Min/Max'].main[0][0].node,
    'Конфигурация MinMax'
  );
  assert.equal(
    fixedWorkflow.connections['Конфигурация MinMax'].main[0][0].node,
    'Отфильтровать письмо'
  );

  const names = new Set(fixedWorkflow.nodes.map(node => node.name));
  for (const [from, connection] of Object.entries(fixedWorkflow.connections)) {
    assert.ok(names.has(from), `fixed connection source ${from}`);
    for (const outputs of connection.main) {
      for (const edge of outputs) {
        assert.ok(names.has(edge.node), `fixed connection target ${edge.node}`);
      }
    }
  }
});
