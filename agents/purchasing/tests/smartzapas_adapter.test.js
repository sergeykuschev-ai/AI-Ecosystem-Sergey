const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');

const {
  NORMALIZED_ROW_SCHEMA,
  adaptSmartZapasMatrix,
  assertUsableAdapterResult,
  readSmartZapasExport,
  resolveColumns,
} = require('../adapters/smartzapas_adapter');
const {
  runOrderAgent,
  runOrderAgentFromAdapterResult,
  runOrderAgentFromAdapterResultWithDemand,
  runOrderAgentFromSmartZapasXlsx,
} = require('../order_agent');
const { analyzeRows } = require('../services/analyzer');

const FIXTURES_DIRECTORY = path.resolve(__dirname, '../../../tests/fixtures');
const JSON_FIXTURE_PATH = path.join(
  FIXTURES_DIRECTORY,
  'SmartZapas_sanitized.json'
);
const XLSX_FIXTURE_PATH = path.join(
  FIXTURES_DIRECTORY,
  'SmartZapas_synthetic.xlsx'
);
const REAL_FIXTURE_PATH = process.env.SMARTZAPAS_REAL_FIXTURE || null;
const sanitizedFixture = JSON.parse(fs.readFileSync(JSON_FIXTURE_PATH, 'utf8'));

let adapterResult;

before(() => {
  adapterResult = adaptSmartZapasMatrix(sanitizedFixture.matrix, {
    sheetName: sanitizedFixture.sheetName,
  });
});

test('merges the three-row header and resolves canonical columns exactly', () => {
  assert.equal(adapterResult.source.sheetName, 'SmartZapas Synthetic');
  assert.equal(adapterResult.source.headerRowCount, 3);
  assert.equal(adapterResult.source.sourceRowsCount, 8);
  assert.equal(adapterResult.headerPaths.length, 16);

  const expectedColumns = {
    barcode: 'A',
    internalProductId: 'B',
    article: 'C',
    supplier: 'E',
    stockDays: 'J',
    freeStock: 'K',
    autoMin: 'L',
    manualMin: 'M',
    supplierOrderQty: 'N',
  };

  for (const [field, column] of Object.entries(expectedColumns)) {
    assert.equal(adapterResult.columnMap[field].column, column);
  }

  assert.deepEqual(adapterResult.diagnostics.ambiguousColumns, []);
  assert.deepEqual(adapterResult.diagnostics.missingRequiredColumns, []);
});

test('classifies products independently of article and skips structural rows', () => {
  assert.equal(adapterResult.rows.length, 6);
  assert.equal(adapterResult.serviceRows.length, 2);
  assert.equal(adapterResult.diagnostics.skippedServiceRows.length, 2);
  assert.ok(adapterResult.rows.every(row => row.schemaVersion === NORMALIZED_ROW_SCHEMA));

  const productsWithoutArticle = adapterResult.rows.filter(row => !row.article);
  assert.equal(productsWithoutArticle.length, 3);
  assert.ok(productsWithoutArticle.some(row => !row.barcode && !row.internalProductId));

  assert.deepEqual(
    adapterResult.diagnostics.skippedServiceRows.map(row => row.rowNumber),
    [10, 11]
  );
  assert.deepEqual(adapterResult.diagnostics.ambiguousRowClassifications, [
    {
      rowNumber: 9,
      name: 'Synthetic product requiring classification review 50 г',
      classification: 'retained_as_product',
      reason: 'missing_supplier_with_product_signals',
      signals: ['article', 'abc', 'abcDeals', 'xyz'],
    },
  ]);
});

