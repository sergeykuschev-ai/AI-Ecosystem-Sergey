const {
  parseInputRows,
  detectColumns,
} = require('./parsers/minmax_parser');
const { analyzeRows } = require('./services/analyzer');
const {
  buildPurchasingDecisions,
  buildPhase2PurchasingDecisions,
} = require('./services/decision_engine');
const { buildDemandPlan } = require('./services/demand_engine');
const { buildWorkingOrder } = require('./services/working_order');
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

function runOrderAgentFromAdapterResultWithDemand(adapterResult, phase2Inputs = {}) {
  assertUsableAdapterResult(adapterResult);

  const rows = adapterResult.rows;
  const analysis = analyzeRows(rows);
  const phase1DecisionResult = buildPurchasingDecisions(
    analysis,
    adapterResult.diagnostics
  );
  const demandResult = buildDemandPlan(analysis, phase2Inputs);
  const phase2DecisionResult = buildPhase2PurchasingDecisions(
    demandResult,
    adapterResult.diagnostics
  );
  const workingOrderResult = buildWorkingOrder(
    demandResult.products,
    phase2DecisionResult.decisions
  );

  return buildResult(rows, analysis, {
    sourceRowsCount: adapterResult.source.sourceRowsCount,
    detectedColumns: adapterResult.headerPaths,
    additionalResultFields: {
      normalized_product_rows_count: rows.length,
      column_mapping: adapterResult.columnMap,
      adapter_diagnostics: adapterResult.diagnostics,
      phase1DecisionVersion: phase1DecisionResult.decisionVersion,
      phase1Decisions: phase1DecisionResult.decisions,
      phase1DecisionSummary: phase1DecisionResult.summary,
      demandVersion: demandResult.demandVersion,
      demandProducts: demandResult.products,
      demandInputStatus: demandResult.inputStatus,
      ...demandResult.inputStatus,
      missingInputDatasets: demandResult.missingInputDatasets,
      reportWarnings: demandResult.reportWarnings,
      demandDiagnostics: demandResult.diagnostics,
      ...demandResult.summary,
      decisionVersion: phase2DecisionResult.decisionVersion,
      decisions: phase2DecisionResult.decisions,
      ...phase2DecisionResult.summary,
      workingOrderVersion: workingOrderResult.workflowVersion,
      workingOrderProducts: workingOrderResult.products,
      phase1Reconciliation: workingOrderResult.phase1Reconciliation,
      ...workingOrderResult.summary,
    },
  });
}

async function runOrderAgentFromSmartZapasXlsx(filePath) {
  const adapterResult = await readSmartZapasExport(filePath);
  return runOrderAgentFromAdapterResult(adapterResult);
}

async function runOrderAgentFromSmartZapasXlsxWithDemand(filePath, phase2Inputs = {}) {
  const adapterResult = await readSmartZapasExport(filePath);
  return runOrderAgentFromAdapterResultWithDemand(adapterResult, phase2Inputs);
}

const runSmartZapasOrderAgent = runOrderAgentFromSmartZapasXlsx;

module.exports = {
  runOrderAgent,
  runOrderAgentFromAdapterResult,
  runOrderAgentFromAdapterResultWithDemand,
  runOrderAgentFromSmartZapasXlsx,
  runOrderAgentFromSmartZapasXlsxWithDemand,
  runSmartZapasOrderAgent,
};

if (require.main === module) {
  const items = typeof $input !== 'undefined' ? $input.all() : [];
  console.log(JSON.stringify(runOrderAgent(items), null, 2));
}
