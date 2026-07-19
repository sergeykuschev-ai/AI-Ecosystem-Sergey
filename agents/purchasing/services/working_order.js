const WORKFLOW_STATUSES = Object.freeze([
  'auto_approved',
  'pending_manual_review',
  'postponed',
  'confidently_excluded',
  'no_order_action',
]);

const PROVISIONAL_QUANTITY_SOURCES = Object.freeze([
  'phase2_final_recommendation',
  'phase1_analyzer_fallback',
  'unavailable',
]);

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isPositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function lineSum(quantity, price) {
  if (!isPositive(quantity) || !isPositive(price)) return quantity > 0 ? null : 0;
  return roundCurrency(quantity * price);
}

function provisionalQuantity(product) {
  if (isPositive(product.finalRecommendedQuantity)) {
    return {
      provisionalOrderQuantity: product.finalRecommendedQuantity,
      provisionalQuantitySource: 'phase2_final_recommendation',
    };
  }
  if (isPositive(product.analyzerCalculatedQuantity)) {
    return {
      provisionalOrderQuantity: product.analyzerCalculatedQuantity,
      provisionalQuantitySource: 'phase1_analyzer_fallback',
    };
  }
  return {
    provisionalOrderQuantity: null,
    provisionalQuantitySource: 'unavailable',
  };
}

function isConfidentNoBuy(product, decision) {
  return (
    isPositive(product.analyzerCalculatedQuantity) &&
    decision.decision === 'do_not_buy' &&
    decision.decisionBasis === 'phase2_calculated' &&
    product.finalRecommendedQuantity !== null &&
    decision.requiredData.length === 0
  );
}

function workflowStatus(product, decision) {
  if (
    ['must_buy', 'recommended'].includes(decision.decision) &&
    isPositive(decision.approvedOrderQuantity)
  ) return 'auto_approved';
  if (decision.decision === 'postpone') return 'postponed';
  if (
    decision.decision === 'manual_review' &&
    (
      isPositive(product.analyzerCalculatedQuantity) ||
      isPositive(product.finalRecommendedQuantity)
    )
  ) return 'pending_manual_review';
  if (isConfidentNoBuy(product, decision)) return 'confidently_excluded';
  if (
    !isPositive(product.analyzerCalculatedQuantity) &&
    !isPositive(product.finalRecommendedQuantity) &&
    decision.decision !== 'manual_review'
  ) return 'no_order_action';
  if (
    isPositive(product.analyzerCalculatedQuantity) ||
    isPositive(product.finalRecommendedQuantity)
  ) return 'pending_manual_review';
  return null;
}

function blockingReason(product, decision, status) {
  if (status !== 'pending_manual_review') return null;
  if (decision.requiredData.includes('free_stock')) return 'free_stock_unknown';
  const explicitReason = decision.reasons.find(reason =>
    reason !== 'final_quantity_unavailable' && !reason.startsWith('quantity_reason:')
  );
  if (explicitReason) return explicitReason;
  if (decision.requiredData.length > 0) {
    return `required_data:${decision.requiredData.join('+')}`;
  }
  if (product.finalRecommendedQuantity === null) return 'final_quantity_unavailable';
  return decision.decisionBasis || 'manual_review_required';
}

