const {
  markdown,
  formatNumber,
  formatMoney,
  makeTable,
} = require('./decision_report');

function phase2Row(decision, product) {
  const weeklyPeriodsUsed = product.weeklyPeriodsUsed
    ? Object.entries(product.weeklyPeriodsUsed)
      .map(([field, periods]) => `${field}: ${(periods || []).join(', ') || 'none'}`)
      .join('; ')
    : 'none';
  return [
    markdown(product.rowNumber),
    markdown(product.article),
    markdown(product.name),
    markdown(product.supplier),
    markdown(`${product.abc || '—'}/${product.xyz || '—'}`),
    markdown(decision.decision),
    markdown(decision.decisionBasis),
    markdown(decision.confidence),
    markdown(formatNumber(product.sales7)),
    markdown(formatNumber(product.sales14)),
    markdown(formatNumber(product.sales28)),
    markdown(weeklyPeriodsUsed),
    markdown(formatNumber(product.salesDailyRate)),
    markdown(product.salesRateSource),
    markdown(product.salesRateConfidence),
    markdown(product.originalSmartZapasSalesValue),
    markdown(product.originalSmartZapasVelocityValue),
    markdown(formatNumber(product.analyzerCalculatedQuantity)),
    markdown(formatNumber(product.demandCalculatedQuantity)),
    markdown(formatNumber(product.mandatoryMinimumGap)),
    markdown(formatNumber(product.finalRecommendedQuantity)),
    markdown(
      decision.approvedOrderQuantity === null
        ? 'pending'
        : formatNumber(decision.approvedOrderQuantity)
    ),
    markdown(decision.reasons.join(', ') || 'none'),
    markdown(decision.warnings.join(', ') || 'none'),
    markdown(decision.requiredData.join(', ') || 'none'),
  ];
}

