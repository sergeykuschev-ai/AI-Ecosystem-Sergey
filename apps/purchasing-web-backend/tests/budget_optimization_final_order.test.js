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
  createPurchasingWebServer,
} = require('../server');
const {
  budgetOptimizationFile,
  budgetOptimizationView,
} = require('../public/app');
const csvExporter = require('../../../shared/reporting/csv_exporter');
const xlsxExporter = require('../../../shared/reporting/xlsx_exporter');
const {
  optimizePurchasingBudget,
} = require('../../../agents/purchasing/budget_optimizer/budget_optimizer');
const {
  buildFinalOrderState,
} = require('../../../agents/purchasing/services/final_order');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const RUN_ID = '34343434-3434-4344-8434-343434343434';
const GENERATED_AT = '2026-07-31T12:00:00.000Z';

let temporaryRoot;
let registry;
let decisionsPath;
let server;
let baseUrl;
let snapshotSummary;

async function jsonResponse(url, options) {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
}

function putDecision(rowId, decision, quantity, base = baseUrl) {
  return jsonResponse(
    `${base}/api/v1/runs/${RUN_ID}/items/` +
    `${encodeURIComponent(rowId)}/decision`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision,
        quantity,
        reasonCode: 'MANUAL_EXPERIENCE',
      }),
    }
  );
}

function finalOrder(base = baseUrl) {
  return jsonResponse(`${base}/api/v1/runs/${RUN_ID}/final-order`);
}

function optimize(targetBudget, base = baseUrl) {
  return jsonResponse(
    `${base}/api/v1/runs/${RUN_ID}/budget-optimization`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetBudget }),
    }
  );
}

function excelTotal(sheet) {
  const totalRow = sheet.split('ИТОГО')[1];
  const match = totalRow?.match(/<v>([\d.]+)<\/v>/);
  return match ? Number(match[1]) : null;
}

