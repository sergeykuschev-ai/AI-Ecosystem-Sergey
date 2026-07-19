const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { strToU8, zipSync } = require('fflate');

const {
  NORMALIZED_ROW_SCHEMA,
  adaptSmartZapasMatrix,
  assertUsableAdapterResult,
  deriveRollingWeeklySales,
  normalizeWeeklySalesHistory,
  parseReportTimestampFromFilePath,
  parseWorkbookReportTimestamp,
  parseReportedSalesPeriod,
  reconcileWeeklySalesToCumulative,
  readSmartZapasExport,
  resolveColumns,
  resolveWeeklySalesColumns,
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
  assert.equal(
    adapterResult.source.inventorySemantics.stockBasis,
    'available_free_stock'
  );
  assert.equal(
    adapterResult.source.inventorySemantics.projectionFormula,
    'free_stock + in_transit + recommended_order_qty'
  );
  assert.equal(
    adapterResult.source.inventorySemantics.reserveTreatment,
    'already_excluded_from_free_stock'
  );
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

test('normalizes SmartZapas reported sales only when the period is explicit', () => {
  assert.deepEqual(
    parseReportedSalesPeriod(
      'история за период 12.01.2026 - 19.07.2026 > продано > кол-во'
    ),
    {
      startDate: '2026-01-12',
      endDate: '2026-07-19',
      inclusiveDays: 189,
    }
  );
  assert.equal(parseReportedSalesPeriod('скорость > авто'), null);
  assert.equal(
    parseReportedSalesPeriod(
      'история за период 31.02.2026 - 19.07.2026 > продано > кол-во'
    ),
    null
  );

  assert.ok(adapterResult.rows.every(row => row.reportedSalesQuantity === null));
  assert.ok(adapterResult.rows.every(row => row.reportedSalesPeriodDays === null));
  assert.ok(adapterResult.rows.every(row => row.reportedDailySalesRate === null));
  assert.ok(adapterResult.rows.every(row =>
    Object.hasOwn(row.sourceTokens, 'reportedSalesQuantity') &&
    Object.hasOwn(row.sourceTokens, 'reportedSalesVelocity')
  ));
});

test('parses weekly columns chronologically from header dates and derives 7/14/28 sales', () => {
  const headers = [
    'история по периодам > неделя&#10;с&#10;13.07.26',
    'история по периодам > неделя&#10;с&#10;22.06.26',
    'история по периодам > неделя&#10;с&#10;06.07.26',
    'история по периодам > неделя&#10;с&#10;29.06.26',
  ];
  const columns = resolveWeeklySalesColumns(headers, '2026-07-19');
  const normalized = normalizeWeeklySalesHistory([4, 1, 3, 2], columns);
  const rolling = deriveRollingWeeklySales(normalized.history);

  assert.deepEqual(
    columns.map(column => column.periodStart),
    ['2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13']
  );
  assert.deepEqual(normalized.history.map(period => period.quantity), [1, 2, 3, 4]);
  assert.deepEqual(
    normalized.history.map(period => period.sourceColumn),
    ['B', 'D', 'C', 'A']
  );
  assert.equal(rolling.sales7, 4);
  assert.equal(rolling.sales14, 7);
  assert.equal(rolling.sales28, 10);
  assert.deepEqual(rolling.weeklyPeriodsUsed.sales28, [
    '2026-06-22',
    '2026-06-29',
    '2026-07-06',
    '2026-07-13',
  ]);
});

test('excludes a partial latest week and rejects invalid weekly quantities', () => {
  const headers = [
    'история по периодам > неделя&#10;с&#10;15.06.26',
    'история по периодам > неделя&#10;с&#10;22.06.26',
    'история по периодам > неделя&#10;с&#10;29.06.26',
    'история по периодам > неделя&#10;с&#10;06.07.26',
    'история по периодам > неделя&#10;с&#10;13.07.26',
  ];
  const columns = resolveWeeklySalesColumns(headers, '2026-07-18');
  const normalized = normalizeWeeklySalesHistory([1, 2, -3, 4, 99], columns);
  const rolling = deriveRollingWeeklySales(normalized.history);

  assert.equal(columns.at(-1).completionStatus, 'partial');
  assert.equal(rolling.excludedPartialWeek.periodStart, '2026-07-13');
  assert.equal(rolling.excludedPartialWeek.sourceColumn, 'E');
  assert.equal(rolling.sales7, 4);
  assert.equal(rolling.sales14, null);
  assert.equal(rolling.sales28, null);
  assert.equal(normalized.history[2].quantity, null);
  assert.equal(
    normalized.warnings[0].warning,
    'invalid_negative_or_non_finite_weekly_sales_quantity'
  );
});

test('uses report timestamp to exclude an unfinished final calendar day', () => {
  const headers = [
    'история по периодам > неделя&#10;с&#10;06.07.26',
    'история по периодам > неделя&#10;с&#10;13.07.26',
  ];
  const dateOnlyColumns = resolveWeeklySalesColumns(headers, '2026-07-19');
  const timestampColumns = resolveWeeklySalesColumns(
    headers,
    '2026-07-19',
    '2026-07-19T06:00:53'
  );

  assert.equal(dateOnlyColumns.at(-1).completionStatus, 'completed');
  assert.equal(timestampColumns.at(-1).completionStatus, 'partial');
  assert.equal(timestampColumns[0].completionStatus, 'completed');
  assert.equal(
    parseReportTimestampFromFilePath(
      '/reports/SmartZapas_2026-07-19 06-00-53.xlsx'
    ),
    '2026-07-19T06:00:53'
  );
});

test('reads the report timestamp from XLSX workbook core properties', () => {
  const workbookBytes = zipSync({
    'docProps/core.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<cp:coreProperties xmlns:cp="core" xmlns:dcterms="terms">' +
      '<dcterms:created>2026-07-19T06:00:53Z</dcterms:created>' +
      '</cp:coreProperties>'
    ),
  });

  assert.equal(
    parseWorkbookReportTimestamp(workbookBytes),
    '2026-07-19T06:00:53'
  );
});

