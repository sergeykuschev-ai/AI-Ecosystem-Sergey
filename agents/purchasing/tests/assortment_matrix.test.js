const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const {
  AssortmentMatrixError,
  validateAssortmentMatrix,
  loadAssortmentMatrix,
  matchAssortmentMatrix,
} = require('../services/assortment_matrix_loader');
const {
  CRITICAL_MISSING_WARNING,
  AVAILABLE_FREE_STOCK_FORMULA,
  PHYSICAL_STOCK_FORMULA,
  buildInventoryProjection,
  applyAssortmentMatrixControl,
} = require('../services/assortment_matrix_controller');
const {
  buildAssortmentMatrixReport,
} = require('../services/assortment_matrix_report');
const {
  readSmartZapasExport,
} = require('../adapters/smartzapas_adapter');
const {
  runOrderAgentFromAdapterResultWithDemand,
} = require('../order_agent');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const WORKING_MATRIX_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-assortment-matrix.json'
);
const XLSX_FIXTURE_PATH = path.join(
  REPOSITORY_ROOT,
  'tests/fixtures/SmartZapas_synthetic.xlsx'
);
const REAL_FIXTURE_PATH = process.env.SMARTZAPAS_REAL_FIXTURE || null;
const TEMP_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), 'assortment-matrix-test-')
);

after(() => {
  fs.rmSync(TEMP_DIRECTORY, { recursive: true, force: true });
});

function matrixItem(overrides = {}) {
  return {
    article: 'A-1',
    name: 'Тестовый обязательный товар 100 г',
    brand: 'Test',
    category: 'Test category',
    priority: 'critical',
    minimum_shelf_stock: 2,
    target_stock: 4,
    allow_zero_stock: false,
    notes: 'Test item',
    ...overrides,
  };
}

function matrix(items = [matrixItem()]) {
  return validateAssortmentMatrix({
    version: 1,
    updated_at: '2026-07-19',
    store: 'Миска',
    items,
  });
}

function row(overrides = {}) {
  const article = Object.hasOwn(overrides, 'article') ? overrides.article : 'A-1';
  const name = overrides.name || 'Тестовый обязательный товар 100 г';
  const rowNumber = overrides.rowNumber || 4;
  return {
    rowIdentity: overrides.rowIdentity || `report:sheet:${rowNumber}`,
    rowNumber,
    article,
    name,
    reserve: Object.hasOwn(overrides, 'reserve') ? overrides.reserve : 0,
    matchingHints: {
      barcode: overrides.barcode || null,
      internalProductId: null,
      supplier: 'Test Supplier',
      article,
      normalizedName: name.toLowerCase(),
    },
  };
}

function demandProduct(sourceRow, overrides = {}) {
  return {
    rowIdentity: sourceRow.rowIdentity,
    rowNumber: sourceRow.rowNumber,
    name: sourceRow.name,
    article: sourceRow.article,
    supplier: 'Test Supplier',
    abc: 'A',
    xyz: 'X',
    priceNum: 100,
    freeStock: Object.hasOwn(overrides, 'freeStock') ? overrides.freeStock : 0,
    inTransitQuantity: Object.hasOwn(overrides, 'inTransitQuantity')
      ? overrides.inTransitQuantity
      : 0,
    analyzerCalculatedQuantity: Object.hasOwn(overrides, 'analyzerQuantity')
      ? overrides.analyzerQuantity
      : 1,
    finalRecommendedQuantity: Object.hasOwn(overrides, 'finalQuantity')
      ? overrides.finalQuantity
      : 1,
    salesDailyRate: Object.hasOwn(overrides, 'salesDailyRate')
      ? overrides.salesDailyRate
      : 1,
    warnings: [],
    requiredData: [],
  };
}

function decisionFor(product, overrides = {}) {
  return {
    rowIdentity: product.rowIdentity,
    decision: 'do_not_buy',
    decisionBasis: 'phase2_calculated',
    confidence: 'high',
    calculatedOrderQuantity: product.finalRecommendedQuantity,
    approvedOrderQuantity: 0,
    reasons: ['existing_reason'],
    warnings: [],
    requiredData: [],
    decisionScore: 80,
    decisionVersion: 'test',
    ...overrides,
  };
}

function applyControl({
  sourceRow = row(),
  product = null,
  item = matrixItem(),
  decision = null,
} = {}) {
  const validatedMatrix = matrix([item]);
  const matchResult = matchAssortmentMatrix(validatedMatrix, [sourceRow]);
  const resolvedProduct = product || demandProduct(sourceRow);
  return applyAssortmentMatrixControl({
    analysis: { productRows: [sourceRow] },
    demandProducts: [resolvedProduct],
    decisions: [decision || decisionFor(resolvedProduct)],
    matrix: validatedMatrix,
    matchResult,
  });
}