function buildWorkflowProduct(product, decision) {
  const status = workflowStatus(product, decision);
  const provisional = ['pending_manual_review', 'postponed'].includes(status)
    ? provisionalQuantity(product)
    : {
      provisionalOrderQuantity: null,
      provisionalQuantitySource: 'unavailable',
    };
  const phase1Quantity = product.analyzerCalculatedQuantity;
  const phase2Addition = !isPositive(phase1Quantity) && (
    status === 'auto_approved' ||
    status === 'pending_manual_review' ||
    status === 'postponed'
  ) && (
    isPositive(product.finalRecommendedQuantity) ||
    isPositive(decision.approvedOrderQuantity)
  );

  return {
    rowIdentity: product.rowIdentity,
    rowNumber: product.rowNumber,
    name: product.name,
    article: product.article,
    barcode: product.matchingHints?.barcode || null,
    internalProductId: product.matchingHints?.internalProductId || null,
    supplier: product.supplier,
    abc: product.abc,
    xyz: product.xyz,
    priceNum: product.priceNum,
    workflowStatus: status,
    workflowStatusReason: status === null
      ? 'unresolved_data_without_positive_order_quantity'
      : null,
    phase1OrderRelevant: isPositive(phase1Quantity),
    phase2Addition,
    analyzerCalculatedQuantity: phase1Quantity,
    demandCalculatedQuantity: product.demandCalculatedQuantity,
    finalRecommendedQuantity: product.finalRecommendedQuantity,
    approvedOrderQuantity: decision.approvedOrderQuantity,
    provisionalOrderQuantity: provisional.provisionalOrderQuantity,
    provisionalQuantitySource: provisional.provisionalQuantitySource,
    provisionalLineSum: lineSum(
      provisional.provisionalOrderQuantity,
      product.priceNum
    ),
    approvedLineSum: lineSum(decision.approvedOrderQuantity, product.priceNum),
    phase1LineSum: lineSum(phase1Quantity, product.priceNum),
    blockingReason: blockingReason(product, decision, status),
    approvalRequired: status === 'pending_manual_review',
    phase2Decision: decision.decision,
    decisionBasis: decision.decisionBasis,
    decisionReasons: [...decision.reasons],
    decisionWarnings: [...decision.warnings],
    requiredData: [...decision.requiredData],
    freeStock: product.freeStock,
    stockStatus: product.stockStatus,
    salesDailyRate: product.salesDailyRate,
    sales7: product.sales7,
    sales14: product.sales14,
    sales28: product.sales28,
    targetCoverageDays: product.targetCoverageDays,
    targetStock: product.targetStock,
    expectedCoverageAfterOrder: product.expectedCoverageAfterOrder,
    quantityReason: product.quantityReason,
    assortment_matrix: product.assortment_matrix || { matched: false },
    inventory_projection: product.inventory_projection || null,
  };
}

function sumLines(lines, quantityField, priceField = 'priceNum') {
  const quantityFor = line => typeof quantityField === 'function'
    ? quantityField(line)
    : line[quantityField];
  if (lines.some(line => isPositive(quantityFor(line)) && !isPositive(line[priceField]))) {
    return null;
  }
  return roundCurrency(lines.reduce(
    (sum, line) => sum + (lineSum(quantityFor(line), line[priceField]) || 0),
    0
  ));
}

function phase1Group(lines, status) {
  const group = lines.filter(line =>
    line.phase1OrderRelevant && line.workflowStatus === status
  );
  return {
    lines: group.length,
    phase1Value: sumLines(group, 'analyzerCalculatedQuantity'),
    rowIdentities: group.map(line => line.rowIdentity),
  };
}

