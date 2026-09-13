const { guardUnmatchedProduct, buildAmbiguousAssortmentIndex } = require('./services/unmatched_product_guard');
const {
  resolveActiveOwnerOrderDecisions,
  applyActiveOwnerOrderDecision,
} = require('./services/active_owner_order_decisions');
const {
  loadVerifiedOwnerSessionIds,
  applyVerifiedOwnerTestPolicy,
} = require('./services/verified_owner_test_policy');
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
const {
  applyAssortmentPolicyToProducts,
} = require('./services/assortment_policy');
const {
  collectReportSupplierGroups,
} = require('./services/supplier_scope');
const {
  DEFAULT_CANONICAL_MATRIX_PATH,
  loadAssortmentPolicySource,
} = require('./services/assortment_policy_store');
const {
  loadProductAliases,
  buildAliasIndex,
  DEFAULT_ALIAS_PATH,
} = require('./services/product_alias_resolver');
const {
  applyMinMaxSafetyGuard,
} = require('./services/minmax_safety_guard');
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
  const guardedAdapterResult = applyMinMaxSafetyGuard(adapterResult);

  const rows = guardedAdapterResult.rows;
  const analysis = analyzeRows(rows);
  const decisionResult = buildPurchasingDecisions(
    analysis,
    guardedAdapterResult.diagnostics
  );

  return buildResult(rows, analysis, {
    sourceRowsCount: guardedAdapterResult.source.sourceRowsCount,
    detectedColumns: guardedAdapterResult.headerPaths,
    financialData: options.financialData,
    financialDataPath: options.financialDataPath,
    additionalResultFields: {
      normalized_product_rows_count: rows.length,
      adapter_source: guardedAdapterResult.source,
      column_mapping: guardedAdapterResult.columnMap,
      adapter_diagnostics: guardedAdapterResult.diagnostics,
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
  const guardedAdapterResult = applyMinMaxSafetyGuard(adapterResult);

  const rows = guardedAdapterResult.rows;
  const analysis = analyzeRows(rows);
  const reportSupplierGroups = collectReportSupplierGroups(rows);
  const phase1DecisionResult = buildPurchasingDecisions(
    analysis,
    guardedAdapterResult.diagnostics
  );
  const resolvedPhase2Inputs = { ...phase2Inputs };
  let assortmentContext = null;
  if (options.assortmentMatrixPath && !resolvedPhase2Inputs.assortmentMatrix) {
    const loaded = loadAssortmentMatrix(options.assortmentMatrixPath);
    const aliasIndex = buildAliasIndex(
      loadProductAliases(options.productAliasesPath || DEFAULT_ALIAS_PATH)
    );
    const matchResult = matchAssortmentMatrix(loaded.matrix, rows, { aliasIndex });
    resolvedPhase2Inputs.assortmentMatrix = buildDemandAssortmentSource(
      loaded.matrix,
      rows,
      matchResult
    );
    resolvedPhase2Inputs.assortmentMatrixMode =
      resolvedPhase2Inputs.assortmentMatrixMode || 'required';
    assortmentContext = { ...loaded, matchResult };
  }
  if (!resolvedPhase2Inputs.inventorySemantics) {
    resolvedPhase2Inputs.inventorySemantics = guardedAdapterResult.source.inventorySemantics;
  }
  const demandResult = buildDemandPlan(analysis, resolvedPhase2Inputs);
  const policy = loadAssortmentPolicySource({
    canonicalPath: options.canonicalAssortmentMatrixPath ||
      (options.assortmentPolicyPath ? null : DEFAULT_CANONICAL_MATRIX_PATH),
    legacyPath: options.assortmentPolicyPath || undefined,
  });
  const policyProducts = applyAssortmentPolicyToProducts(
    demandResult.products,
    policy.store,
    {
      runId: options.runId || null,
      currentDate: options.currentDate,
      reportSupplierGroups,
    }
  );
  const policyDemandResult = {
    ...demandResult,
    products: policyProducts,
  };
  let phase2DecisionResult = buildPhase2PurchasingDecisions(
    policyDemandResult,
    guardedAdapterResult.diagnostics
  );
  let demandProducts = policyProducts;
  let assortmentControl = null;
  let assortmentReport = null;
  if (assortmentContext) {
    assortmentControl = applyAssortmentMatrixControl({
      analysis,
      demandProducts,
      decisions: phase2DecisionResult.decisions,
      matrix: assortmentContext.matrix,
      matchResult: assortmentContext.matchResult,
      inventoryModel: guardedAdapterResult.source.inventorySemantics,
      reportSupplierGroups,
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
  const decisionsByIdentity = new Map(phase2DecisionResult.decisions.map(
    decision => [decision.rowIdentity, decision]
  ));
  const ambiguousAssortment = buildAmbiguousAssortmentIndex([
    ...(assortmentContext?.matchResult.itemResults || []),
    ...(demandResult.diagnostics.assortmentMatches || []),
  ]);
  const activeOwnerOrders = resolveActiveOwnerOrderDecisions(demandProducts, {
    ownerDecisionsPath: options.ownerDecisionsPath,
    now: options.ownerDecisionNow,
  });
  const verifiedOwnerSessionIds = loadVerifiedOwnerSessionIds({
    registryPath: options.ownerReviewSessionsPath,
  });
  let verifiedOwnerTestPolicyApplied = 0;
  const guardedPairs = demandProducts.map(product => {
    const verifiedTestPair = applyVerifiedOwnerTestPolicy(
      product,
      decisionsByIdentity.get(product.rowIdentity),
      {
        verifiedSessionIds: verifiedOwnerSessionIds,
        currentDate: options.reportDate || options.currentDate || options.ownerDecisionNow,
      }
    );
    if (verifiedTestPair.applied) verifiedOwnerTestPolicyApplied += 1;
    const ownerPair = applyActiveOwnerOrderDecision(
      verifiedTestPair.product,
      verifiedTestPair.decision,
      activeOwnerOrders.byRowIdentity.get(product.rowIdentity)
    );
    return guardUnmatchedProduct(
      ownerPair.product,
      ownerPair.decision,
      ambiguousAssortment.get(product.rowIdentity)
    );
  });
  demandProducts = guardedPairs.map(pair => pair.product);
  phase2DecisionResult = {
    ...phase2DecisionResult,
    decisions: guardedPairs.map(pair => pair.decision),
    summary: summarizePhase2Decisions(
      guardedPairs.map(pair => pair.decision), demandProducts
    ),
  };
  const workingOrderResult = buildWorkingOrder(
    demandProducts,
    phase2DecisionResult.decisions
  );

  return buildResult(rows, analysis, {
    sourceRowsCount: guardedAdapterResult.source.sourceRowsCount,
    detectedColumns: guardedAdapterResult.headerPaths,
    financialData: options.financialData,
    financialDataPath: options.financialDataPath,
    proposedOrderAmount: workingOrderResult.summary.workingMaximumSum,
    orderSummary: workingOrderResult.summary,
    additionalReportText: assortmentReport,
    additionalResultFields: {
      normalized_product_rows_count: rows.length,
      adapter_source: guardedAdapterResult.source,
      column_mapping: guardedAdapterResult.columnMap,
      adapter_diagnostics: guardedAdapterResult.diagnostics,
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
      activeOwnerOrderDecisionSummary: activeOwnerOrders.summary,
      verifiedOwnerTestPolicySummary: {
        verifiedSessions: verifiedOwnerSessionIds.size,
        applied: verifiedOwnerTestPolicyApplied,
      },
      workingOrderVersion: workingOrderResult.workflowVersion,
      workingOrderProducts: workingOrderResult.products,
      phase1Reconciliation: workingOrderResult.phase1Reconciliation,
      ...workingOrderResult.summary,
      ...(assortmentControl
        ? {
          assortment_matrix_summary: assortmentControl.summary,
          missing_matrix_items: assortmentControl.missingMatrixItems,
          out_of_scope_matrix_items: assortmentControl.outOfScopeMatrixItems,
          supplier_unassigned_matrix_items: assortmentControl.supplierUnassignedItems,
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