test('loads and validates the working Miska assortment matrix', () => {
  const loaded = loadAssortmentMatrix(WORKING_MATRIX_PATH);

  assert.equal(loaded.matrix.store, 'Миска');
  assert.ok(loaded.matrix.items.length >= 20);
  assert.ok(loaded.matrix.items.some(item => item.brand === 'AWARD'));
  assert.ok(loaded.matrix.items.some(item => item.brand === 'CRAFTIA HARMONA'));
  assert.ok(loaded.matrix.items.some(item => item.brand === "Cat's Choice"));
});

test('reports a clear error when the matrix file is absent', () => {
  assert.throws(
    () => loadAssortmentMatrix(path.join(TEMP_DIRECTORY, 'missing.json')),
    error => error instanceof AssortmentMatrixError &&
      error.code === 'MATRIX_FILE_ERROR' &&
      error.message.includes('файл не найден')
  );
});

test('reports a clear error for corrupted matrix JSON', () => {
  const filePath = path.join(TEMP_DIRECTORY, 'corrupted.json');
  fs.writeFileSync(filePath, '{ "items": ', 'utf8');

  assert.throws(
    () => loadAssortmentMatrix(filePath),
    error => error instanceof AssortmentMatrixError &&
      error.code === 'INVALID_JSON'
  );
});

test('accepts absent optional item fields and rejects absent required fields', () => {
  const value = validateAssortmentMatrix({
    version: 1,
    updated_at: '2026-07-19',
    store: 'Миска',
    items: [{
      name: 'Товар без необязательных полей',
      priority: 'standard',
      minimum_shelf_stock: 0,
      target_stock: 0,
      allow_zero_stock: true,
    }],
  });
  assert.equal(value.items[0].article, null);
  assert.equal(value.items[0].brand, null);

  assert.throws(
    () => validateAssortmentMatrix({
      version: 1,
      updated_at: '2026-07-19',
      store: 'Миска',
      items: [{ name: 'Incomplete' }],
    }),
    error => error instanceof AssortmentMatrixError
  );
});

test('matches a matrix item by a unique article', () => {
  const sourceRow = row();
  const result = matchAssortmentMatrix(matrix(), [sourceRow]);

  assert.equal(result.itemResults[0].status, 'matched');
  assert.equal(result.itemResults[0].matchMethod, 'article');
  assert.equal(result.itemResults[0].row.rowIdentity, sourceRow.rowIdentity);
});

test('matches by normalized exact name when article is absent', () => {
  const sourceRow = row({ article: null, name: 'Товар с Ёлкой, 100 г' });
  const value = matrix([matrixItem({ article: null, name: ' товар с елкой 100 г ' })]);
  const result = matchAssortmentMatrix(value, [sourceRow]);

  assert.equal(result.itemResults[0].status, 'matched');
  assert.equal(result.itemResults[0].matchMethod, 'normalized_name');
});

test('does not merge products with a repeated article', () => {
  const first = row({ rowNumber: 4, article: 'DUP', name: 'Первый товар' });
  const second = row({ rowNumber: 5, article: 'DUP', name: 'Второй товар' });
  const value = matrix([
    matrixItem({ article: 'DUP', name: 'Первый товар' }),
    matrixItem({ article: 'DUP', name: 'Второй товар', priority: 'important' }),
  ]);
  const result = matchAssortmentMatrix(value, [first, second]);

  assert.deepEqual(
    result.itemResults.map(item => item.matchMethod),
    ['normalized_name', 'normalized_name']
  );
  assert.equal(result.matchesByRowIdentity.size, 2);
});

test('leaves a repeated article ambiguous when the name cannot disambiguate it', () => {
  const rows = [
    row({ rowNumber: 4, article: 'DUP', name: 'Первый товар' }),
    row({ rowNumber: 5, article: 'DUP', name: 'Второй товар' }),
  ];
  const value = matrix([matrixItem({ article: 'DUP', name: 'Неизвестный товар' })]);
  const result = matchAssortmentMatrix(value, rows);

  assert.equal(result.itemResults[0].status, 'ambiguous');
  assert.equal(result.matchesByRowIdentity.size, 0);
});

test('uses SmartZapas free stock as already available stock without subtracting reserve', () => {
  const sourceRow = row({ reserve: 2 });
  const product = demandProduct(sourceRow, {
    freeStock: 3,
    inTransitQuantity: 1,
    finalQuantity: 4,
  });
  assert.deepEqual(buildInventoryProjection(product, sourceRow, matrixItem()), {
    calculation_status: 'calculated',
    missing_fields: [],
    formula: AVAILABLE_FREE_STOCK_FORMULA,
    stock_basis: 'available_free_stock',
    free_stock: 3,
    in_transit: 1,
    reserve: 2,
    recommended_order_qty: 4,
    projected_stock: 8,
    below_matrix_minimum: false,
  });

  const unknown = buildInventoryProjection(
    { ...product, freeStock: null },
    sourceRow,
    matrixItem()
  );
  assert.equal(unknown.calculation_status, 'insufficient_data');
  assert.deepEqual(unknown.missing_fields, ['free_stock']);
  assert.equal(unknown.free_stock, null);
  assert.equal(unknown.projected_stock, null);
  assert.equal(unknown.below_matrix_minimum, null);
});

