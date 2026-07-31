'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { once } = require('node:events');

const { strFromU8, unzipSync } = require('fflate');

const {
  runPurchasingWebOrchestrator,
} = require('../application/purchasing_run_orchestrator');
const {
  FileRunRegistry,
} = require('../storage/file_run_registry');
const {
  DEFAULT_SERVER_PATHS,
} = require('../config');
const {
  SUPPLIER_ORDER_BLOCKED_MESSAGE,
} = require('../../../agents/purchasing/services/supplier_order');
const {
  createPurchasingWebServer,
} = require('../server');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const RUN_ID = '55555555-5555-4555-8555-555555555555';
const PENDING_RUN_ID = '66666666-6666-4666-8666-666666666666';
const GENERATED_AT = '2026-07-31T12:00:00.000Z';
const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let temporaryRoot;
let server;
let baseUrl;

async function jsonResponse(url, options) {
  const response = await fetch(url, options);
  return {
    response,
    body: await response.json(),
  };
}

function putDecision(runId, rowId, decision, quantity) {
  return jsonResponse(
    `${baseUrl}/api/v1/runs/${runId}/items/` +
    `${encodeURIComponent(rowId)}/decision`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, quantity }),
    }
  );
}

before(async () => {
  temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'purchasing-supplier-order-')
  );
  const runsRoot = path.join(temporaryRoot, 'runs');
  const registry = new FileRunRegistry({ runsRoot });

  const bundle = await runPurchasingWebOrchestrator({
    runId: RUN_ID,
    inputPath: path.join(
      REPOSITORY_ROOT,
      'tests/fixtures/SmartZapas_synthetic.xlsx'
    ),
    generatedAt: GENERATED_AT,
    financialDataPath: path.join(
      REPOSITORY_ROOT,
      'data/purchasing/miska-financial-current.json'
    ),
    configPath: path.join(
      REPOSITORY_ROOT,
      'data/purchasing/miska-matrix-builder-config.json'
    ),
    matrixPath: path.join(
      REPOSITORY_ROOT,
      'data/purchasing/miska-assortment-matrix.json'
    ),
    ownerDecisionsPath: path.join(
      temporaryRoot,
      'orchestrator-owner-decisions.json'
    ),
    recommendationConfigPath: path.join(
      REPOSITORY_ROOT,
      'data/purchasing/miska-recommendation-explainer-config.json'
    ),
  });
  registry.createProcessingRun({
    runId: RUN_ID,
    createdAt: GENERATED_AT,
    startedAt: GENERATED_AT,
    source: { original_name: 'fixture.xlsx' },
  });
  registry.saveCompletedRun(bundle, { completedAt: GENERATED_AT });
  registry.createProcessingRun({
    runId: PENDING_RUN_ID,
    createdAt: GENERATED_AT,
    startedAt: GENERATED_AT,
    source: { original_name: 'fixture.xlsx' },
  });

  server = createPurchasingWebServer({
    registry,
    runsRoot,
    uploadRoot: path.join(temporaryRoot, 'uploads'),
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
    now: () => GENERATED_AT,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('метаданные заказа недоступны, пока ручная проверка не завершена', async () => {
  const { response, body } = await jsonResponse(
    `${baseUrl}/api/v1/runs/${RUN_ID}/supplier-order`
  );
  assert.equal(response.status, 200);
  assert.equal(body.data.available, false);
  assert.equal(body.data.blockedReason, SUPPLIER_ORDER_BLOCKED_MESSAGE);
  assert.equal(body.data.downloadUrl, null);
  assert.equal(body.data.itemCount, 0);
});

test('скачивание блокируется с сообщением из ТЗ при незавершённой проверке',
  async () => {
    const { response, body } = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/supplier-order/download`
    );
    assert.equal(response.status, 409);
    assert.equal(body.error.code, 'OWNER_REVIEW_INCOMPLETE');
    assert.equal(body.error.message, SUPPLIER_ORDER_BLOCKED_MESSAGE);
  });

test('после всех решений заказ формируется и скачивается валидный .xlsx',
  async () => {
    const itemsResult = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
    );
    assert.equal(itemsResult.response.status, 200);
    const items = itemsResult.body.data.items;
    assert.ok(items.length > 0);

    const buyPlan = new Map();
    const reviewItems = items.filter(
      item => item.matrix?.owner_review_required === true
    );
    assert.ok(reviewItems.length >= 2);
    for (const [index, reviewItem] of reviewItems.entries()) {
      if (index < 2) buyPlan.set(reviewItem.row_id, index + 2);
      const decision = index < 2 ? 'BUY' : 'SKIP';
      const quantity = index < 2 ? index + 2 : 0;
      const decided = await putDecision(
        RUN_ID,
        reviewItem.row_id,
        decision,
        quantity
      );
      assert.equal(decided.response.status, 200);
    }

    const metadata = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/supplier-order`
    );
    assert.equal(metadata.response.status, 200);
    const order = metadata.body.data;
    assert.equal(order.available, true);
    assert.equal(order.blockedReason, null);
    assert.equal(order.mimeType, XLSX_CONTENT_TYPE);
    assert.equal(
      order.downloadUrl,
      `/api/v1/runs/${RUN_ID}/supplier-order/download`
    );
    assert.match(
      order.filename,
      /^Заказ_поставщику_.+_\d{2}\.\d{2}\.\d{4}\.xlsx$/
    );
    assert.ok(order.filename.endsWith('_31.07.2026.xlsx'));
    assert.equal(order.itemCount, buyPlan.size);

    const expectedTotal = Math.round(
      items
        .filter(item => buyPlan.has(item.row_id))
        .reduce((sum, orderItem) =>
          sum + buyPlan.get(orderItem.row_id) *
            orderItem.amounts.unit_price, 0) * 100
    ) / 100;
    assert.equal(order.totalAmount, expectedTotal);

    const download = await fetch(
      `${baseUrl}${order.downloadUrl}`
    );
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), XLSX_CONTENT_TYPE);
    const disposition = download.headers.get('content-disposition');
    assert.ok(disposition.includes('attachment'));
    assert.ok(
      disposition.includes(
        `filename*=UTF-8''${encodeURIComponent(order.filename)}`
      )
    );
    const content = Buffer.from(await download.arrayBuffer());
    assert.ok(content.subarray(0, 2).equals(Buffer.from('PK')));

    const files = unzipSync(content);
    const workbook = strFromU8(files['xl/workbook.xml']);
    assert.ok(workbook.includes('name="Заказ поставщику"'));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    for (const header of [
      'Артикул',
      'Наименование',
      'Количество',
      'Закупочная цена, ₽',
      'Сумма, ₽',
      'ИТОГО',
    ]) {
      assert.ok(sheet.includes(`>${header}<`), `нет ${header}`);
    }
    const dataRowCount = (sheet.match(/<row r="/g) || []).length - 2;
    assert.equal(dataRowCount, order.itemCount);
    assert.ok(
      sheet.includes(`<v>${order.totalAmount}</v>`),
      'ИТОГО в файле не совпадает с суммой в интерфейсе'
    );
    for (const bought of items.filter(item => buyPlan.has(item.row_id))) {
      assert.ok(
        sheet.includes(`>${bought.sku}<`),
        `утверждённая позиция ${bought.sku} не попала в файл`
      );
    }
  });

test('повторное решение владельца обновляет заказ', async () => {
  const itemsResult = await jsonResponse(
    `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
  );
  const items = itemsResult.body.data.items;
  const target = items.find(item =>
    item.owner_decision?.decision === 'BUY'
  );
  assert.ok(target);
  const skipped = await putDecision(RUN_ID, target.row_id, 'SKIP', 0);
  assert.equal(skipped.response.status, 200);

  const metadata = await jsonResponse(
    `${baseUrl}/api/v1/runs/${RUN_ID}/supplier-order`
  );
  assert.equal(metadata.body.data.available, true);
  assert.equal(metadata.body.data.itemCount, 1);
  const download = await fetch(
    `${baseUrl}${metadata.body.data.downloadUrl}`
  );
  const sheet = strFromU8(
    unzipSync(Buffer.from(await download.arrayBuffer()))[
      'xl/worksheets/sheet1.xml'
    ]
  );
  const dataRowCount = (sheet.match(/<row r="/g) || []).length - 2;
  assert.equal(
    dataRowCount,
    1,
    'исключённая позиция осталась в файле'
  );
});

test('незавершённый run и неизвестный run возвращают безопасные ошибки',
  async () => {
    const pending = await jsonResponse(
      `${baseUrl}/api/v1/runs/${PENDING_RUN_ID}/supplier-order`
    );
    assert.equal(pending.response.status, 409);
    assert.equal(pending.body.error.code, 'RUN_NOT_READY');

    const missing = await jsonResponse(
      `${baseUrl}/api/v1/runs/` +
      '77777777-7777-4777-8777-777777777777/supplier-order/download'
    );
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error.code, 'RUN_NOT_FOUND');
  });

test('существующие отчёты продолжают скачиваться', async () => {
  for (const name of [
    'report.txt',
    'owner-review-report.md',
    'recommendation-explanations-report.md',
    'owner-learning-report.md',
    'result.json',
  ]) {
    const response = await fetch(
      `${baseUrl}/api/v1/runs/${RUN_ID}/artifacts/${name}`
    );
    assert.equal(response.status, 200, `artifact ${name} недоступен`);
    assert.ok(
      Number(response.headers.get('content-length')) > 0,
      `artifact ${name} пуст`
    );
  }
});
