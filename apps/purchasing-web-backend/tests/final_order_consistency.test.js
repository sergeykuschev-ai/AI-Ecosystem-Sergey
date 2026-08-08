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
  finalOrderView,
} = require('../public/app');
const {
  applyPackagingRules,
  buildFinalOrderState,
  classifyItem,
} = require('../../../agents/purchasing/services/final_order');
const {
  finalQuantityWithOwnerDecision,
  withFinalQuantity,
} = require('../application/owner_decision_service');
const {
  mapPurchasingItems,
} = require('../dto/purchasing_item_mapper');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const RUN_ID = '12121212-1212-4212-8212-121212121212';
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

function supplierOrder(base = baseUrl) {
  return jsonResponse(`${base}/api/v1/runs/${RUN_ID}/supplier-order`);
}

async function downloadSheet(downloadUrl) {
  const response = await fetch(`${baseUrl}${downloadUrl}`);
  assert.equal(response.status, 200);
  const content = Buffer.from(await response.arrayBuffer());
  const sheet = strFromU8(
    unzipSync(content)['xl/worksheets/sheet1.xml']
  );
  return { content, sheet };
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
    path.join(os.tmpdir(), 'purchasing-final-order-')
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

test('snapshot summary сохраняет исходную рекомендацию агента', async () => {
  assert.ok(snapshotSummary.amounts.analyzer_order_sum > 0);
  assert.ok(snapshotSummary.sku_count > 0);
  const state = await finalOrder();
  assert.equal(
    state.body.data.initialRecommendation.totalAmount,
    snapshotSummary.amounts.analyzer_order_sum
  );
  assert.equal(
    state.body.data.initialRecommendation.itemCount,
    snapshotSummary.sku_count
  );
});

test('до решений финальный заказ показывает нерешённые позиции', async () => {
  const state = await finalOrder();
  assert.equal(state.body.data.status, 'review_incomplete');
  assert.equal(state.body.data.reviewComplete, false);
  assert.ok(state.body.data.unresolvedCount > 0);
  const order = await supplierOrder();
  assert.equal(order.body.data.available, false);
});

test('после всех решений UI, API и Excel показывают одну сумму и число SKU',
  async () => {
    const itemsResult = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
    );
    const items = itemsResult.body.data.items;
    const reviewItems = items.filter(
      item => item.matrix?.owner_review_required === true
    );
    assert.ok(reviewItems.length >= 3);

    const buyQuantities = new Map();
    for (const [index, reviewItem] of reviewItems.entries()) {
      if (index < 2) {
        const quantity = index + 2;
        buyQuantities.set(reviewItem.row_id, quantity);
        const decided = await putDecision(
          reviewItem.row_id, 'BUY', quantity
        );
        assert.equal(decided.response.status, 200);
      } else if (index === 2) {
        const decided = await putDecision(
          reviewItem.row_id, 'DEFER', null
        );
        assert.equal(decided.response.status, 200);
      } else {
        const decided = await putDecision(
          reviewItem.row_id, 'SKIP', 0
        );
        assert.equal(decided.response.status, 200);
      }
    }

    const expectedTotal = Math.round(
      items
        .filter(item => buyQuantities.has(item.row_id))
        .reduce((sum, entry) =>
          sum + buyQuantities.get(entry.row_id) *
            entry.amounts.unit_price, 0) * 100
    ) / 100;

    const state = (await finalOrder()).body.data;
    assert.equal(state.reviewComplete, true);
    assert.equal(state.unresolvedCount, 0);
    assert.equal(state.status, 'ready');
    assert.equal(state.itemCount, buyQuantities.size);
    assert.equal(state.totalAmount, expectedTotal);
    assert.equal(state.manuallyApprovedAmount, expectedTotal);
    assert.ok(state.deferredAmount >= 0);

    const metadata = (await supplierOrder()).body.data;
    assert.equal(metadata.available, true);
    assert.equal(metadata.totalAmount, state.totalAmount);
    assert.equal(metadata.itemCount, state.itemCount);

    const { sheet } = await downloadSheet(metadata.downloadUrl);
    assert.equal(excelDataRows(sheet), state.itemCount);
    assert.equal(excelTotal(sheet), state.totalAmount);

    const view = finalOrderView(state);
    assert.ok(view, 'UI view не принял каноническое состояние');
    assert.ok(view.totalAmount.replace(/\s| /g, '')
      .startsWith(String(state.totalAmount.toFixed(2))
        .replace('.', ',').replace(/\s| /g, '')));
    assert.equal(view.itemCount, String(state.itemCount));
    assert.equal(view.runStatus, 'Проверка завершена');
    assert.equal(view.pendingReviewSum.replace(/[^\d,]/g, ''), '0,00');
    assert.ok(
      view.initialRecommendation.includes(
        'Исходная рекомендация агента:'
      )
    );
  });

