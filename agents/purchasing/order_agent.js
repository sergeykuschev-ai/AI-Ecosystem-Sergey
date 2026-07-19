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
const { buildMinmaxText } = require('./services/prompt_builder');
const {
  buildPurchasingFinancialAssessment,
} = require('./services/financial_controller');
const {
  resolveFinancialDataSource,
} = require('./services/financial_data_loader');
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
const { validateInput, validateResult } = require('./services/validator');
const {
  assertUsableAdapterResult,
  readSmartZapasExport,
} = require('./adapters/smartzapas_adapter');

function buildResult(rows, analysis, options = {}) {
  const sourceRowsCount = options.sourceRowsCount ?? rows.length;
  const financialDataResult = resolveFinancialDataSource(options);
  const baseFinancialAssessment = buildPurchasingFinancialAssessment(
    analysis.totalOrderSum,
    financialDataResult.financialData
  );
  const financialContextLines = [
    '### Источник финансовых данных',
    '',
    `- Источник: ${financialDataResult.source}`,
    `- Магазин: ${financialDataResult.metadata.store || 'не указан'}`,
    `- Дата обновления: ${financialDataResult.metadata.updated_at || 'не указана'}`,
  ];
  if (financialDataResult.warnings.length > 0) {
    financialContextLines.push(
      `- Предупреждения: ${financialDataResult.warnings.join('; ')}`
    );
  }
  if (financialDataResult.errors.length > 0) {
    financialContextLines.push('- Финансовая конфигурация не загружена.');
    financialContextLines.push(
      `- Ошибки: ${financialDataResult.errors.join('; ')}`
    );
  }
  const financialAssessment = {
    ...baseFinancialAssessment,
    financial_data_source: financialDataResult.source,
    financial_data_updated_at: financialDataResult.metadata.updated_at,
    financial_data_store: financialDataResult.metadata.store,
    financial_data_warnings: financialDataResult.warnings,
    financial_data_errors: financialDataResult.errors,
    report_text: `${baseFinancialAssessment.report_text}\n\n${financialContextLines.join('\n')}`,
  };
  const purchasingReport = buildMinmaxText(rows, analysis, { sourceRowsCount });
  const reportParts = [purchasingReport];
  if (options.additionalReportText) {
    reportParts.push(options.additionalReportText);
  }
  reportParts.push(financialAssessment.report_text);
  const resultJson = {
    minmax_text: reportParts.join('\n\n'),
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
    financial_assessment: financialAssessment,
  };
  const result = [{ json: resultJson }];

  validateResult(result);
  return result;
}

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