test('requires reserve only for an explicitly physical-stock projection model', () => {
  const sourceRow = row({ reserve: null });
  const product = demandProduct(sourceRow, {
    freeStock: 3,
    inTransitQuantity: 1,
    finalQuantity: 4,
  });
  const physical = buildInventoryProjection(
    product,
    sourceRow,
    matrixItem(),
    { stockBasis: 'physical_stock' }
  );

  assert.equal(physical.calculation_status, 'insufficient_data');
  assert.deepEqual(physical.missing_fields, ['reserve']);
  assert.equal(physical.formula, PHYSICAL_STOCK_FORMULA);
  assert.equal(physical.projected_stock, null);

  const complete = buildInventoryProjection(
    product,
    row({ reserve: 2 }),
    matrixItem(),
    { stockBasis: 'physical_stock' }
  );
  assert.equal(complete.calculation_status, 'calculated');
  assert.equal(complete.projected_stock, 6);
});

test('preserves zero inventory inputs as zero and does not require reserve', () => {
  const projection = buildInventoryProjection(
    demandProduct(row({ reserve: null }), {
      freeStock: 0,
      inTransitQuantity: 0,
      finalQuantity: 0,
    }),
    row({ reserve: null }),
    matrixItem()
  );

  assert.equal(projection.calculation_status, 'calculated');
  assert.deepEqual(projection.missing_fields, []);
  assert.equal(projection.reserve, null);
  assert.equal(projection.free_stock, 0);
  assert.equal(projection.in_transit, 0);
  assert.equal(projection.projected_stock, 0);
});

test('marks inventory projection as not applicable without a matrix match', () => {
  const sourceRow = row();
  const product = demandProduct(sourceRow);
  const projection = buildInventoryProjection(product, sourceRow, null);

  assert.equal(projection.calculation_status, 'not_applicable');
  assert.deepEqual(projection.missing_fields, []);
  assert.equal(projection.formula, null);
  assert.equal(projection.projected_stock, null);
});

test('critical below minimum cannot remain do_not_buy', () => {
  const sourceRow = row({ reserve: 0 });
  const product = demandProduct(sourceRow, {
    freeStock: 0,
    finalQuantity: 1,
    salesDailyRate: 0,
  });
  const result = applyControl({ sourceRow, product });

  assert.equal(result.products[0].inventory_projection.projected_stock, 1);
  assert.equal(result.products[0].inventory_projection.below_matrix_minimum, true);
  assert.equal(result.decisions[0].decision, 'must_buy');
  assert.equal(result.decisions[0].approvedOrderQuantity, 1);
});

test('critical confirmed zero stock with sales becomes must_buy', () => {
  const sourceRow = row({ reserve: null });
  const product = demandProduct(sourceRow, {
    freeStock: 0,
    finalQuantity: 2,
    salesDailyRate: 0.5,
  });
  const result = applyControl({ sourceRow, product });

  assert.equal(result.decisions[0].decision, 'must_buy');
  assert.ok(result.decisions[0].reasons.includes(
    'critical_zero_stock_with_confirmed_sales'
  ));
});

test('critical with unknown stock is sent to manual review', () => {
  const sourceRow = row({ reserve: 0 });
  const product = demandProduct(sourceRow, { freeStock: null });
  const result = applyControl({ sourceRow, product });

  assert.equal(result.products[0].inventory_projection.projected_stock, null);
  assert.equal(result.decisions[0].decision, 'manual_review');
  assert.ok(result.decisions[0].requiredData.includes('free_stock'));
});

test('critical with missing required in-transit input remains manual review', () => {
  const sourceRow = row({ reserve: null });
  const product = demandProduct(sourceRow, {
    freeStock: 0,
    inTransitQuantity: null,
    finalQuantity: 1,
    salesDailyRate: 1,
  });
  const result = applyControl({ sourceRow, product });

  assert.equal(
    result.products[0].inventory_projection.calculation_status,
    'insufficient_data'
  );
  assert.deepEqual(
    result.products[0].inventory_projection.missing_fields,
    ['in_transit']
  );
  assert.equal(result.decisions[0].decision, 'manual_review');
});