function buildDemandReport({ agentJson, sourceName = null }) {
  if (
    !agentJson ||
    !Array.isArray(agentJson.decisions) ||
    !Array.isArray(agentJson.demandProducts)
  ) {
    throw new TypeError('Demand report requires Phase 2 products and decisions.');
  }

  const decisionsByIdentity = new Map(
    agentJson.decisions.map(decision => [decision.rowIdentity, decision])
  );
  const workflowByIdentity = new Map(
    (agentJson.workingOrderProducts || []).map(product => [product.rowIdentity, product])
  );
  const entries = agentJson.demandProducts.map(product => {
    const decision = decisionsByIdentity.get(product.rowIdentity);
    if (!decision) {
      throw new TypeError(`Phase 2 decision not found: ${product.rowIdentity}.`);
    }
    return {
      product,
      decision,
      workflow: workflowByIdentity.get(product.rowIdentity) || null,
    };
  });
  const approved = entries.filter(({ workflow, decision }) =>
    workflow
      ? workflow.workflowStatus === 'auto_approved'
      : decision.approvedOrderQuantity > 0
  );
  const mandatoryGaps = entries.filter(({ product }) =>
    product.mandatoryAssortment === true &&
    (product.mandatoryMinimumGap === null || product.mandatoryMinimumGap > 0)
  );
  const manual = entries.filter(({ workflow, decision }) =>
    workflow
      ? workflow.workflowStatus === 'pending_manual_review'
      : decision.decision === 'manual_review'
  );
  const postponed = entries.filter(({ workflow, decision }) =>
    workflow
      ? workflow.workflowStatus === 'postponed'
      : decision.decision === 'postpone'
  );
  const provisional = entries.filter(
    ({ decision }) => decision.decisionBasis === 'provisional_phase1_no_order'
  );
  const confidentlyExcluded = entries.filter(({ workflow }) =>
    workflow?.workflowStatus === 'confidently_excluded'
  );
  const noOrderAction = entries.filter(({ workflow }) =>
    workflow?.workflowStatus === 'no_order_action'
  );
  const unresolvedDataOnly = entries.filter(({ workflow, decision }) =>
    workflow?.workflowStatus === null && decision.decision === 'manual_review'
  );
  const headers = [
    'Source row',
    'Article',
    'Product',
    'Supplier',
    'ABC/XYZ',
    'Decision',
    'Decision basis',
    'Confidence',
    'Sales 7 days',
    'Sales 14 days',
    'Sales 28 days',
    'Weekly periods used',
    'Sales rate',
    'Sales rate source',
    'Sales rate confidence',
    'Original SmartZapas sales',
    'Original SmartZapas velocity',
    'Analyzer qty',
    'Demand qty',
    'Mandatory gap',
    'Final qty',
    'Approved qty',
    'Reasons',
    'Warnings',
    'Required data',
  ];
  const section = (title, sectionEntries) => [
    `## ${title}`,
    '',
    `Lines: ${sectionEntries.length}`,
    '',
    makeTable(
      headers,
      sectionEntries.map(({ decision, product }) => phase2Row(decision, product))
    ),
    '',
  ];
  const preliminary = agentJson.phase2ResultStatus === 'preliminary';
  const lines = [
    preliminary
      ? '# Purchasing Agent v2 — Phase 2 Demand Report (PRELIMINARY)'
      : '# Purchasing Agent v2 — Phase 2 Demand Report',
    '',
  ];

  if (sourceName) lines.push(`Source: ${markdown(sourceName)}`, '');
  if (preliminary) {
    lines.push(
      'This Phase 2 result is preliminary until SmartZapas expected-receipt semantics are confirmed.',
      ''
    );
  }
  lines.push('## Executive summary', '');
  lines.push(makeTable(
    ['Metric', 'Value'],
    [
      ['Source rows', formatNumber(agentJson.source_rows_count)],
      ['Recognized products', formatNumber(agentJson.normalized_product_rows_count)],
      ['Products reaching analyzer', formatNumber(agentJson.product_rows_count)],
      ['Purchasing profile', markdown(agentJson.purchasingProfile)],
      ['Phase 2 result status', markdown(agentJson.phase2ResultStatus)],
      ['Original analyzer order lines', formatNumber(agentJson.order_rows_count)],
      ['Original analyzer order sum', formatMoney(agentJson.preliminary_order_sum)],
      ['Products with sales data', formatNumber(agentJson.productsWithSalesData)],
      ['Products missing all sales', formatNumber(agentJson.productsMissingAllSales)],
      ['Sales input mode', markdown(agentJson.salesInputMode)],
      ['Products with period sales', formatNumber(agentJson.productsWithPeriodSales)],
      [
        'Products with reported daily rate',
        formatNumber(agentJson.productsWithReportedDailyRate),
      ],
      ['Products using weighted sales', formatNumber(agentJson.productsUsingWeightedSales)],
      [
        'Products using SmartZapas rate',
        formatNumber(agentJson.productsUsingSmartZapasRate),
      ],
      [
        'Products missing usable sales input',
        formatNumber(agentJson.productsMissingUsableSalesInput),
      ],
      ['Products with weekly history', formatNumber(agentJson.productsWithWeeklyHistory)],
      ['Products with sales7', formatNumber(agentJson.productsWithSales7)],
      ['Products with sales14', formatNumber(agentJson.productsWithSales14)],
      ['Products with sales28', formatNumber(agentJson.productsWithSales28)],
      [
        'Products using weekly weighted rate',
        formatNumber(agentJson.productsUsingWeeklyWeightedRate),
      ],
      [
        'Products using cumulative fallback',
        formatNumber(agentJson.productsUsingCumulativeFallback),
      ],
      [
        'Products with partial latest week excluded',
        formatNumber(agentJson.productsWithPartialLatestWeekExcluded),
      ],
      ['Products missing usable sales', formatNumber(agentJson.productsMissingUsableSales)],
      [
        'Blank weekly cells interpreted as zero',
        formatNumber(agentJson.blankWeeklyCellsInterpretedAsZero),
      ],
      [
        'Weekly-to-cumulative exact matches',
        formatNumber(agentJson.weeklyToCumulativeExactMatches),
      ],
      [
        'Weekly-to-cumulative tolerance matches',
        formatNumber(agentJson.weeklyToCumulativeToleranceMatches),
      ],
      [
        'Weekly-to-cumulative mismatches',
        formatNumber(agentJson.weeklyToCumulativeMismatches),
      ],
      [
        'Excluded partial week',
        agentJson.excludedPartialWeek
          ? markdown(
            `${agentJson.excludedPartialWeek.periodStart} through ` +
            `${agentJson.excludedPartialWeek.periodEnd}`
          )
          : 'none',
      ],
      ['Assortment matrix status', markdown(agentJson.assortmentMatrixStatus)],
      ['In-transit mode', markdown(agentJson.inTransitMode)],
      ['In-transit source status', markdown(agentJson.inTransitSourceStatus)],
      ['In-transit decision basis', markdown(agentJson.inTransitDecisionBasis)],
      [
        'Source stock includes expected receipts',
        markdown(agentJson.sourceStockIncludesExpectedReceipts),
      ],
      ['Mandatory products matched', formatNumber(agentJson.mandatoryProductsMatched)],
      ['Mandatory matrix products missing', formatNumber(agentJson.mandatoryProductsMissing)],
      ['Mandatory products at zero stock', formatNumber(agentJson.mandatoryZeroStockCount)],
      ['Demand order lines', formatNumber(agentJson.demandOrderLines)],
      ['Demand order sum', formatMoney(agentJson.demandOrderSum)],
      [
        'Demand quantities calculated',
        formatNumber(agentJson.demandQuantitiesCalculated),
      ],
      [
        'Final quantities calculated',
        formatNumber(agentJson.finalQuantitiesCalculated),
      ],
      [
        'Automatically approved portion lines',
        formatNumber(agentJson.autoApprovedLines),
      ],
      [
        'Automatically approved portion sum',
        formatMoney(agentJson.autoApprovedSum),
      ],
      ['Pending manual-review lines', formatNumber(agentJson.pendingReviewLines)],
      [
        'Pending-review provisional sum',
        formatMoney(agentJson.pendingReviewProvisionalSum),
      ],
      ['Postponed lines', formatNumber(agentJson.postponedLines)],
      ['Postponed provisional sum', formatMoney(agentJson.postponedProvisionalSum)],
      ['Confidently excluded lines', formatNumber(agentJson.confidentlyExcludedLines)],
      ['Working maximum lines', formatNumber(agentJson.workingMaximumLines)],
      ['Working maximum sum', formatMoney(agentJson.workingMaximumSum)],
      ['Provisional no-action rows', formatNumber(agentJson.provisionalNoActionCount)],
      [
        'Positive analyzer lines awaiting data',
        formatNumber(agentJson.positiveAnalyzerLinesAwaitingData),
      ],
      [
        'Analyzer vs final quantity delta',
        formatNumber(agentJson.analyzerVsFinalQuantityDelta),
      ],
      ['Analyzer vs final sum delta', formatMoney(agentJson.analyzerVsFinalSumDelta)],
      ['Must buy', formatNumber(agentJson.mustBuyCount)],
      ['Recommended', formatNumber(agentJson.recommendedCount)],
      ['Manual review', formatNumber(agentJson.manualReviewCount)],
      ['Postpone', formatNumber(agentJson.postponeCount)],
      ['Do not buy', formatNumber(agentJson.doNotBuyCount)],
    ]
  ));
  lines.push('');
  lines.push('## Report-level warnings', '');
  if ((agentJson.reportWarnings || []).length === 0) {
    lines.push('None.', '');
  } else {
    for (const warning of agentJson.reportWarnings) {
      lines.push(`- ${markdown(warning)}`);
    }
    lines.push('');
  }
  lines.push('## Missing input datasets', '');
  lines.push(makeTable(
    ['Dataset', 'Status', 'Blocking', 'Impact'],
    (agentJson.missingInputDatasets || []).map(dataset => [
      markdown(dataset.dataset),
      markdown(dataset.status),
      markdown(dataset.blocking ? 'yes' : 'no'),
      markdown(dataset.impact),
    ])
  ));
  lines.push('');
  lines.push(...section('Automatically approved order', approved));
  lines.push(...section('Mandatory assortment gaps', mandatoryGaps));
  lines.push(...section('Requires manual review', manual));
  lines.push(...section('Postponed products', postponed));
  lines.push(...section('Provisional no-action products', provisional));
  lines.push(...section('Confidently excluded products', confidentlyExcluded));
  lines.push(...section('No order action', noOrderAction));
  lines.push(...section('Data review without positive order quantity', unresolvedDataOnly));
  lines.push('## Quantity comparison', '');
  lines.push(makeTable(
    [
      'Source row',
      'Product',
      'Analyzer quantity',
      'Demand quantity',
      'Mandatory gap',
      'Final quantity',
      'Quantity reason',
    ],
    entries.map(({ product }) => [
      markdown(product.rowNumber),
      markdown(product.name),
      markdown(formatNumber(product.analyzerCalculatedQuantity)),
      markdown(formatNumber(product.demandCalculatedQuantity)),
      markdown(formatNumber(product.mandatoryMinimumGap)),
      markdown(formatNumber(product.finalRecommendedQuantity)),
      markdown(product.quantityReason),
    ])
  ));
  lines.push('');
  lines.push('## Coverage', '');
  lines.push(makeTable(
    [
      'Source row',
      'Product',
      'Daily sales rate',
      'Sales rate source',
      'Sales rate confidence',
      'Target coverage days',
      'Available stock',
      'Stock after order',
      'Expected coverage after order',
      'In-transit status',
    ],
    entries.map(({ product }) => [
      markdown(product.rowNumber),
      markdown(product.name),
      markdown(formatNumber(product.salesDailyRate)),
      markdown(product.salesRateSource),
      markdown(product.salesRateConfidence),
      markdown(formatNumber(product.targetCoverageDays)),
      markdown(formatNumber(product.availableStock)),
      markdown(formatNumber(product.stockAfterOrder)),
      markdown(formatNumber(product.expectedCoverageAfterOrder)),
      markdown(product.inTransitStatus),
    ])
  ));
  lines.push('');
  lines.push('Calculated Phase 2 quantities do not replace the preserved analyzer quantities.');
  lines.push('The working maximum is not approved and is not ready for automatic submission.');
  lines.push('Unknown critical inputs leave quantities pending for review.');

  return `${lines.join('\n')}\n`;
}

module.exports = {
  phase2Row,
  buildDemandReport,
};