function excelDataRows(sheet) {
  return (sheet.match(/<row r="/g) || []).length - 2;
}

before(async () => {
  temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'purchasing-budget-final-')
  );
  const runsRoot = path.join(temporaryRoot, 'runs');
  registry = new FileRunRegistry({ runsRoot });
  decisionsPath = path.join(temporaryRoot, 'owner-decisions.json');

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

  server = createPurchasingWebServer({
    registry,
    runsRoot,
    uploadRoot: path.join(temporaryRoot, 'uploads'),
    serverPaths: {
      ...DEFAULT_SERVER_PATHS,
      ownerDecisionsPath: decisionsPath,
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

  const summary = await jsonResponse(
    `${baseUrl}/api/v1/runs/${RUN_ID}/summary`
  );
  snapshotSummary = summary.body.data;
});

after(() => {
  server?.close();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('незавершённая проверка блокирует оптимизацию (409)', async () => {
  const result = await optimize(100);
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error.code, 'OWNER_REVIEW_INCOMPLETE');
  assert.ok(result.body.error.message.includes('Завершите ручную проверку'));
});

test('инвариант до завершения проверки: счётчик, флаг, оптимизация и экспорт согласованы',
  async () => {
    const listed = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
    );
    const summary = listed.body.data.owner_decisions;
    const state = (await finalOrder()).body.data;
    assert.ok(summary.needs_decision > 0);
    assert.equal(state.reviewComplete, false);
    // Единый источник истины: unresolvedCount ≡ needs_decision.
    assert.equal(state.unresolvedCount, summary.needs_decision);
    const blocked = await optimize(100);
    assert.equal(blocked.response.status, 409);
    const supplierOrder = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/supplier-order`
    );
    assert.equal(supplierOrder.response.status, 200);
    assert.equal(supplierOrder.body.data.available, false);
    assert.ok(
      supplierOrder.body.data.blockedReason.includes('ручную проверку')
    );
    // RunSummaryDTO доступен и не несёт собственного флага проверки —
    // состояние проверки живёт только в owner_decisions + /final-order.
    const runSummary = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/summary`
    );
    assert.equal(runSummary.response.status, 200);
  }
);

test('после Owner Review оптимизация работает от итогового заказа',
  async () => {
    const itemsResult = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
    );
    const reviewItems = itemsResult.body.data.items.filter(
      item => item.matrix?.owner_review_required === true
    );
    for (const [index, reviewItem] of reviewItems.entries()) {
      const decision = index < 2 ? 'BUY' : index === 2 ? 'DEFER' : 'SKIP';
      const quantity = decision === 'BUY' ? index + 2 : 0;
      const decided = await putDecision(reviewItem.row_id, decision, quantity);
      assert.equal(decided.response.status, 200);
    }

    const state = (await finalOrder()).body.data;
    assert.equal(state.reviewComplete, true);

    const above = await optimize(state.totalAmount + 1000);
    assert.equal(above.response.status, 200);
    assert.equal(above.body.data.status, 'UNCHANGED');
    assert.equal(above.body.data.originalTotal, state.totalAmount);
    assert.notEqual(
      above.body.data.originalTotal,
      snapshotSummary.amounts.analyzer_order_sum,
      'источником обязан быть итоговый заказ, а не снимок анализатора'
    );
  });

test('оптимизация сокращает обычный заказ без OWNER BUY', () => {
  // Детерминированная фикстура: только auto-позиции, OWNER BUY отсутствует.
  function autoItem(rowId, sku, quantity, price) {
    return {
      rowId,
      sku,
      name: `Товар ${sku}`,
      supplier: 'Поставщик',
      quantity,
      price,
      source: 'auto',
    };
  }

  const result = optimizePurchasingBudget({
    finalOrder: {
      reviewComplete: true,
      includedItems: [
        autoItem('a1', 'A-1', 10, 100),
        autoItem('a2', 'A-2', 5, 50),
        autoItem('a3', 'A-3', 2, 10),
      ],
    },
    targetBudget: 1200,
  });

  assert.equal(result.status, 'OPTIMIZED');
  assert.equal(result.originalTotal, 1270);
  assert.ok(result.optimizedTotal <= 1200);
  assert.ok(
    result.reducedItemsCount >= 1 || result.removedItemsCount >= 1,
    'хотя бы одна обычная позиция должна быть сокращена или удалена'
  );

  const linesSum = Math.round(
    result.items.reduce((sum, item) => sum + item.optimizedAmount, 0) * 100
  );
  assert.equal(linesSum, Math.round(result.optimizedTotal * 100));

  for (const item of result.items) {
    assert.ok(
      !item.protectedReasons.includes('OWNER_BUY'),
      'обычные позиции не должны получать защиту OWNER BUY'
    );
  }
});

test('UI, API, optimized-order.json, CSV и Excel показывают одну сумму',
  async () => {
    const state = (await finalOrder()).body.data;
    // Используем бюджет выше итога, чтобы проверить отображение
    // UNCHANGED-результата независимо от возможного BUDGET_TOO_LOW.
    const budget = Math.round((state.totalAmount + 1000) * 100) / 100;
    const result = (await optimize(budget)).body.data;

    const view = budgetOptimizationView(result);
    assert.ok(view);
    assert.ok(view.originalTotal.replace(/[^\d,]/g, '').length > 0);
    assert.equal(
      view.optimizedTotal.replace(/[^\d,]/g, ''),
      result.optimizedTotal.toFixed(2).replace('.', ',')
    );

    const jsonFile = budgetOptimizationFile(result);
    assert.equal(jsonFile.name, 'optimized-order.json');
    assert.deepEqual(JSON.parse(jsonFile.content), result);

    const csvFiles = csvExporter.createOptimizedCsvFiles(result);
    const expectedTotal = csvExporter.formatCsvMoney(
      result.optimizedTotal,
      'optimizedTotal'
    );
    assert.ok(csvFiles.supplierOrder.content.includes('ИТОГО'));
    assert.ok(csvFiles.supplierOrder.content.includes(expectedTotal));
    for (const item of result.items) {
      assert.ok(csvFiles.supplierOrder.content.includes(item.sku));
    }
    const csvDataLines = csvFiles.supplierOrder.content
      .split('\r\n')
      .filter(line => line.length > 0).length - 2;
    assert.equal(csvDataLines, result.items.length);

    const xlsxFiles = xlsxExporter.createOptimizedXlsxFiles(result);
    const sheet = strFromU8(
      unzipSync(xlsxFiles.supplierOrder.content)[
        'xl/worksheets/sheet1.xml'
      ]
    );
    assert.equal(excelTotal(sheet), result.optimizedTotal);
    assert.equal(excelDataRows(sheet), result.items.length);
    for (const removed of result.removedItems) {
      assert.ok(
        !sheet.includes(`>${removed.sku}<`),
        'оптимизированный Excel не содержит исключённых позиций'
      );
    }
  });

test('повторная оптимизация детерминирована и не накапливает ошибки',
  async () => {
    const state = (await finalOrder()).body.data;
    const budgets = [
      state.totalAmount + 500,
      Math.round((state.totalAmount - 10) * 100) / 100,
      Math.round((state.totalAmount - 30) * 100) / 100,
      Math.round((state.totalAmount - 10) * 100) / 100,
    ];
    const runs = [];
    for (const budget of budgets) {
      const result = await optimize(budget);
      assert.equal(result.response.status, 200);
      runs.push(result.body.data);
    }
    assert.deepEqual(runs[1], runs[3], 'одинаковый бюджет — одинаковый результат');
    assert.ok(runs[2].optimizedTotal <= runs[1].optimizedTotal);
    assert.equal(runs[0].status, 'UNCHANGED');
    assert.equal(runs[0].originalTotal, state.totalAmount);
  });

test('изменение количества сразу меняет основу оптимизации', async () => {
  const itemsResult = await jsonResponse(
    `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
  );
  const target = itemsResult.body.data.items.find(
    item => item.owner_decision?.decision === 'BUY'
  );
  assert.ok(target);

  const before = (await finalOrder()).body.data;
  const decided = await putDecision(target.row_id, 'BUY', 7);
  assert.equal(decided.response.status, 200);
  const after = (await finalOrder()).body.data;
  assert.notEqual(after.totalAmount, before.totalAmount);

  const result = await optimize(after.totalAmount + 1000);
  assert.equal(result.body.data.originalTotal, after.totalAmount);
});

test('SKIP после оптимизации исключает позицию из основы', async () => {
  const itemsResult = await jsonResponse(
    `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
  );
  const buys = itemsResult.body.data.items.filter(
    item => item.owner_decision?.decision === 'BUY'
  );
  assert.ok(buys.length >= 2);
  const target = buys[0];

  const before = (await finalOrder()).body.data;
  const decided = await putDecision(target.row_id, 'SKIP', 0);
  assert.equal(decided.response.status, 200);

  const after = (await finalOrder()).body.data;
  assert.ok(after.totalAmount < before.totalAmount);

  const result = await optimize(after.totalAmount + 1000);
  const data = result.body.data;
  assert.equal(data.originalTotal, after.totalAmount);
  assert.ok(
    !data.items.some(item => item.rowIdentity === target.row_id) ||
    after.includedItems.some(entry => entry.rowId === target.row_id),
    'SKIP-позиция не должна попадать в оптимизацию'
  );
});

test('OWNER BUY не сокращается при нехватке бюджета и возвращает предупреждение',
  async () => {
    const itemsResult = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
    );
    const target = itemsResult.body.data.items.find(
      item => item.matrix?.owner_review_required === true
    );
    assert.ok(target, 'должна быть позиция, требующая решения владельца');

    const decided = await putDecision(target.row_id, 'BUY', 5);
    assert.equal(decided.response.status, 200);

    const before = (await finalOrder()).body.data;
    assert.equal(before.reviewComplete, true);

    const result = await optimize(1);
    assert.equal(result.response.status, 200);
    const data = result.body.data;
    assert.equal(data.status, 'BUDGET_TOO_LOW');
    assert.ok(
      data.warnings.includes('OWNER_BUY_PROTECTED_FROM_BUDGET_CUT'),
      'должно быть явное предупреждение о защите OWNER BUY'
    );

    const buyLine = data.items.find(
      item => item.rowIdentity === target.row_id
    );
    assert.ok(buyLine, 'OWNER BUY должен остаться в оптимизированном заказе');
    assert.equal(buyLine.originalQuantity, 5);
    assert.equal(buyLine.optimizedQuantity, 5);
    assert.deepEqual(buyLine.protectedReasons, ['OWNER_BUY']);

  }
);