test('изменение решения сразу меняет API и Excel, кэша нет', async () => {
  const itemsResult = await jsonResponse(
    `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
  );
  const target = itemsResult.body.data.items.find(
    item => item.owner_decision?.decision === 'BUY'
  );
  assert.ok(target);

  const before = (await finalOrder()).body.data;
  const metadataBefore = (await supplierOrder()).body.data;
  const firstDownload = await downloadSheet(metadataBefore.downloadUrl);

  const skipped = await putDecision(target.row_id, 'SKIP', 0);
  assert.equal(skipped.response.status, 200);

  const after = (await finalOrder()).body.data;
  assert.ok(after.totalAmount < before.totalAmount);
  assert.equal(after.itemCount, before.itemCount - 1);
  assert.equal(after.unresolvedCount, 0);

  const metadataAfter = (await supplierOrder()).body.data;
  assert.equal(metadataAfter.totalAmount, after.totalAmount);
  assert.equal(
    metadataAfter.downloadUrl,
    metadataBefore.downloadUrl,
    'URL скачивания стабилен'
  );
  const secondDownload = await downloadSheet(metadataAfter.downloadUrl);
  assert.equal(excelTotal(secondDownload.sheet), after.totalAmount);
  assert.ok(
    !firstDownload.content.equals(secondDownload.content),
    'старый URL отдал устаревший заказ'
  );
});

test('перезапуск backend сохраняет финальное состояние', async () => {
  const before = (await finalOrder()).body.data;

  const restarted = createPurchasingWebServer({
    registry,
    runsRoot: path.join(temporaryRoot, 'runs'),
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
  restarted.listen(0, '127.0.0.1');
  await once(restarted, 'listening');
  const restartedBase = `http://127.0.0.1:${restarted.address().port}`;
  try {
    const state = (await finalOrder(restartedBase)).body.data;
    assert.equal(state.totalAmount, before.totalAmount);
    assert.equal(state.itemCount, before.itemCount);
    assert.equal(state.reviewComplete, true);
    const metadata = (await supplierOrder(restartedBase)).body.data;
    assert.equal(metadata.totalAmount, before.totalAmount);
  } finally {
    restarted.close();
  }
});

test('чистая память решений не наследует чужие решения', async () => {
  const cleanServer = createPurchasingWebServer({
    registry,
    runsRoot: path.join(temporaryRoot, 'runs'),
    uploadRoot: path.join(temporaryRoot, 'uploads'),
    serverPaths: {
      ...DEFAULT_SERVER_PATHS,
      ownerDecisionsPath: path.join(
        temporaryRoot,
        'clean-owner-decisions.json'
      ),
      ownerDecisionHistoryPath: path.join(
        temporaryRoot,
        'clean-owner-decision-history.json'
      ),
      ownerLearningHistoryPath: path.join(
        temporaryRoot,
        'clean-owner-learning-history.json'
      ),
    },
    now: () => GENERATED_AT,
  });
  cleanServer.listen(0, '127.0.0.1');
  await once(cleanServer, 'listening');
  const cleanBase = `http://127.0.0.1:${cleanServer.address().port}`;
  try {
    const state = (await finalOrder(cleanBase)).body.data;
    assert.equal(state.reviewComplete, false);
    assert.ok(state.unresolvedCount > 0);
    const order = (await supplierOrder(cleanBase)).body.data;
    assert.equal(order.available, false);
  } finally {
    cleanServer.close();
  }
});

test('одно необработанное решение блокирует экспорт', async () => {
  const partialServer = createPurchasingWebServer({
    registry,
    runsRoot: path.join(temporaryRoot, 'runs'),
    uploadRoot: path.join(temporaryRoot, 'uploads'),
    serverPaths: {
      ...DEFAULT_SERVER_PATHS,
      ownerDecisionsPath: path.join(
        temporaryRoot,
        'partial-owner-decisions.json'
      ),
      ownerDecisionHistoryPath: path.join(
        temporaryRoot,
        'partial-owner-decision-history.json'
      ),
      ownerLearningHistoryPath: path.join(
        temporaryRoot,
        'partial-owner-learning-history.json'
      ),
    },
    now: () => GENERATED_AT,
  });
  partialServer.listen(0, '127.0.0.1');
  await once(partialServer, 'listening');
  const partialBase = `http://127.0.0.1:${partialServer.address().port}`;
  try {
    const itemsResult = await jsonResponse(
      `${partialBase}/api/v1/runs/${RUN_ID}/items?page_size=100`
    );
    const reviewItems = itemsResult.body.data.items.filter(
      item => item.matrix?.owner_review_required === true
    );
    for (const reviewItem of reviewItems.slice(1)) {
      const decided = await putDecision(
        reviewItem.row_id, 'SKIP', 0, partialBase
      );
      assert.equal(decided.response.status, 200);
    }
    const state = (await finalOrder(partialBase)).body.data;
    assert.equal(state.unresolvedCount, 1);
    assert.equal(state.reviewComplete, false);
    const download = await jsonResponse(
      `${partialBase}/api/v1/runs/${RUN_ID}/supplier-order/download`
    );
    assert.equal(download.response.status, 409);
    assert.equal(download.body.error.code, 'OWNER_REVIEW_INCOMPLETE');
  } finally {
    partialServer.close();
  }
});

test('финансовые суммы округляются одинаково во всех слоях', async () => {
  const state = (await finalOrder()).body.data;
  const metadata = (await supplierOrder()).body.data;
  const { sheet } = await downloadSheet(metadata.downloadUrl);
  const excel = excelTotal(sheet);
  assert.equal(
    Math.round(state.totalAmount * 100),
    Math.round(metadata.totalAmount * 100)
  );
  assert.equal(
    Math.round(metadata.totalAmount * 100),
    Math.round(excel * 100)
  );
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

test('e2e: от импорта до Supplier XLSX количества в финальных слоях совпадают',
  async () => {
    const itemsResult = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
    );
    const state = buildFinalOrderState({
      items: itemsResult.body.data.items,
    });
    assert.equal(state.reviewComplete, true);
    assert.ok(state.includedItems.length > 0);

    const metadata = (await supplierOrder()).body.data;
    assert.equal(metadata.available, true);
    assert.equal(metadata.itemCount, state.itemCount);
    assert.equal(metadata.totalAmount, state.totalAmount);

    const { sheet } = await downloadSheet(metadata.downloadUrl);
    assert.equal(excelDataRows(sheet), state.itemCount);
    assert.equal(excelTotal(sheet), state.totalAmount);

    const rows = supplierSheetRows(sheet);
    assert.equal(rows.length, state.includedItems.length);
    for (let index = 0; index < state.includedItems.length; index += 1) {
      const expected = state.includedItems[index];
      const actual = rows[index];
      assert.equal(actual.sku, expected.sku);
      assert.equal(
        actual.quantity,
        expected.quantity,
        `количество ${expected.sku} в Supplier XLSX должно совпадать с финальным заказом`
      );
    }

    const buyBySku = new Map();
    for (const item of itemsResult.body.data.items) {
      if (item.owner_decision?.decision === 'BUY') {
        buyBySku.set(item.sku, item.owner_decision.quantity);
      }
    }
    for (const row of rows) {
      if (buyBySku.has(row.sku)) {
        assert.equal(
          row.quantity,
          buyBySku.get(row.sku),
          `количество OWNER BUY ${row.sku} должно дойти до Supplier XLSX без изменений`
        );
      }
    }
  }
);
test(
  'e2e: per-item final_quantity совпадает в API, FinalOrderState и Supplier XLSX',
  async () => {
    const itemsResult = await jsonResponse(
      `${baseUrl}/api/v1/runs/${RUN_ID}/items?page_size=100`
    );
    const apiItems = itemsResult.body.data.items;
    const state = buildFinalOrderState({ items: apiItems });
    assert.equal(state.reviewComplete, true);
    assert.ok(state.includedItems.length > 0);

    const metadata = (await supplierOrder()).body.data;
    assert.equal(metadata.available, true);
    const { sheet } = await downloadSheet(metadata.downloadUrl);
    const rows = supplierSheetRows(sheet);
    assert.equal(rows.length, state.includedItems.length);

    let checkedOwnerBuy = 0;
    for (const item of apiItems) {
      if (classifyItem(item).kind !== 'included') continue;
      const finalEntry = state.includedItems.find(
        entry => entry.rowId === item.row_id
      );
      assert.ok(finalEntry, `ожидается включённая позиция ${item.sku}`);
      assert.equal(
        item.quantities.final_quantity,
        finalEntry.quantity,
        `API final_quantity ${item.sku} должна совпадать с FinalOrderState`
      );

      const xlsxRow = rows.find(row => row.sku === item.sku);
      assert.ok(xlsxRow, `ожидается строка Supplier XLSX для ${item.sku}`);
      assert.equal(
        xlsxRow.quantity,
        finalEntry.quantity,
        `Supplier XLSX quantity ${item.sku} должна совпадать с FinalOrderState`
      );

      if (item.owner_decision?.decision === 'BUY') {
        checkedOwnerBuy += 1;
      }
    }
    assert.ok(
      checkedOwnerBuy >= 1,
      'должна быть проверена хотя бы одна OWNER BUY позиция'
    );
  }
);

function boxItem(overrides = {}) {
  return {
    row_id: 'box-row-1',
    sku: 'BOX-SKU-1',
    name: 'Box item',
    supplier: 'Supplier',
    workflow_status: 'auto_approved',
    quantities: { approved_quantity: 5 },
    amounts: { unit_price: 10 },
    matrix: { owner_review_required: false },
    assortment_policy: {
      matched: true,
      adjusted: true,
      rule: 'BOX',
      order_mode: 'BOX',
      box_qty: 12,
      max_stock: 100,
    },
    owner_decision: { decision: null, quantity: null },
    ...overrides,
  };
}

function boxBundle(ownerDecisionOverrides = {}) {
  const ownerDecision = {
    decision: null,
    quantity: null,
    ...ownerDecisionOverrides,
  };
  return {
    agentResult: [{
      json: {
        decisions: [],
        workingOrderProducts: [{
          rowIdentity: 'box-row-1',
          rowNumber: 1,
          article: 'BOX-SKU-1',
          name: 'Box item',
          supplier: 'Supplier',
          workflowStatus: 'auto_approved',
          analyzerCalculatedQuantity: 5,
          minmaxRecommendedQuantity: 5,
          finalRecommendedQuantity: 5,
          approvedOrderQuantity: 5,
          provisionalOrderQuantity: null,
          approvedLineSum: 50,
          priceNum: 10,
          freeStock: 0,
          assortmentPolicy: {
            matched: true,
            policy_adjusted: true,
            policy_rule: 'BOX',
            applied_rules: ['BOX'],
            explanation: 'Box rule.',
            order_mode: 'BOX',
            box_qty: 12,
            max_stock: 100,
            policy_warnings: [],
          },
        }],
      },
    }],
    matrixDraft: {
      items: [{
        rowIdentity: 'box-row-1',
        owner_order_decision: ownerDecision.decision,
        owner_order_quantity: ownerDecision.quantity,
        owner_action_required: false,
      }],
    },
    ownerReview: {
      items: [{
        rowIdentity: 'box-row-1',
        owner_action_required: false,
      }],
      sections: {},
    },
    explanations: { items: [{}] },
  };
}

test('auto-approved final_quantity is consistent across DTO, service and FinalOrderState', () => {
  const autoItem = {
    row_id: 'auto-row-1',
    sku: 'AUTO-SKU-1',
    name: 'Auto item',
    workflow_status: 'auto_approved',
    quantities: { approved_quantity: 8 },
    amounts: { unit_price: 5 },
    matrix: { owner_review_required: false },
    assortment_policy: { order_mode: 'PIECE' },
    owner_decision: { decision: null, quantity: null },
  };
  const decorated = withFinalQuantity(autoItem);
  assert.equal(finalQuantityWithOwnerDecision(decorated), 8);
  assert.equal(decorated.quantities.final_quantity, 8);

  const state = buildFinalOrderState({ items: [decorated] });
  assert.equal(state.includedItems[0].quantity, 8);
});

test('BOX multiplicity rounds auto-approved quantity up to box_qty', () => {
  const item = boxItem();
  const decorated = withFinalQuantity(item);
  assert.equal(
    finalQuantityWithOwnerDecision(decorated),
    12,
    'API final_quantity должна округляться до кратности короба'
  );
  assert.equal(decorated.quantities.final_quantity, 12);

  const state = buildFinalOrderState({ items: [decorated] });
  assert.equal(state.includedItems[0].quantity, 12);

  const [mapped] = mapPurchasingItems(boxBundle());
  assert.equal(
    mapped.quantities.final_quantity,
    12,
    'DTO final_quantity должна округляться до кратности короба'
  );
});

test('BOX multiplicity rounds OWNER BUY quantity up to box_qty', () => {
  const item = boxItem({
    owner_decision: { decision: 'BUY', quantity: 7 },
  });
  const decorated = withFinalQuantity(item);
  assert.equal(finalQuantityWithOwnerDecision(decorated), 12);
  assert.equal(decorated.quantities.final_quantity, 12);

  const state = buildFinalOrderState({ items: [decorated] });
  assert.equal(state.includedItems[0].quantity, 12);

  const [mapped] = mapPurchasingItems(boxBundle({
    decision: 'BUY',
    quantity: 7,
  }));
  assert.equal(mapped.quantities.final_quantity, 12);
});

test('classifyItem + applyPackagingRules is the single source of final_quantity', () => {
  const item = boxItem({
    owner_decision: { decision: 'BUY', quantity: 7 },
  });
  const classification = classifyItem(item);
  assert.equal(classification.kind, 'included');
  const packaging = applyPackagingRules(item, classification.quantity);
  assert.equal(packaging.quantity, 12);
  assert.equal(packaging.orderMode, 'BOX');
  assert.equal(finalQuantityWithOwnerDecision(item), packaging.quantity);
});