test('uses workbook timestamp metadata before an explicit report date', () => {
  const result = adaptSmartZapasMatrix(sanitizedFixture.matrix, {
    sheetName: sanitizedFixture.sheetName,
    reportTimestamp: '2026-07-19T06:00:53',
    reportTimestampSource: 'workbook_core_properties',
    reportDate: '2026-07-20',
  });

  assert.equal(result.source.reportDate, '2026-07-19');
  assert.equal(result.source.reportDateSource, 'workbook_core_properties');
  assert.equal(result.source.reportTimestamp, '2026-07-19T06:00:53');
});

test('uses an explicit report date only when filename and workbook date are unavailable', () => {
  const result = adaptSmartZapasMatrix(sanitizedFixture.matrix, {
    sheetName: sanitizedFixture.sheetName,
    reportDate: '2026-07-19',
  });

  assert.equal(result.source.reportDate, '2026-07-19');
  assert.equal(result.source.reportDateSource, 'explicit_report_date');
  assert.equal(result.source.reportTimestamp, null);
});

test('warns instead of guessing when weekly completion date is unavailable', () => {
  const matrixWithWeeklyHistory = sanitizedFixture.matrix.map((row, index) => [
    ...row,
    index === 0
      ? 'История по периодам'
      : index === 1
        ? 'Неделя\nс\n06.07.26'
        : null,
  ]);
  const result = adaptSmartZapasMatrix(matrixWithWeeklyHistory, {
    sheetName: sanitizedFixture.sheetName,
  });

  assert.equal(result.source.reportDate, null);
  assert.equal(result.source.reportDateSource, 'unavailable');
  assert.ok(result.diagnostics.reportDateWarnings.some(
    warning => warning.warning === 'weekly_history_report_date_unavailable'
  ));
  assert.equal(
    result.source.weeklySalesMetadata.excludedPeriods[0].completionStatus,
    'unknown'
  );
});

test('confirmed weekly blanks become zero while invalid values remain unavailable', () => {
  const headers = [
    'история по периодам > неделя&#10;с&#10;15.06.26',
    'история по периодам > неделя&#10;с&#10;22.06.26',
    'история по периодам > неделя&#10;с&#10;29.06.26',
    'история по периодам > неделя&#10;с&#10;06.07.26',
  ];
  const columns = resolveWeeklySalesColumns(headers, '2026-07-12');
  const zeroHistory = normalizeWeeklySalesHistory(
    [null, '', null, null],
    columns,
    { blankCompletedAsZero: true }
  );
  const invalidHistory = normalizeWeeklySalesHistory(
    [null, 'invalid', null, null],
    columns,
    { blankCompletedAsZero: true }
  );
  const zeroRolling = deriveRollingWeeklySales(zeroHistory.history);
  const invalidRolling = deriveRollingWeeklySales(invalidHistory.history);

  assert.ok(zeroHistory.history.every(period =>
    period.quantity === 0 && period.valueState === 'blank_as_confirmed_zero'
  ));
  assert.equal(zeroRolling.sales7, 0);
  assert.equal(zeroRolling.sales14, 0);
  assert.equal(zeroRolling.sales28, 0);
  assert.equal(invalidHistory.history[1].quantity, null);
  assert.equal(invalidHistory.history[1].valueState, 'invalid_value');
  assert.equal(invalidRolling.sales28, null);
});