test('generates unique deterministic report-local row identities', () => {
  const repeatedResult = adaptSmartZapasMatrix(sanitizedFixture.matrix, {
    sheetName: sanitizedFixture.sheetName,
  });
  const identities = adapterResult.rows.map(row => row.rowIdentity);

  assert.equal(new Set(identities).size, adapterResult.rows.length);
  assert.deepEqual(
    identities,
    repeatedResult.rows.map(row => row.rowIdentity)
  );
  assert.ok(identities.every(identity =>
    identity.includes(adapterResult.source.reportFingerprint)
  ));
  assert.equal(adapterResult.rows[0].identityBasis, 'barcode');
  assert.equal(adapterResult.rows[2].identityBasis, 'internal_product_id');
  assert.equal(adapterResult.rows[4].identityBasis, 'source_row');
});

test('exposes matching hints without matching or merging products', () => {
  const barcodeProduct = adapterResult.rows[0];
  const fallbackProduct = adapterResult.rows[4];

  assert.deepEqual(barcodeProduct.matchKey, { type: 'barcode', value: 'bc-1' });
  assert.equal(fallbackProduct.matchKey, null);
  assert.equal(fallbackProduct.matchingHints.article, null);
  assert.deepEqual(
    fallbackProduct.matchingHints.packageAttributes.weight,
    ['500 г']
  );
  assert.equal(adapterResult.diagnostics.identityFallbacks.length, 2);
});

test('diagnoses repeated barcode, internal ID, and article without suppressing rows', () => {
  const diagnosticsByType = new Map(
    adapterResult.diagnostics.duplicateIdentifiers.map(diagnostic => [
      diagnostic.identifierType,
      diagnostic,
    ])
  );

  assert.deepEqual(diagnosticsByType.get('barcode').rowNumbers, [4, 5]);
  assert.deepEqual(diagnosticsByType.get('internal_product_id').rowNumbers, [6, 7]);
  assert.deepEqual(diagnosticsByType.get('article').rowNumbers, [4, 5]);
  assert.ok(
    adapterResult.diagnostics.duplicateIdentifiers.every(
      diagnostic => diagnostic.action === 'retained_all_rows'
    )
  );

  const analysis = analyzeRows(adapterResult.rows);
  assert.equal(analysis.productRows.length, 6);
  assert.deepEqual(
    analysis.productRows.map(row => row.rowNumber).sort((a, b) => a - b),
    [4, 5, 6, 7, 8, 9]
  );
});

test('analyzes every adapter-retained row even without article or price', () => {
  const rows = structuredClone(adapterResult.rows);
  const fallbackProduct = rows.find(row => row.rowNumber === 8);
  fallbackProduct.article = '';
  fallbackProduct.priceNum = null;
  fallbackProduct.matchingHints.article = null;

  const analysis = analyzeRows(rows);

  assert.equal(analysis.productRows.length, 6);
  assert.ok(analysis.productRows.some(row => row.rowIdentity === fallbackProduct.rowIdentity));
});

test('preserves blank free stock as unknown with source provenance', () => {
  const blankStockProduct = adapterResult.rows[0];
  const confirmedZeroProduct = adapterResult.rows[1];
  const result = runOrderAgentFromAdapterResult(adapterResult)[0].json;

  assert.equal(blankStockProduct.freeStock, null);
  assert.equal(blankStockProduct.sourceTokens.freeStock, null);
  assert.equal(blankStockProduct.provenance.fields.freeStock.column, 'K');
  assert.equal(confirmedZeroProduct.freeStock, 0);
  assert.equal(result.confirmedZeroStockCount, 1);
  assert.equal(result.unknownStockCount, 4);
  assert.equal(result.zeroStockDaysWithBlankStockCount, 4);
  assert.equal(result.zero_stock_rows_count, result.confirmedZeroStockCount);
});

test('validates normalized rows and preserves missing order-sum fallback', () => {
  assert.doesNotThrow(() => assertUsableAdapterResult(adapterResult));

  const invalidResult = structuredClone(adapterResult);
  delete invalidResult.rows[0].rowIdentity;
  assert.throws(
    () => assertUsableAdapterResult(invalidResult),
    /requires rowIdentity/
  );

  const forgedIdentityResult = structuredClone(adapterResult);
  forgedIdentityResult.rows[0].rowIdentity = 'forged';
  assert.throws(
    () => assertUsableAdapterResult(forgedIdentityResult),
    /invalid deterministic rowIdentity/
  );

  const analysis = analyzeRows(adapterResult.rows);
  assert.equal(analysis.productRows.find(row => row.rowNumber === 4).sumNum, 20);
  assert.equal(analysis.productRows.find(row => row.rowNumber === 8).sumNum, 37.5);
  assert.equal(analysis.totalOrderSum, 90.5);
});

