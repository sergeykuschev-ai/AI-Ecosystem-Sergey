const {
  parseInputRows,
  detectColumns,
} = require('./parsers/minmax_parser');
const { analyzeRows } = require('./services/analyzer');
const {
  buildPurchasingDecisions,
  buildPhase2PurchasingDecisions,
  summarizePhase2Decisions,
} = require('./services/decision_engine');
const { buildDemandPlan } = require('./services/demand_engine');
const { buildWorkingOrder } = require('./services/working_order');
const {
  loadAssortmentMatrix,
  matchAssortmentMatrix,
  buildDemandAssortmentSource,
} = require('./services/assortment_matrix_loader');
const {
  applyAssortmentMatrixControl,
} = require('./services/assortment_matrix_controller');
const {
  buildAssortmentMatrixReport,
} = require('./services/assortment_matrix_report');
const { validateInput } = require('./services/validator');
const { buildResult } = require('./services/result_assembly');
const {
  assertUsableAdapterResult,
  readSmartZapasExport,
} = require('./adapters/smartzapas_adapter');

function runOrderAgent(items, options = {}) {
  validateInput(items);

  const rows = parseInputRows(items);
  const detectedColumns = detectColumns(rows);
  const analysis = analyzeRows(rows);

  return buildResult(rows, analysis, {
    detectedColumns,
    financialData: options.financialData,
    financialDataPath: options.financialDataPath,
  });
}

function runOrderAgentFromAdapterResult(adapterResult, options = {}) {
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
    financialData: options.financialData,
    financialDataPath: options.financialDataPath,
    additionalResultFields: {
      normalized_product_rows_count: rows.length,
      adapter_source: adapterResult.source,
      column_mapping: adapterResult.columnMap,
      adapter_diagnostics: adapterResult.diagnostics,
      decisionVersion: decisionResult.decisionVersion,
      decisions: decisionResult.decisions,
      ...decisionResult.summary,
    },
  });
}

function runOrderAgentFromAdapterResultWithDemand(
  adapterResult,
  phase2Inputs = {},
  options = {}
) {
  assertUsableAdapterResult(adapterResult);

  const rows = adapterResult.rows;
  const analysis = analyzeRows(rows);
  const phase1DecisionResult = buildPurchasingDecisions(
    analysis,
    adapterResult.diagnostics
  );
  const resolvedPhase2Inputs = { ...phase2Inputs };
  let assortmentContext = null;
  if (options.assortmentMatrixPath && !resolvedPhase2Inputs.assortmentMatrix) {
    const loaded = loadAssortmentMatrix(options.assortmentMatrixPath);
    const matchResult = matchAssortmentMatrix(loaded.matrix, rows);
    resolvedPhase2Inputs.assortmentMatrix = buildDemandAssortmentSource(
      loaded.matrix,
      rows,
      matchResult
    );
    resolvedPhase2Inputs.assortmentMatrixMode =
      resolvedPhase2Inputs.assortmentMatrixMode || 'required';
    assortmentContext = { ...loaded, matchResult };
  }
  const demandResult = buildDemandPlan(analysis, resolvedPhase2Inputs);
  let phase2DecisionResult = buildPhase2PurchasingDecisions(
    demandResult,
    adapterResult.diagnostics
  );
  let demandProducts = demandResult.products;
  let assortmentControl = null;
  let assortmentReport = null;
  if (assortmentContext) {
    assortmentControl = applyAssortmentMatrixControl({
      analysis,
      demandProducts,
      decisions: phase2DecisionResult.decisions,
      matrix: assortmentContext.matrix,
      matchResult: assortmentContext.matchResult,
      inventoryModel: adapterResult.source.inventorySemantics,
    });
    demandProducts = assortmentControl.products;
    phase2DecisionResult = {
      ...phase2DecisionResult,
      decisions: assortmentControl.decisions,
      summary: summarizePhase2Decisions(
        assortmentControl.decisions,
        assortmentControl.products
      ),
    };
    assortmentReport = buildAssortmentMatrixReport(assortmentControl);
  }
  const workingOrderResult = buildWorkingOrder(
    demandProducts,
    phase2DecisionResult.decisions
  );

  return buildResult(rows, analysis, {
    sourceRowsCount: adapterResult.source.sourceRowsCount,
    detectedColumns: adapterResult.headerPaths,
    financialData: options.financialData,
    financialDataPath: options.financialDataPath,
    additionalReportText: assortmentReport,
    additionalResultFields: {
      normalized_product_rows_count: rows.length,
      adapter_source: adapterResult.source,
      column_mapping: adapterResult.columnMap,
      adapter_diagnostics: adapterResult.diagnostics,
      phase1DecisionVersion: phase1DecisionResult.decisionVersion,
      phase1Decisions: phase1DecisionResult.decisions,
      phase1DecisionSummary: phase1DecisionResult.summary,
      demandVersion: demandResult.demandVersion,
      demandProducts,
      demandInputStatus: demandResult.inputStatus,
      ...demandResult.inputStatus,
      missingInputDatasets: demandResult.missingInputDatasets,
      reportWarnings: [
        ...demandResult.reportWarnings,
        ...(assortmentControl?.warnings || []),
      ],
      demandDiagnostics: demandResult.diagnostics,
      ...demandResult.summary,
      decisionVersion: phase2DecisionResult.decisionVersion,
      decisions: phase2DecisionResult.decisions,
      ...phase2DecisionResult.summary,
      workingOrderVersion: workingOrderResult.workflowVersion,
      workingOrderProducts: workingOrderResult.products,
      phase1Reconciliation: workingOrderResult.phase1Reconciliation,
      ...workingOrderResult.summary,
      ...(assortmentControl
        ? {
          assortment_matrix_summary: assortmentControl.summary,
          missing_matrix_items: assortmentControl.missingMatrixItems,
          assortment_matrix_warnings: assortmentControl.warnings,
        }
        : {}),
    },
  });
}

async function runOrderAgentFromSmartZapasXlsx(filePath, options = {}) {
  const adapterResult = await readSmartZapasExport(filePath, {
    reportDate: options.reportDate,
    reportTimestamp: options.reportTimestamp,
  });
  return runOrderAgentFromAdapterResult(adapterResult, options);
}

async function runOrderAgentFromSmartZapasXlsxWithDemand(
  filePath,
  phase2Inputs = {},
  options = {}
) {
  const adapterResult = await readSmartZapasExport(filePath, {
    reportDate: options.reportDate,
    reportTimestamp: options.reportTimestamp,
  });
  return runOrderAgentFromAdapterResultWithDemand(
    adapterResult,
    phase2Inputs,
    options
  );
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
