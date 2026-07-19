const {
  markdown,
  formatNumber,
  formatMoney,
  makeTable,
} = require('./decision_report');

function phase2Row(decision, product) {
  return [
    markdown(product.rowNumber),
    markdown(product.article),
    markdown(product.name),
    markdown(product.supplier),
    markdown(`${product.abc || '—'}/${product.xyz || '—'}`),
    markdown(decision.decision),
    markdown(decision.decisionBasis),
    markdown(decision.confidence),
    markdown(formatNumber(product.salesDailyRate)),
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
  const entries = agentJson.demandProducts.map(product => {
    const decision = decisionsByIdentity.get(product.rowIdentity);
    if (!decision) {
      throw new TypeError(`Phase 2 decision not found: ${product.rowIdentity}.`);
    }
    return { product, decision };
  });
  const approved = entries.filter(({ decision }) => decision.approvedOrderQuantity > 0);
  const mandatoryGaps = entries.filter(({ product }) =>
    product.mandatoryAssortment === true &&
    (product.mandatoryMinimumGap === null || product.mandatoryMinimumGap > 0)
  );
  const manual = entries.filter(({ decision }) => decision.decision === 'manual_review');
  const postponed = entries.filter(({ decision }) => decision.decision === 'postpone');
  const provisional = entries.filter(
    ({ decision }) => decision.decisionBasis === 'provisional_phase1_no_order'
  );
  const rejected = entries.filter(({ decision }) =>
    decision.decision === 'do_not_buy' &&
    decision.decisionBasis !== 'provisional_phase1_no_order'
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
    'Daily sales',
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
  const lines = ['# Purchasing Agent v2 — Phase 2 Demand Report', ''];

  if (sourceName) lines.push(`Source: ${markdown(sourceName)}`, '');
  lines.push('## Executive summary', '');
  lines.push(makeTable(
    ['Metric', 'Value'],
    [
      ['Source rows', formatNumber(agentJson.source_rows_count)],
      ['Recognized products', formatNumber(agentJson.normalized_product_rows_count)],
      ['Products reaching analyzer', formatNumber(agentJson.product_rows_count)],
      ['Original analyzer order lines', formatNumber(agentJson.order_rows_count)],
      ['Original analyzer order sum', formatMoney(agentJson.preliminary_order_sum)],
      ['Products with sales data', formatNumber(agentJson.productsWithSalesData)],
      ['Products missing all sales', formatNumber(agentJson.productsMissingAllSales)],
      ['Assortment matrix status', markdown(agentJson.assortmentMatrixStatus)],
      ['In-transit source status', markdown(agentJson.inTransitSourceStatus)],
      ['Mandatory products matched', formatNumber(agentJson.mandatoryProductsMatched)],
      ['Mandatory matrix products missing', formatNumber(agentJson.mandatoryProductsMissing)],
      ['Mandatory products at zero stock', formatNumber(agentJson.mandatoryZeroStockCount)],
      ['Demand order lines', formatNumber(agentJson.demandOrderLines)],
      ['Demand order sum', formatMoney(agentJson.demandOrderSum)],
      ['Final approved lines', formatNumber(agentJson.finalApprovedLines)],
      ['Final approved sum', formatMoney(agentJson.finalApprovedSum)],
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
  lines.push(...section('Manual review queue', manual));
  lines.push(...section('Postponed products', postponed));
  lines.push(...section('Provisional no-action products', provisional));
  lines.push(...section('Rejected / no-order products', rejected));
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
      markdown(formatNumber(product.targetCoverageDays)),
      markdown(formatNumber(product.availableStock)),
      markdown(formatNumber(product.stockAfterOrder)),
      markdown(formatNumber(product.expectedCoverageAfterOrder)),
      markdown(product.inTransitStatus),
    ])
  ));
  lines.push('');
  lines.push('Final quantities are deterministic and do not replace the preserved analyzer quantities.');
  lines.push('Unknown critical inputs leave final and approved quantities pending.');

  return `${lines.join('\n')}\n`;
}

module.exports = {
  phase2Row,
  buildDemandReport,
};