test('reports exact-match ambiguity and missing required columns', () => {
  const duplicateSupplierHeaders = [
    ...adapterResult.headerPaths,
    adapterResult.columnMap.supplier.header,
  ];
  const ambiguous = resolveColumns(duplicateSupplierHeaders);
  const supplierAmbiguity = ambiguous.ambiguousColumns.find(
    diagnostic => diagnostic.field === 'supplier'
  );

  assert.equal(supplierAmbiguity.matches.length, 2);

  const missingFreeStockHeaders = adapterResult.headerPaths.map(
    (header, index) => index === adapterResult.columnMap.freeStock.index ? '' : header
  );
  const missing = resolveColumns(missingFreeStockHeaders);

  assert.ok(
    missing.missingRequiredColumns.some(diagnostic => diagnostic.field === 'freeStock')
  );
  assert.ok(
    !missing.missingRequiredColumns.some(diagnostic => diagnostic.field === 'article')
  );
});

test('keeps the existing n8n runOrderAgent entry point compatible', () => {
  const result = runOrderAgent([
    {
      json: {
        Наименование: 'Legacy synthetic product',
        Артикул: 'LEGACY-1',
        'Основной поставщик': 'Synthetic Supplier',
        Цена: 10,
        'Заказать у поставщика': 2,
        'Свободный остаток': '',
      },
    },
  ])[0].json;

  assert.equal(result.source_rows_count, 1);
  assert.equal(result.product_rows_count, 1);
  assert.equal(result.order_rows_count, 1);
  assert.equal(result.preliminary_order_sum, 20);
  assert.equal(result.unknownStockCount, 1);
  assert.deepEqual(result.detected_columns, [
    'rowNumber',
    'Наименование',
    'Артикул',
    'Основной поставщик',
    'Цена',
    'Заказать у поставщика',
    'Свободный остаток',
  ]);
});

test('reads the committed synthetic XLSX through the non-breaking entry point', async () => {
  const xlsxResult = await readSmartZapasExport(XLSX_FIXTURE_PATH);
  const agentResult = await runOrderAgentFromSmartZapasXlsx(XLSX_FIXTURE_PATH);

  assert.equal(xlsxResult.source.sheetName, 'SmartZapas Synthetic');
  assert.equal(xlsxResult.rows.length, 6);
  assert.equal(xlsxResult.serviceRows.length, 2);
  assert.equal(agentResult[0].json.product_rows_count, 6);
  assert.equal(agentResult[0].json.preliminary_order_sum, 91);
  assert.equal(agentResult[0].json.decisions.length, 6);
  assert.equal(agentResult[0].json.demandProducts, undefined);
  assert.equal(
    agentResult[0].json.mustBuyCount +
      agentResult[0].json.recommendedCount +
      agentResult[0].json.manualReviewCount +
      agentResult[0].json.postponeCount +
      agentResult[0].json.doNotBuyCount,
    6
  );
});