test('important below minimum becomes recommended without changing quantity', () => {
  const sourceRow = row({ reserve: 0 });
  const product = demandProduct(sourceRow, {
    freeStock: 0,
    finalQuantity: 1,
    salesDailyRate: 0,
  });
  const result = applyControl({
    sourceRow,
    product,
    item: matrixItem({ priority: 'important' }),
  });

  assert.equal(result.decisions[0].decision, 'recommended');
  assert.equal(result.decisions[0].approvedOrderQuantity, 1);
  assert.equal(result.products[0].finalRecommendedQuantity, 1);
});

test('standard matrix item preserves the existing Phase 2 decision', () => {
  const sourceRow = row({ reserve: 0 });
  const product = demandProduct(sourceRow, { finalQuantity: 1 });
  const existingDecision = decisionFor(product, {
    decision: 'postpone',
    approvedOrderQuantity: null,
  });
  const result = applyControl({
    sourceRow,
    product,
    item: matrixItem({ priority: 'standard' }),
    decision: existingDecision,
  });

  assert.deepEqual(result.decisions[0], existingDecision);
});

test('reports a critical matrix item missing from the supplier report', () => {
  const validatedMatrix = matrix();
  const matchResult = matchAssortmentMatrix(validatedMatrix, []);
  const result = applyAssortmentMatrixControl({
    analysis: { productRows: [] },
    demandProducts: [],
    decisions: [],
    matrix: validatedMatrix,
    matchResult,
  });

  assert.equal(result.summary.missing_matrix_items_count, 1);
  assert.equal(result.missingMatrixItems[0].reason, 'not_found_in_supplier_report');
  assert.deepEqual(result.warnings, [CRITICAL_MISSING_WARNING]);
});

test('adds matrix blocks to result JSON and report text', async () => {
  const adapterResult = await readSmartZapasExport(XLSX_FIXTURE_PATH);
  const fixtureRow = adapterResult.rows[0];
  const filePath = path.join(TEMP_DIRECTORY, 'integration-matrix.json');
  fs.writeFileSync(filePath, `${JSON.stringify({
    version: 1,
    updated_at: '2026-07-19',
    store: 'Миска',
    items: [matrixItem({
      article: fixtureRow.article,
      name: fixtureRow.name,
      minimum_shelf_stock: 1,
      target_stock: 2,
    })],
  }, null, 2)}\n`, 'utf8');

  const json = runOrderAgentFromAdapterResultWithDemand(
    adapterResult,
    { purchasingProfile: 'miska' },
    { assortmentMatrixPath: filePath }
  )[0].json;

  assert.equal(json.assortment_matrix_summary.total_matrix_items, 1);
  assert.equal(json.assortment_matrix_summary.matched_matrix_items, 1);
  assert.equal(json.demandProducts.length, 6);
  assert.equal(json.demandProducts[0].assortment_matrix.matched, true);
  assert.ok(json.demandProducts[0].inventory_projection);
  assert.ok(json.minmax_text.includes(
    '## КОНТРОЛЬ ОБЯЗАТЕЛЬНОЙ АССОРТИМЕНТНОЙ МАТРИЦЫ'
  ));
  assert.ok(json.minmax_text.includes(
    '## ОБЯЗАТЕЛЬНЫЕ ПОЗИЦИИ, ОТСУТСТВУЮЩИЕ В ОТЧЁТЕ ПОСТАВЩИКА'
  ));
});

test('builds the required readable matrix report sections', () => {
  const control = applyControl();
  const report = buildAssortmentMatrixReport(control);

  assert.ok(report.includes('Общее количество позиций в матрице: 1'));
  assert.ok(report.includes('CRITICAL-ПОЗИЦИИ НИЖЕ МИНИМАЛЬНОГО ОСТАТКА'));
  assert.ok(report.includes('Прогнозный остаток: 1'));
});

test('AWARD Urinary uses available free stock on the optional real workbook', {
  skip: !REAL_FIXTURE_PATH,
}, async () => {
  const realAdapterResult = await readSmartZapasExport(REAL_FIXTURE_PATH);
  const json = runOrderAgentFromAdapterResultWithDemand(
    realAdapterResult,
    { purchasingProfile: 'miska' },
    { assortmentMatrixPath: WORKING_MATRIX_PATH }
  )[0].json;
  const product = json.demandProducts.find(item => item.article === '7173648');
  const decision = json.decisions.find(
    item => item.rowIdentity === product?.rowIdentity
  );

  assert.ok(product, 'AWARD Urinary must be present in the real report');
  assert.equal(product.freeStock, 9);
  assert.equal(product.inTransitQuantity, 0);
  assert.equal(product.inventory_projection.recommended_order_qty, 1);
  assert.equal(product.inventory_projection.formula, AVAILABLE_FREE_STOCK_FORMULA);
  assert.equal(product.inventory_projection.calculation_status, 'calculated');
  assert.equal(product.inventory_projection.projected_stock, 10);
  assert.equal(product.inventory_projection.below_matrix_minimum, false);
  assert.equal(decision.decision, 'must_buy');
});