test('weekly totals reconcile to cumulative sales before blank-as-zero is enabled', () => {
  const headers = [
    'история по периодам > неделя&#10;с&#10;06.07.26',
    'история по периодам > неделя&#10;с&#10;13.07.26',
    'история за период 06.07.2026 - 19.07.2026 > продано > кол-во',
  ];
  const columns = resolveWeeklySalesColumns(headers, '2026-07-19');
  const reconciliation = reconcileWeeklySalesToCumulative(
    [
      { rowNumber: 4, name: 'One', row: [null, 2, 2] },
      { rowNumber: 5, name: 'Two', row: [3, null, 3] },
      { rowNumber: 6, name: 'Zero', row: [null, null, null] },
    ],
    columns,
    { index: 2 }
  );

  assert.equal(reconciliation.diagnostic.exactMatches, 3);
  assert.equal(reconciliation.diagnostic.toleranceMatches, 0);
  assert.equal(reconciliation.diagnostic.mismatches, 0);
  assert.equal(reconciliation.diagnostic.blankCellSemanticsConfirmed, true);
  assert.equal(reconciliation.diagnostic.blankWeeklyCellCount, 4);
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

  const invalidWeeklyResult = structuredClone(adapterResult);
  invalidWeeklyResult.rows[0].sales7 = -1;
  assert.throws(
    () => assertUsableAdapterResult(invalidWeeklyResult),
    /invalid sales7/
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
      { purchasingProfile: 'miska' }
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
    assert.equal(realAdapterResult.columnMap.sales.column, 'AJ');
    assert.equal(
      realAdapterResult.columnMap.sales.header,
      'история за период 12.01.2026 - 19.07.2026 > продано > кол-во'
    );
    assert.equal(realAdapterResult.columnMap.daysAvailable.column, 'AO');
    assert.equal(realAdapterResult.columnMap.speed.column, 'AP');
    assert.equal(realAdapterResult.columnMap.speed.header, 'скорость > авто');
    assert.equal(realAdapterResult.columnMap.stockDays.column, 'AQ');
    assert.equal(realAdapterResult.columnMap.stockDays.header, 'текущие остатки > дней запаса');
    assert.equal(
      realAdapterResult.rows.filter(row => row.reportedSalesQuantity !== null).length,
      352
    );
    assert.equal(
      realAdapterResult.rows.filter(row => row.reportedDailySalesRate !== null).length,
      352
    );
    assert.ok(realAdapterResult.rows
      .filter(row => row.reportedDailySalesRate !== null)
      .every(row =>
        row.reportedSalesPeriodDays === 189 &&
        row.reportedSalesRateSource === 'smartzapas_period_sales_explicit_days' &&
        row.reportedSalesRateConfidence === 'high'
      ));
    assert.equal(
      realAdapterResult.rows.filter(row => row.sourceTokens.reportedSalesVelocity !== null).length,
      253
    );
    assert.equal(realAdapterResult.source.reportDate, '2026-07-19');
    assert.equal(realAdapterResult.source.weeklySalesMetadata.dateSemantics, 'period_start');
    assert.equal(realAdapterResult.source.weeklySalesMetadata.detectedPeriodCount, 27);
    assert.equal(
      realAdapterResult.source.reportTimestamp,
      '2026-07-19T06:00:53'
    );
    assert.equal(realAdapterResult.source.weeklySalesMetadata.completedPeriodCount, 26);
    assert.equal(
      realAdapterResult.source.weeklySalesMetadata.completedPeriodStarts.at(-1),
      '2026-07-06'
    );
    assert.deepEqual(realAdapterResult.source.weeklySalesMetadata.excludedPeriods, [
      {
        periodStart: '2026-07-13',
        periodEnd: '2026-07-19',
        sourceColumn: 'AI',
        completionStatus: 'partial',
      },
    ]);
    assert.equal(
      realAdapterResult.diagnostics.weeklySalesReconciliation.exactMatches,
      403
    );
    assert.equal(
      realAdapterResult.diagnostics.weeklySalesReconciliation.toleranceMatches,
      0
    );
    assert.equal(
      realAdapterResult.diagnostics.weeklySalesReconciliation.mismatches,
      0
    );
    assert.equal(
      realAdapterResult.diagnostics.weeklySalesReconciliation.blankCellSemantics,
      'confirmed_zero'
    );
    assert.equal(
      realAdapterResult.rows.filter(row =>
        row.weeklySalesHistory.some(period => period.quantity !== null)
      ).length,
      403
    );
    assert.ok(realAdapterResult.diagnostics.salesSemanticsWarnings.some(
      diagnostic =>
        diagnostic.field === 'speed' &&
        diagnostic.warning === 'reported_sales_velocity_unit_not_declared' &&
        diagnostic.action === 'preserved_raw_not_converted_to_daily_rate'
    ));
    assert.equal(realPhase2Result.source_rows_count, 475);
    assert.equal(realPhase2Result.product_rows_count, 403);
    assert.equal(realPhase2Result.order_rows_count, 127);
    assert.equal(realPhase2Result.preliminary_order_sum, 89160);
    assert.equal(realPhase2Result.demandProducts.length, 403);
    assert.equal(realPhase2Result.decisions.length, 403);
    assert.equal(realPhase2Result.productsWithSalesData, 403);
    assert.equal(realPhase2Result.productsMissingAllSales, 0);
    assert.equal(realPhase2Result.productsWithPeriodSales, 403);
    assert.equal(realPhase2Result.productsWithReportedDailyRate, 352);
    assert.equal(realPhase2Result.productsUsingWeightedSales, 403);
    assert.equal(realPhase2Result.productsUsingSmartZapasRate, 403);
    assert.equal(realPhase2Result.productsMissingUsableSalesInput, 0);
    assert.equal(realPhase2Result.productsWithWeeklyHistory, 403);
    assert.equal(realPhase2Result.productsWithSales7, 403);
    assert.equal(realPhase2Result.productsWithSales14, 403);
    assert.equal(realPhase2Result.productsWithSales28, 403);
    assert.equal(realPhase2Result.productsUsingWeeklyWeightedRate, 403);
    assert.equal(realPhase2Result.productsUsingCumulativeFallback, 0);
    assert.equal(realPhase2Result.productsWithPartialLatestWeekExcluded, 403);
    assert.equal(realPhase2Result.productsMissingUsableSales, 0);
    assert.equal(realPhase2Result.blankWeeklyCellsInterpretedAsZero, 7665);
    assert.equal(realPhase2Result.weeklyToCumulativeExactMatches, 403);
    assert.equal(realPhase2Result.weeklyToCumulativeToleranceMatches, 0);
    assert.equal(realPhase2Result.weeklyToCumulativeMismatches, 0);
    assert.deepEqual(realPhase2Result.excludedPartialWeek, {
      periodStart: '2026-07-13',
      periodEnd: '2026-07-19',
      sourceColumn: 'AI',
      sourceHeader: 'история по периодам > неделя&#10;с&#10;13.07.26',
      reason: 'report_date_before_expected_seven_day_window_end',
    });
    assert.equal(realPhase2Result.assortmentMatrixStatus, 'not_provided');
    assert.equal(realPhase2Result.purchasingProfile, 'miska');
    assert.equal(realPhase2Result.inTransitMode, 'included_in_source_stock');
    assert.equal(realPhase2Result.inTransitSourceStatus, 'included_in_source_stock');
    assert.equal(
      realPhase2Result.inTransitDecisionBasis,
      'previous_order_registered_as_expected_receipt'
    );
    assert.equal(realPhase2Result.sourceStockIncludesExpectedReceipts, 'assumed');
    assert.equal(realPhase2Result.phase2ResultStatus, 'preliminary');
    assert.deepEqual(realPhase2Result.reportWarnings, [
      'Verify that SmartZapas free stock or analyzer recommendation reflects expected receipts',
    ]);
    assert.equal(realPhase2Result.demandQuantitiesCalculated, 291);
    assert.equal(realPhase2Result.finalQuantitiesCalculated, 291);
    assert.equal(realPhase2Result.demandOrderLines, 55);
    assert.equal(realPhase2Result.demandOrderSum, 77695.94);
    assert.equal(realPhase2Result.finalApprovedLines, 82);
    assert.equal(realPhase2Result.finalApprovedSum, 89742.05);
    assert.equal(realPhase2Result.autoApprovedLines, 82);
    assert.equal(realPhase2Result.autoApprovedSum, 89742.05);
    assert.equal(realPhase2Result.pendingReviewLines, 39);
    assert.equal(realPhase2Result.pendingReviewProvisionalSum, 32507.57);
    assert.equal(realPhase2Result.postponedLines, 4);
    assert.equal(realPhase2Result.postponedProvisionalSum, 458.42);
    assert.equal(realPhase2Result.confidentlyExcludedLines, 7);
    assert.equal(realPhase2Result.confidentlyExcludedPhase1Value, 1225.7);
    assert.equal(realPhase2Result.workingMaximumLines, 121);
    assert.equal(realPhase2Result.workingMaximumSum, 122249.62);
    assert.equal(
      realPhase2Result.workingMaximumStatus,
      'not_approved_not_ready_for_automatic_submission'
    );
    assert.equal(realPhase2Result.phase2AdditionLines, 5);
    assert.equal(realPhase2Result.phase2AdditionApprovedLines, 3);
    assert.equal(realPhase2Result.phase2AdditionPendingReviewLines, 2);
    assert.equal(realPhase2Result.mustBuyCount, 37);
    assert.equal(realPhase2Result.recommendedCount, 45);
    assert.equal(realPhase2Result.manualReviewCount, 122);
    assert.equal(realPhase2Result.postponeCount, 4);
    assert.equal(realPhase2Result.doNotBuyCount, 195);
    assert.equal(realPhase2Result.provisionalNoActionCount, 0);
    assert.equal(realPhase2Result.positiveAnalyzerLinesAwaitingData, 29);
    assert.deepEqual(
      realPhase2Result.demandProducts.map(product =>
        product.analyzerCalculatedQuantity
      ),
      realAdapterResult.rows.map(row => row.orderQty)
    );
    assert.equal(realPhase2Result.phase1Reconciliation.auto_approved.lines, 79);
    assert.equal(
      realPhase2Result.phase1Reconciliation.auto_approved.phase1Value,
      69206.58
    );
    assert.equal(
      realPhase2Result.phase1Reconciliation.pending_manual_review.lines,
      37
    );
    assert.equal(
      realPhase2Result.phase1Reconciliation.pending_manual_review.phase1Value,
      18268.98
    );
    assert.equal(realPhase2Result.phase1Reconciliation.postponed.lines, 4);
    assert.equal(
      realPhase2Result.phase1Reconciliation.postponed.phase1Value,
      458.42
    );
    assert.equal(
      realPhase2Result.phase1Reconciliation.confidently_excluded.lines,
      7
    );
    assert.equal(
      realPhase2Result.phase1Reconciliation.confidently_excluded.phase1Value,
      1225.7
    );
    assert.equal(realPhase2Result.phase1Reconciliation.totalLines, 127);
    assert.equal(realPhase2Result.phase1Reconciliation.precisePhase1Value, 89159.68);
    assert.equal(realPhase2Result.phase1Reconciliation.reconciledLines, 127);
    assert.equal(realPhase2Result.phase1Reconciliation.reconciledValue, 89159.68);
    assert.equal(realPhase2Result.phase1Reconciliation.reconciledExactly, true);
    const reconciledIdentities = [
      ...realPhase2Result.phase1Reconciliation.auto_approved.rowIdentities,
      ...realPhase2Result.phase1Reconciliation.pending_manual_review.rowIdentities,
      ...realPhase2Result.phase1Reconciliation.postponed.rowIdentities,
      ...realPhase2Result.phase1Reconciliation.confidently_excluded.rowIdentities,
    ];
    assert.equal(reconciledIdentities.length, 127);
    assert.equal(new Set(reconciledIdentities).size, 127);
    const pendingWorkflowLines = realPhase2Result.workingOrderProducts.filter(
      product => product.workflowStatus === 'pending_manual_review'
    );
    assert.equal(pendingWorkflowLines.length, 39);
    assert.ok(pendingWorkflowLines.every(product =>
      product.provisionalOrderQuantity > 0 &&
      product.provisionalLineSum > 0 &&
      product.approvalRequired === true &&
      product.approvedOrderQuantity === null
    ));
    assert.equal(pendingWorkflowLines.filter(product =>
      product.provisionalQuantitySource === 'phase1_analyzer_fallback'
    ).length, 29);
    assert.equal(pendingWorkflowLines.filter(product =>
      product.provisionalQuantitySource === 'phase2_final_recommendation'
    ).length, 10);
    assert.equal(
      realPhase2Result.demandProducts.filter(
        product => product.finalRecommendedQuantity !== null
      ).length,
      291
    );
    assert.ok(realPhase2Result.demandProducts.every(product =>
      product.inTransitQuantity === 0 &&
      product.inTransitStatus === 'included_in_source_stock' &&
      product.inTransitDecisionBasis ===
        'previous_order_registered_as_expected_receipt' &&
      !product.requiredData.includes('in_transit_quantity')
    ));
    assert.ok(!realPhase2Result.missingInputDatasets.some(
      dataset => dataset.dataset === 'in_transit_data'
    ));

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