test(
  'optionally characterizes the real SmartZapas workbook as 403 products and 72 structural rows',
  { skip: !REAL_FIXTURE_PATH },
  async () => {
    assert.ok(fs.existsSync(REAL_FIXTURE_PATH), 'SMARTZAPAS_REAL_FIXTURE does not exist.');
    const realAdapterResult = await readSmartZapasExport(REAL_FIXTURE_PATH);
    const realAgentResult = runOrderAgentFromAdapterResult(realAdapterResult)[0].json;
    const realPhase2Result = runOrderAgentFromAdapterResultWithDemand(
      realAdapterResult,
      {}
    )[0].json;
    const realRowNumbers = new Set(realAdapterResult.rows.map(row => row.rowNumber));

    assert.equal(realAdapterResult.rows.length, 403);
    assert.equal(realAdapterResult.serviceRows.length, 72);
    assert.equal(new Set(realAdapterResult.rows.map(row => row.rowIdentity)).size, 403);
    assert.equal(realAgentResult.product_rows_count, 403);
    assert.equal(realAgentResult.normalized_product_rows_count, 403);
    assert.equal(realAgentResult.source_rows_count, 475);
    assert.equal(realAgentResult.order_rows_count, 127);
    assert.equal(realAgentResult.preliminary_order_sum, 89160);
    assert.equal(realAgentResult.decisions.length, 403);
    assert.equal(
      realAgentResult.mustBuyCount +
        realAgentResult.recommendedCount +
        realAgentResult.manualReviewCount +
        realAgentResult.postponeCount +
        realAgentResult.doNotBuyCount,
      403
    );
    assert.equal(
      realAgentResult.approvedOrderLines + realAgentResult.pendingReviewLines,
      127
    );
    assert.equal(
      realAgentResult.approvedOrderSum +
        realAgentResult.pendingReviewCalculatedSum,
      89159.68
    );
    assert.equal(realAgentResult.unknownStockCount, 112);
    assert.equal(realAgentResult.zeroStockDaysWithBlankStockCount, 104);
    assert.equal(realPhase2Result.source_rows_count, 475);
    assert.equal(realPhase2Result.product_rows_count, 403);
    assert.equal(realPhase2Result.order_rows_count, 127);
    assert.equal(realPhase2Result.preliminary_order_sum, 89160);
    assert.equal(realPhase2Result.demandProducts.length, 403);
    assert.equal(realPhase2Result.decisions.length, 403);
    assert.equal(realPhase2Result.productsWithSalesData, 0);
    assert.equal(realPhase2Result.productsMissingAllSales, 403);
    assert.equal(realPhase2Result.assortmentMatrixStatus, 'not_provided');
    assert.equal(realPhase2Result.inTransitSourceStatus, 'not_provided');
    assert.equal(realPhase2Result.demandOrderLines, null);
    assert.equal(realPhase2Result.finalApprovedLines, null);
    assert.equal(realPhase2Result.finalApprovedSum, null);
    assert.equal(realPhase2Result.manualReviewCount, 127);
    assert.equal(realPhase2Result.doNotBuyCount, 276);
    assert.equal(realPhase2Result.provisionalNoActionCount, 276);
    assert.equal(realPhase2Result.positiveAnalyzerLinesAwaitingData, 127);
    assert.ok(
      realPhase2Result.demandProducts.every(
        product => product.finalRecommendedQuantity === null
      )
    );
    const phase2ProductsByIdentity = new Map(
      realPhase2Result.demandProducts.map(product => [product.rowIdentity, product])
    );
    for (const decision of realPhase2Result.decisions) {
      const product = phase2ProductsByIdentity.get(decision.rowIdentity);
      if (product.analyzerCalculatedQuantity > 0) {
        assert.equal(decision.decision, 'manual_review');
        assert.equal(decision.decisionBasis, 'phase2_data_incomplete');
      } else {
        assert.equal(product.analyzerCalculatedQuantity, 0);
        assert.equal(decision.decision, 'do_not_buy');
        assert.equal(decision.decisionBasis, 'provisional_phase1_no_order');
      }
    }

    for (const rowNumber of [118, 121, 358, 361, 363, 366]) {
      assert.ok(realRowNumbers.has(rowNumber), `Expected retained source row ${rowNumber}.`);
    }

    const duplicateArticles = realAdapterResult.diagnostics.duplicateIdentifiers
      .filter(diagnostic => diagnostic.identifierType === 'article')
      .map(diagnostic => diagnostic.value)
      .sort();
    assert.deepEqual(duplicateArticles, ['33036', '33040', '34002']);
  }
);
