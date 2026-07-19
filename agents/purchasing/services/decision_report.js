function markdown(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|');
}

function formatNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return 'unknown';
  }
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return 'unknown';
  }
  return `${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} RUB`;
}

function makeTable(headers, rows) {
  const header = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  return [header, divider, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
}

function decisionRow(decision, product) {
  return [
    markdown(product.rowNumber),
    markdown(product.article),
    markdown(product.name),
    markdown(product.supplier),
    markdown(`${product.abc || '—'}/${product.xyz || '—'}`),
    markdown(decision.decision),
    markdown(decision.confidence),
    markdown(formatNumber(decision.calculatedOrderQuantity)),
    markdown(
      decision.approvedOrderQuantity === null
        ? 'pending'
        : formatNumber(decision.approvedOrderQuantity)
    ),
    markdown(formatMoney(product.sumNum)),
    markdown(decision.reasons.join(', ') || 'none'),
    markdown(decision.warnings.join(', ') || 'none'),
    markdown(decision.requiredData.join(', ') || 'none'),
    markdown(decision.decisionScore),
  ];
}

function buildDecisionReport({ agentJson, productRows, sourceName = null }) {
  if (!agentJson || !Array.isArray(agentJson.decisions)) {
    throw new TypeError('Decision report requires agent decisions.');
  }
  if (!Array.isArray(productRows)) {
    throw new TypeError('Decision report requires analyzed productRows.');
  }

  const productsByIdentity = new Map(
    productRows.map(row => [row.rowIdentity, row])
  );
  const decisionEntries = agentJson.decisions.map(decision => {
    const product = productsByIdentity.get(decision.rowIdentity);
    if (!product) {
      throw new TypeError(`Decision product not found: ${decision.rowIdentity}.`);
    }
    return { decision, product };
  });
  const approved = decisionEntries.filter(({ decision }) =>
    decision.decision === 'must_buy' || decision.decision === 'recommended'
  );
  const manual = decisionEntries.filter(
    ({ decision }) => decision.decision === 'manual_review'
  );
  const postponed = decisionEntries.filter(
    ({ decision }) => decision.decision === 'postpone'
  );
  const rejected = decisionEntries.filter(
    ({ decision }) => decision.decision === 'do_not_buy'
  );
  const headers = [
    'Source row',
    'Article',
    'Product',
    'Supplier',
    'ABC/XYZ',
    'Decision',
    'Confidence',
    'Calculated quantity',
    'Approved quantity',
    'Calculated sum',
    'Reasons',
    'Warnings',
    'Required data',
    'Score',
  ];
  const section = (title, entries) => [
    `## ${title}`,
    '',
    `Lines: ${entries.length}`,
    '',
    makeTable(
      headers,
      entries.map(({ decision, product }) => decisionRow(decision, product))
    ),
    '',
  ];
  const lines = ['# Purchasing Agent v2 — Phase 1 Decision Report', ''];

  if (sourceName) lines.push(`Source: ${markdown(sourceName)}`, '');
  lines.push('## Executive summary', '');
  lines.push(makeTable(
    ['Metric', 'Value'],
    [
      ['Source rows', formatNumber(agentJson.source_rows_count)],
      ['Recognized products', formatNumber(agentJson.normalized_product_rows_count)],
      ['Products reaching analyzer', formatNumber(agentJson.product_rows_count)],
      ['Original calculated order lines', formatNumber(agentJson.order_rows_count)],
      ['Original calculated order sum', formatMoney(agentJson.preliminary_order_sum)],
      ['Must buy', formatNumber(agentJson.mustBuyCount)],
      ['Recommended', formatNumber(agentJson.recommendedCount)],
      ['Manual review', formatNumber(agentJson.manualReviewCount)],
      ['Postpone', formatNumber(agentJson.postponeCount)],
      ['Do not buy', formatNumber(agentJson.doNotBuyCount)],
      ['High confidence', formatNumber(agentJson.highConfidenceCount)],
      ['Medium confidence', formatNumber(agentJson.mediumConfidenceCount)],
      ['Low confidence', formatNumber(agentJson.lowConfidenceCount)],
      ['Approved order lines', formatNumber(agentJson.approvedOrderLines)],
      ['Approved order sum', formatMoney(agentJson.approvedOrderSum)],
      ['Pending review lines', formatNumber(agentJson.pendingReviewLines)],
      [
        'Pending review calculated sum',
        formatMoney(agentJson.pendingReviewCalculatedSum),
      ],
    ]
  ));
  lines.push('');
  lines.push(...section('Automatically approved order', approved));
  lines.push(...section('Manual review queue', manual));
  lines.push(...section('Postponed products', postponed));
  lines.push(...section('Rejected / no-order products', rejected));
  lines.push('## Manual-review reasons and missing data', '');
  lines.push(makeTable(
    [
      'Source row',
      'Product',
      'Calculated quantity',
      'Approved quantity',
      'Reasons',
      'Warnings',
      'Required data',
    ],
    manual.map(({ decision, product }) => [
      markdown(product.rowNumber),
      markdown(product.name),
      markdown(formatNumber(decision.calculatedOrderQuantity)),
      markdown('pending'),
      markdown(decision.reasons.join(', ') || 'none'),
      markdown(decision.warnings.join(', ') || 'none'),
      markdown(decision.requiredData.join(', ') || 'none'),
    ])
  ));
  lines.push('');
  lines.push('Calculated quantities are preserved from the existing analyzer.');
  lines.push('Only `must_buy` and `recommended` decisions receive approved quantities.');

  return `${lines.join('\n')}\n`;
}

module.exports = {
  markdown,
  formatNumber,
  formatMoney,
  makeTable,
  decisionRow,
  buildDecisionReport,
};