test('инвариант после завершения проверки: needs 0 ⇔ complete ⇔ оптимизация и экспорт разрешены',
  async () => {
    const listed = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
    );
    const summary = listed.body.data.owner_decisions;
    const state = (await finalOrder()).body.data;
    assert.equal(summary.needs_decision, 0);
    assert.equal(state.reviewComplete, true);
    assert.equal(state.unresolvedCount, 0);
    assert.equal(
      summary.needs_decision === 0,
      state.reviewComplete,
      'один источник истины: счётчик и флаг всегда согласованы'
    );
    const optimized = await optimize(state.totalAmount + 1000);
    assert.equal(optimized.response.status, 200);
    assert.equal(optimized.body.data.originalTotal, state.totalAmount);
    const supplierOrder = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/supplier-order`
    );
    assert.equal(supplierOrder.response.status, 200);
    assert.equal(supplierOrder.body.data.available, true);
    assert.equal(supplierOrder.body.data.blockedReason, null);
    const runSummary = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/summary`
    );
    assert.equal(runSummary.response.status, 200);
  }
);

test('OWNER BUY не сокращается при нехватке бюджета и возвращает BUDGET_CONFLICT',
  () => {
    const item = {
      row_id: 'owner-buy-1',
      sku: 'OWNER-BUY-1',
      name: 'Owner buy item',
      amounts: { unit_price: 5 },
      owner_decision: { decision: 'BUY', quantity: 10 },
    };
    const finalOrder = buildFinalOrderState({
      items: [item],
    });
    assert.equal(finalOrder.includedItems[0].protected, true);
    assert.deepEqual(
      finalOrder.includedItems[0].protectedReasons,
      ['OWNER_BUY']
    );

    const result = optimizePurchasingBudget({
      finalOrder,
      targetBudget: 1,
    });

    assert.equal(result.status, 'BUDGET_TOO_LOW');
    assert.ok(
      result.warnings.includes('BUDGET_CONFLICT_PROTECTED_ITEMS'),
      'должно быть предупреждение BUDGET_CONFLICT'
    );
    const line = result.items.find(
      item => item.rowIdentity === 'owner-buy-1'
    );
    assert.ok(line, 'OWNER BUY должен остаться в результате');
    assert.equal(line.originalQuantity, 10);
    assert.equal(line.optimizedQuantity, 10);
    assert.deepEqual(line.protectedReasons, ['OWNER_BUY']);
  }
);