function buildWorkingOrder(products, decisions) {
  if (!Array.isArray(products) || !Array.isArray(decisions)) {
    throw new TypeError('Working order requires demand products and decisions.');
  }
  const decisionsByIdentity = new Map(
    decisions.map(decision => [decision.rowIdentity, decision])
  );
  const workflowProducts = products.map(product => {
    const decision = decisionsByIdentity.get(product.rowIdentity);
    if (!decision) {
      throw new TypeError(`Working-order decision not found: ${product.rowIdentity}.`);
    }
    return buildWorkflowProduct(product, decision);
  });
  const byStatus = status => workflowProducts.filter(
    product => product.workflowStatus === status
  );
  const autoApproved = byStatus('auto_approved');
  const pendingReview = byStatus('pending_manual_review');
  const postponed = byStatus('postponed');
  const confidentlyExcluded = byStatus('confidently_excluded');
  const noOrderAction = byStatus('no_order_action');
  const unresolvedDataOnly = workflowProducts.filter(
    product => product.workflowStatus === null
  );
  const phase2Additions = workflowProducts.filter(product => product.phase2Addition);
  const workingMaximum = [...autoApproved, ...pendingReview].filter(product =>
    product.workflowStatus === 'auto_approved'
      ? isPositive(product.approvedOrderQuantity)
      : isPositive(product.provisionalOrderQuantity)
  );
  const phase1Statuses = [
    'auto_approved',
    'pending_manual_review',
    'postponed',
    'confidently_excluded',
  ];
  const phase1Reconciliation = Object.fromEntries(
    phase1Statuses.map(status => [status, phase1Group(workflowProducts, status)])
  );
  const phase1OrderProducts = workflowProducts.filter(product =>
    product.phase1OrderRelevant
  );
  const reconciledPhase1Lines = phase1Statuses.reduce(
    (sum, status) => sum + phase1Reconciliation[status].lines,
    0
  );
  const reconciledPhase1Value = roundCurrency(phase1Statuses.reduce(
    (sum, status) => sum + phase1Reconciliation[status].phase1Value,
    0
  ));
  const phase1PreciseValue = sumLines(
    phase1OrderProducts,
    'analyzerCalculatedQuantity'
  );

  return {
    workflowVersion: 'v2-phase-2-working-order-v1',
    products: workflowProducts,
    summary: {
      autoApprovedLines: autoApproved.length,
      autoApprovedSum: sumLines(autoApproved, 'approvedOrderQuantity'),
      pendingReviewLines: pendingReview.length,
      pendingReviewProvisionalSum: sumLines(
        pendingReview,
        'provisionalOrderQuantity'
      ),
      postponedLines: postponed.length,
      postponedProvisionalSum: sumLines(postponed, 'provisionalOrderQuantity'),
      confidentlyExcludedLines: confidentlyExcluded.length,
      confidentlyExcludedPhase1Value: sumLines(
        confidentlyExcluded.filter(product => product.phase1OrderRelevant),
        'analyzerCalculatedQuantity'
      ),
      noOrderActionLines: noOrderAction.length,
      unresolvedDataOnlyLines: unresolvedDataOnly.length,
      workingMaximumLines: workingMaximum.length,
      workingMaximumSum: sumLines(
        workingMaximum,
        product => product.workflowStatus === 'auto_approved'
          ? product.approvedOrderQuantity
          : product.provisionalOrderQuantity
      ),
      workingMaximumStatus: 'not_approved_not_ready_for_automatic_submission',
      phase2AdditionLines: phase2Additions.length,
      phase2AdditionApprovedLines: phase2Additions.filter(
        product => product.workflowStatus === 'auto_approved'
      ).length,
      phase2AdditionPendingReviewLines: phase2Additions.filter(
        product => product.workflowStatus === 'pending_manual_review'
      ).length,
    },
    phase1Reconciliation: {
      ...phase1Reconciliation,
      totalLines: phase1OrderProducts.length,
      precisePhase1Value: phase1PreciseValue,
      reconciledLines: reconciledPhase1Lines,
      reconciledValue: reconciledPhase1Value,
      lineDifference: phase1OrderProducts.length - reconciledPhase1Lines,
      valueDifference: roundCurrency(phase1PreciseValue - reconciledPhase1Value),
      reconciledExactly:
        phase1OrderProducts.length === reconciledPhase1Lines &&
        phase1PreciseValue === reconciledPhase1Value,
    },
  };
}

module.exports = {
  WORKFLOW_STATUSES,
  PROVISIONAL_QUANTITY_SOURCES,
  roundCurrency,
  lineSum,
  provisionalQuantity,
  isConfidentNoBuy,
  workflowStatus,
  blockingReason,
  buildWorkflowProduct,
  sumLines,
  buildWorkingOrder,
};
