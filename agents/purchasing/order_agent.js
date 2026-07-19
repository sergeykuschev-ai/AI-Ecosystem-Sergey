const {
  parseInputRows,
  detectColumns,
} = require('./parsers/minmax_parser');
const { analyzeRows } = require('./services/analyzer');
const { buildPurchasingDecisions } = require('./services/decision_engine');
const { buildMinmaxText } = require('./services/prompt_builder');
const { validateInput, validateResult } = require('./services/validator');
const {
  assertUsableAdapterResult,
  readSmartZapasExport,
} = require('./adapters/smartzapas_adapter');

function buildResult(rows, analysis, options = {}) {
  const sourceRowsCount = options.sourceRowsCount ?? rows.length;
  const resultJson = {
    minmax_text: buildMinmaxText(rows, analysis, { sourceRowsCount }),
    source_rows_count: sourceRowsCount,
    product_rows_count: analysis.productRows.length,
    order_rows_count: analysis.orderRows.length,
    zero_stock_rows_count: analysis.confirmedZeroStockCount,
    confirmedZeroStockCount: analysis.confirmedZeroStockCount,
    unknownStockCount: analysis.unknownStockCount,
    zeroStockDaysWithBlankStockCount: analysis.zeroStockDaysWithBlankStockCount,
    preliminary_order_sum: Math.round(analysis.totalOrderSum),
    detected_columns: options.detectedColumns,
    ...options.additionalResultFields,
  };
  const result = [{ json: resultJson }];

  validateResult(result);
  return result;
}

function runOrderAgent(items) {
  validateInput(items);

  const rows = parseInputRows(items);
  const detectedColumns = detectColumns(rows);
  const analysis = analyzeRows(rows);

  return buildResult(rows, analysis, { detectedColumns });
}

function runOrderAgentFromAdapterResult(adapterResult) {
  assertUsableAdapterResult(adapterResult);

  const rows = adapterResult.rows;
  const analysis = analyzeRows(rows);
  const decisionResult = buildPurchasingDecisions(
    analysis,
    adapterResult.diagnostics
  );

  return buildResult(rows, analysis, {
    sourceRowsCount: adapterResult.source.sourceRowsCount,
    detectedColumns: adapterResult.headerPaths,
    additionalResultFields: {
      normalized_product_rows_count: rows.length,
      column_mapping: adapterResult.columnMap,
      adapter_diagnostics: adapterResult.diagnostics,
      decisionVersion: decisionResult.decisionVersion,
      decisions: decisionResult.decisions,
      ...decisionResult.summary,
    },
  });
}

async function runOrderAgentFromSmartZapasXlsx(filePath) {
  const adapterResult = await readSmartZapasExport(filePath);
  return runOrderAgentFromAdapterResult(adapterResult);
}

const runSmartZapasOrderAgent = runOrderAgentFromSmartZapasXlsx;

module.exports = {
  runOrderAgent,
  runOrderAgentFromAdapterResult,
  runOrderAgentFromSmartZapasXlsx,
  runSmartZapasOrderAgent,
};

if (require.main === module) {
  const items = typeof $input !== 'undefined' ? $input.all() : [];
  console.log(JSON.stringify(runOrderAgent(items), null, 2));
}