test('обязательный ассортимент не сокращается при нехватке бюджета и возвращает BUDGET_CONFLICT',
  () => {
    const item = {
      row_id: 'mandatory-1',
      sku: 'MANDATORY-1',
      name: 'Mandatory item',
      amounts: { unit_price: 5 },
      workflow_status: 'auto_approved',
      quantities: { approved_quantity: 10 },
      matrix: { owner_review_required: false },
      assortment_policy: { mandatory_assortment: true },
    };
    const finalOrder = buildFinalOrderState({
      items: [item],
    });
    assert.equal(finalOrder.includedItems[0].protected, true);
    assert.ok(
      finalOrder.includedItems[0].protectedReasons
        .includes('MANDATORY_ASSORTMENT')
    );

    const result = optimizePurchasingBudget({
      finalOrder,
      targetBudget: 1,
    });

    assert.equal(result.status, 'BUDGET_TOO_LOW');
    assert.ok(
      result.warnings.includes('BUDGET_CONFLICT_PROTECTED_ITEMS'),
      'должно быть предупреждение BUDGET_CONFLICT'
    );
    const line = result.items.find(
      item => item.rowIdentity === 'mandatory-1'
    );
    assert.ok(line, 'обязательная позиция должна остаться в результате');
    assert.equal(line.originalQuantity, 10);
    assert.equal(line.optimizedQuantity, 10);
    assert.ok(line.protectedReasons.includes('MANDATORY_ASSORTMENT'));
  }
);

test('результат оптимизации помечен как BUDGET_SIMULATION', () => {
  const result = optimizePurchasingBudget({
    finalOrder: {
      reviewComplete: true,
      includedItems: [{
        rowId: 'sim-1',
        sku: 'SIM-1',
        name: 'Item',
        quantity: 5,
        price: 10,
        source: 'auto',
      }],
    },
    targetBudget: 1000,
  });
  assert.equal(result.resultType, 'BUDGET_SIMULATION');
});

function supplierSheetRows(sheet) {
  const rows = [];
  const rowRegex = /<row r="(\d+)">(.*?)<\/row>/g;
  let match;
  while ((match = rowRegex.exec(sheet)) !== null) {
    const rowNumber = match[1];
    const rowContent = match[2];
    const skuMatch = rowContent.match(
      /<c r="A\d+"[^>]*>.*?<is><t[^>]*>([^<]*)<\/t><\/is><\/c>/
    );
    if (!skuMatch) continue;
    const quantityMatch = rowContent.match(
      new RegExp(`<c r="C${rowNumber}"[^>]*><v>(\\d+)</v></c>`)
    );
    if (quantityMatch) {
      rows.push({ sku: skuMatch[1], quantity: Number(quantityMatch[1]) });
    }
  }
  return rows;
}

test('Supplier XLSX содержит те же количества, что и канонический финальный заказ',
  async () => {
    const itemsResult = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
    );
    const state = buildFinalOrderState({
      items: itemsResult.body.data.items,
    });
    assert.equal(state.reviewComplete, true);
    assert.ok(state.includedItems.length > 0);

    const metadata = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/supplier-order`
    );
    assert.equal(metadata.response.status, 200);
    assert.equal(metadata.body.data.available, true);
    assert.equal(metadata.body.data.itemCount, state.itemCount);
    assert.equal(metadata.body.data.totalAmount, state.totalAmount);

    const download = await fetch(
      `${baseUrl}${metadata.body.data.downloadUrl}`
    );
    assert.equal(download.status, 200);
    const sheet = strFromU8(
      unzipSync(Buffer.from(await download.arrayBuffer()))[
        'xl/worksheets/sheet1.xml'
      ]
    );

    const rows = supplierSheetRows(sheet);
    assert.equal(rows.length, state.includedItems.length);
    for (let index = 0; index < state.includedItems.length; index += 1) {
      const expected = state.includedItems[index];
      const actual = rows[index];
      assert.equal(
        actual.sku,
        expected.sku,
        `SKU в строке ${index} не совпадает`
      );
      assert.equal(
        actual.quantity,
        expected.quantity,
        `количество для ${expected.sku} в XLSX не совпадает с финальным заказом`
      );
    }
  }
);
