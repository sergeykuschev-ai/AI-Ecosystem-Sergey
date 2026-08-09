'use strict';

const path = require('node:path');
const {
  UnsupportedOperationError,
} = require('../../errors/arthur_errors');

const { runOrderAgentFromSmartZapasXlsxWithDemand } = require(
  '../../../purchasing/order_agent'
);

const CAPABILITIES = Object.freeze([
  { id: 'getStatus', readOnly: true },
  { id: 'getSummary', readOnly: true },
  { id: 'getOwnerReview', readOnly: true },
  { id: 'getFinalOrder', readOnly: true },
]);

const DEFAULT_FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'tests',
  'fixtures',
  'SmartZapas_synthetic.xlsx'
);

function resolveFilePath(parameters) {
  return parameters.filePath || DEFAULT_FIXTURE_PATH;
}

async function runPurchasingAgent(filePath) {
  return runOrderAgentFromSmartZapasXlsxWithDemand(filePath, {}, {
    assortmentMatrixPath: null,
    canonicalAssortmentMatrixPath: null,
  });
}

async function getStatus(parameters) {
  const filePath = resolveFilePath(parameters);
  const result = await runPurchasingAgent(filePath);
  const fields = result.additionalResultFields || {};

  return {
    status: 'success',
    data: {
      summary: `Закупка: ${fields.normalized_product_rows_count || 0} позиций`,
      productCount: fields.normalized_product_rows_count || 0,
      sourceRowsCount: result.sourceRowsCount || fields.sourceRowsCount || 0,
      reportWarnings: (result.reportWarnings || []).length,
      demandInputStatus: fields.demandInputStatus || null,
    },
  };
}

async function getSummary(parameters) {
  const filePath = resolveFilePath(parameters);
  const result = await runPurchasingAgent(filePath);
  const fields = result.additionalResultFields || {};
  const summary = result.summary || {};

  return {
    status: 'success',
    data: {
      summary: `Сводка закупки: ${fields.normalized_product_rows_count || 0} SKU`,
      productCount: fields.normalized_product_rows_count || 0,
      analyzerOrderSum: summary.analyzer_order_sum || null,
      workingOrderSum: summary.auto_approved_sum || null,
      pendingReviewCount: summary.pending_manual_review_count || null,
      mustBuyCount: summary.must_buy_count || null,
      recommendedCount: summary.recommended_count || null,
      postponedCount: summary.postponed_count || null,
      warnings: result.reportWarnings || [],
    },
  };
}

async function getOwnerReview(parameters) {
  const filePath = resolveFilePath(parameters);
  const result = await runPurchasingAgent(filePath);

  const workingOrderProducts = result.additionalResultFields?.workingOrderProducts || [];
  const ownerReviewItems = workingOrderProducts.filter(product =>
    product.ownerReviewRequired === true ||
    product.workflow_status === 'pending_manual_review'
  );

  return {
    status: 'success',
    data: {
      summary: `На ручную проверку: ${ownerReviewItems.length} позиций`,
      count: ownerReviewItems.length,
      items: ownerReviewItems.slice(0, 20).map(product => ({
        sku: product.sku || product.article || null,
        name: product.name || null,
        supplier: product.supplier || null,
        workflowStatus: product.workflow_status || null,
        reasonCodes: product.reason_codes || [],
      })),
    },
  };
}

async function getFinalOrder(parameters) {
  return {
    status: 'success',
    data: {
      summary: 'Final order недоступен в read-only режиме: требуется Owner Review и подтверждение.',
      status: 'NOT_AVAILABLE',
      reason: 'REQUIRES_OWNER_REVIEW',
    },
  };
}

async function execute(input) {
  const { operation, parameters = {} } = input;

  switch (operation) {
    case 'getStatus':
      return getStatus(parameters);
    case 'getSummary':
      return getSummary(parameters);
    case 'getOwnerReview':
      return getOwnerReview(parameters);
    case 'getFinalOrder':
      return getFinalOrder(parameters);
    default:
      throw new UnsupportedOperationError('purchasing', operation);
  }
}

async function health() {
  return { healthy: true, skill: 'purchasing', version: '1.0.0' };
}

const PurchasingSkill = {
  id: 'purchasing',
  name: 'Arthur Purchasing',
  version: '1.0.0',
  capabilities: CAPABILITIES,
  readOnly: true,
  execute,
  health,
};

module.exports = {
  PurchasingSkill,
  CAPABILITIES,
  DEFAULT_FIXTURE_PATH,
};
