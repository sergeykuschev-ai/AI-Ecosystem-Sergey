const {
  markdown,
  formatNumber,
  formatMoney,
  makeTable,
} = require('./decision_report');

function identifier(product) {
  return product.article || product.internalProductId || product.barcode || null;
}

function suspiciousIncrease(product) {
  const phase1Quantity = product.analyzerCalculatedQuantity;
  const phase2Quantity = product.finalRecommendedQuantity;
  return (
    phase2Quantity > phase1Quantity &&
    phase2Quantity - phase1Quantity >= Math.max(5, phase1Quantity * 0.5)
  );
}

function summaryTable(agentJson) {
  return makeTable(
    ['Metric', 'Value'],
    [
      ['Phase 1 order lines', formatNumber(agentJson.order_rows_count)],
      ['Phase 1 displayed sum', formatMoney(agentJson.preliminary_order_sum)],
      [
        'Phase 1 precise line value',
        formatMoney(agentJson.phase1Reconciliation.precisePhase1Value),
      ],
      ['Automatically approved portion lines', formatNumber(agentJson.autoApprovedLines)],
      ['Automatically approved portion sum', formatMoney(agentJson.autoApprovedSum)],
      ['Pending manual-review lines', formatNumber(agentJson.pendingReviewLines)],
      [
        'Pending-review provisional sum',
        formatMoney(agentJson.pendingReviewProvisionalSum),
      ],
      ['Postponed lines', formatNumber(agentJson.postponedLines)],
      ['Postponed provisional sum', formatMoney(agentJson.postponedProvisionalSum)],
      ['Confidently excluded lines', formatNumber(agentJson.confidentlyExcludedLines)],
      [
        'Confidently excluded Phase 1 value',
        formatMoney(agentJson.confidentlyExcludedPhase1Value),
      ],
      ['Working maximum lines', formatNumber(agentJson.workingMaximumLines)],
      ['Working maximum sum', formatMoney(agentJson.workingMaximumSum)],
      ['Phase 2 additions', formatNumber(agentJson.phase2AdditionLines)],
    ]
  );
}

function approvedTable(products) {
  return makeTable(
    ['Row', 'Product', 'Article / barcode', 'Approved qty', 'Price', 'Line sum',
      'Decision', 'Reason'],
    products.map(product => [
      markdown(product.rowNumber),
      markdown(product.name),
      markdown(identifier(product)),
      markdown(formatNumber(product.approvedOrderQuantity)),
      markdown(formatMoney(product.priceNum)),
      markdown(formatMoney(product.approvedLineSum)),
      markdown(product.phase2Decision),
      markdown(product.decisionReasons.join(', ')),
    ])
  );
}

function pendingTable(products) {
  return makeTable(
    [
      'Row',
      'Product',
      'Article / barcode',
      'Phase 1 qty',
      'Phase 2 qty',
      'Provisional qty',
      'Provisional source',
      'Price',
      'Provisional sum',
      'Free stock',
      'Sales7',
      'Sales14',
      'Sales28',
      'Blocker',
      'Decision reason',
      'Approval required',
    ],
    products.map(product => [
      markdown(product.rowNumber),
      markdown(product.name),
      markdown(identifier(product)),
      markdown(formatNumber(product.analyzerCalculatedQuantity)),
      markdown(formatNumber(product.finalRecommendedQuantity)),
      markdown(formatNumber(product.provisionalOrderQuantity)),
      markdown(product.provisionalQuantitySource),
      markdown(formatMoney(product.priceNum)),
      markdown(formatMoney(product.provisionalLineSum)),
      markdown(formatNumber(product.freeStock)),
      markdown(formatNumber(product.sales7)),
      markdown(formatNumber(product.sales14)),
      markdown(formatNumber(product.sales28)),
      markdown(product.blockingReason),
      markdown(product.decisionReasons.join(', ')),
      markdown(product.approvalRequired ? 'yes' : 'no'),
    ])
  );
}

function postponedTable(products) {
  return makeTable(
    ['Row', 'Product', 'Article / barcode', 'Phase 1 qty', 'Phase 2 qty',
      'Provisional qty', 'Price', 'Provisional sum', 'Reason'],
    products.map(product => [
      markdown(product.rowNumber),
      markdown(product.name),
      markdown(identifier(product)),
      markdown(formatNumber(product.analyzerCalculatedQuantity)),
      markdown(formatNumber(product.finalRecommendedQuantity)),
      markdown(formatNumber(product.provisionalOrderQuantity)),
      markdown(formatMoney(product.priceNum)),
      markdown(formatMoney(product.provisionalLineSum)),
      markdown(product.decisionReasons.join(', ')),
    ])
  );
}

function excludedTable(products) {
  return makeTable(
    ['Row', 'Product', 'Article / barcode', 'Phase 1 qty', 'Phase 1 value',
      'Free stock', 'Sales7', 'Sales14', 'Sales28', 'Reason'],
    products.map(product => [
      markdown(product.rowNumber),
      markdown(product.name),
      markdown(identifier(product)),
      markdown(formatNumber(product.analyzerCalculatedQuantity)),
      markdown(formatMoney(product.phase1LineSum)),
      markdown(formatNumber(product.freeStock)),
      markdown(formatNumber(product.sales7)),
      markdown(formatNumber(product.sales14)),
      markdown(formatNumber(product.sales28)),
      markdown(product.decisionReasons.join(', ')),
    ])
  );
}

function additionTable(products) {
  return makeTable(
    ['Row', 'Product', 'Article / barcode', 'Workflow status', 'Phase 2 qty',
      'Approved qty', 'Provisional qty', 'Price', 'Decision', 'Reason'],
    products.map(product => [
      markdown(product.rowNumber),
      markdown(product.name),
      markdown(identifier(product)),
      markdown(product.workflowStatus),
      markdown(formatNumber(product.finalRecommendedQuantity)),
      markdown(formatNumber(product.approvedOrderQuantity)),
      markdown(formatNumber(product.provisionalOrderQuantity)),
      markdown(formatMoney(product.priceNum)),
      markdown(product.phase2Decision),
      markdown(product.decisionReasons.join(', ')),
    ])
  );
}

function increaseTable(products) {
  return makeTable(
    ['Row', 'Product', 'Article / barcode', 'Phase 1 qty', 'Phase 2 qty',
      'Difference', 'Workflow status', 'Price', 'Phase 2 quantity value',
      'Sales7', 'Sales14', 'Sales28', 'Reason'],
    products.map(product => [
      markdown(product.rowNumber),
      markdown(product.name),
      markdown(identifier(product)),
      markdown(formatNumber(product.analyzerCalculatedQuantity)),
      markdown(formatNumber(product.finalRecommendedQuantity)),
      markdown(formatNumber(
        product.finalRecommendedQuantity - product.analyzerCalculatedQuantity
      )),
      markdown(product.workflowStatus),
      markdown(formatMoney(product.priceNum)),
      markdown(formatMoney(
        product.finalRecommendedQuantity * product.priceNum
      )),
      markdown(formatNumber(product.sales7)),
      markdown(formatNumber(product.sales14)),
      markdown(formatNumber(product.sales28)),
      markdown(product.decisionReasons.join(', ')),
    ])
  );
}

function buildWorkingOrderReport({ agentJson, sourceName = null }) {
  if (
    !agentJson ||
    !Array.isArray(agentJson.workingOrderProducts) ||
    !agentJson.phase1Reconciliation
  ) {
    throw new TypeError('Working-order report requires workflow products.');
  }
  const products = agentJson.workingOrderProducts;
  const byStatus = status => products.filter(product => product.workflowStatus === status);
  const automaticallyApproved = byStatus('auto_approved');
  const pendingReview = byStatus('pending_manual_review');
  const postponed = byStatus('postponed');
  const confidentlyExcluded = byStatus('confidently_excluded');
  const additions = products.filter(product => product.phase2Addition);
  const suspiciousIncreases = products
    .filter(suspiciousIncrease)
    .sort((left, right) =>
      (right.finalRecommendedQuantity - right.analyzerCalculatedQuantity) -
      (left.finalRecommendedQuantity - left.analyzerCalculatedQuantity)
    );
  const lines = [
    '# Purchasing Working Order — Preliminary Phase 2 Result',
    '',
  ];
  if (sourceName) lines.push(`Source: ${markdown(sourceName)}`, '');
  lines.push(
    '> The working maximum is not approved and is not ready for automatic submission. It combines the automatically approved portion with provisional positive manual-review quantities.',
    '',
    '## Executive summary',
    '',
    summaryTable(agentJson),
    '',
    '## Phase 1 reconciliation',
    '',
    makeTable(
      ['Workflow status', 'Phase 1 lines', 'Precise Phase 1 value'],
      [
        'auto_approved',
        'pending_manual_review',
        'postponed',
        'confidently_excluded',
      ].map(status => [
        status,
        formatNumber(agentJson.phase1Reconciliation[status].lines),
        formatMoney(agentJson.phase1Reconciliation[status].phase1Value),
      ])
    ),
    '',
    `Reconciled exactly: ${agentJson.phase1Reconciliation.reconciledExactly ? 'yes' : 'no'}. ` +
      `Lines: ${agentJson.phase1Reconciliation.reconciledLines}/${agentJson.phase1Reconciliation.totalLines}. ` +
      `Value: ${formatMoney(agentJson.phase1Reconciliation.reconciledValue)}.`,
    '',
    '## A. Automatically approved order',
    '',
    approvedTable(automaticallyApproved),
    '',
    '## B. Requires manual review',
    '',
    pendingTable(pendingReview),
    '',
    '## C. Postponed',
    '',
    postponedTable(postponed),
    '',
    '## D. Confidently excluded',
    '',
    excludedTable(confidentlyExcluded),
    '',
    '## E. Phase 2 additions',
    '',
    additionTable(additions),
    '',
    '## F. Suspicious quantity increases',
    '',
    'Flag threshold: increase is at least the greater of 5 units or 50% of the Phase 1 quantity.',
    '',
    increaseTable(suspiciousIncreases),
    '',
    'Automatically approved quantities exclude all pending-review and postponed quantities.',
    'No purchasing calculation, decision rule, or source quantity is changed by this report.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

module.exports = {
  identifier,
  suspiciousIncrease,
  buildWorkingOrderReport,
};
