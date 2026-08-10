'use strict';

const {
  UnsupportedOperationError,
} = require('../../errors/arthur_errors');
const { createRunResolver, PurchasingRunError } = require('./run_resolver');

const CAPABILITIES = Object.freeze([
  { id: 'getStatus', readOnly: true },
  { id: 'getSummary', readOnly: true },
  { id: 'getOwnerReview', readOnly: true },
  { id: 'getFinalOrder', readOnly: true },
]);

function buildNoRunResponse() {
  return {
    status: 'success',
    data: {
      summary: 'Нет доступной завершённой закупки.',
      productCount: 0,
      sourceRowsCount: 0,
      reportWarnings: 0,
      demandInputStatus: null,
      run: null,
    },
  };
}

function createResolver(parameters = {}) {
  return createRunResolver({
    runsRoot: parameters.runsRoot,
    fsModule: parameters.fsModule,
  });
}

function resolveRunId(resolver, parameters = {}) {
  return resolver.resolveRunId({ runId: parameters.runId });
}

function runMetadata(metadata) {
  return {
    run_id: metadata.run_id,
    status: metadata.status,
    completed_at: metadata.completed_at,
    source_filename: metadata.source?.original_name || null,
  };
}

async function getStatus(parameters) {
  const resolver = createResolver(parameters);
  const runId = resolveRunId(resolver, parameters);

  if (!runId) {
    return buildNoRunResponse();
  }

  const metadata = resolver.getRunMetadata(runId);
  const summary = resolver.getRunSummary(runId);

  return {
    status: 'success',
    data: {
      summary: `Закупка: ${summary.sku_count ?? 0} SKU, ${summary.source_rows_count ?? 0} строк`,
      productCount: summary.sku_count ?? 0,
      sourceRowsCount: summary.source_rows_count ?? 0,
      reportWarnings: (summary.warnings || []).length,
      demandInputStatus: null,
      run: runMetadata(metadata),
    },
  };
}

async function getSummary(parameters) {
  const resolver = createResolver(parameters);
  const runId = resolveRunId(resolver, parameters);

  if (!runId) {
    return {
      status: 'success',
      data: {
        summary: 'Нет доступной завершённой закупки.',
        productCount: 0,
        analyzerOrderSum: null,
        workingOrderSum: null,
        pendingReviewCount: null,
        mustBuyCount: null,
        recommendedCount: null,
        postponedCount: null,
        warnings: [],
        run: null,
      },
    };
  }

  const metadata = resolver.getRunMetadata(runId);
  const summary = resolver.getRunSummary(runId);
  const amounts = summary.amounts || {};
  const phase2 = summary.phase2 || {};

  return {
    status: 'success',
    data: {
      summary: `Сводка закупки: ${summary.sku_count ?? 0} SKU, ${summary.source_rows_count ?? 0} строк`,
      productCount: summary.sku_count ?? 0,
      analyzerOrderSum: amounts.analyzer_order_sum ?? null,
      workingOrderSum: amounts.auto_approved_sum ?? null,
      pendingReviewCount: phase2.manual_review ?? null,
      mustBuyCount: phase2.must_buy ?? null,
      recommendedCount: phase2.recommended ?? null,
      postponedCount: phase2.postpone ?? null,
      warnings: summary.warnings || [],
      run: runMetadata(metadata),
    },
  };
}

async function getOwnerReview(parameters) {
  const resolver = createResolver(parameters);
  const runId = resolveRunId(resolver, parameters);

  if (!runId) {
    return {
      status: 'success',
      data: {
        summary: 'Нет доступной завершённой закупки.',
        count: 0,
        status: null,
        items: [],
        run: null,
      },
    };
  }

  const metadata = resolver.getRunMetadata(runId);
  const ownerReview = resolver.getOwnerReview(runId);
  const summary = ownerReview.summary || {};
  const unmatched = ownerReview.owner_decisions?.unmatched_active_skus || [];

  return {
    status: 'success',
    data: {
      summary: `На ручную проверку: ${summary.owner_action_required_total ?? 0} позиций`,
      count: summary.owner_action_required_total ?? 0,
      status: ownerReview.status || null,
      items: unmatched.slice(0, 20).map(sku => ({
        sku,
        name: null,
        supplier: null,
        workflowStatus: 'pending_manual_review',
        reasonCodes: [],
      })),
      run: runMetadata(metadata),
    },
  };
}

async function getFinalOrder() {
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

  try {
    switch (operation) {
      case 'getStatus':
        return getStatus(parameters);
      case 'getSummary':
        return getSummary(parameters);
      case 'getOwnerReview':
        return getOwnerReview(parameters);
      case 'getFinalOrder':
        return getFinalOrder();
      default:
        throw new UnsupportedOperationError('purchasing', operation);
    }
  } catch (error) {
    if (error instanceof PurchasingRunError) {
      return {
        status: 'success',
        data: {
          summary: `Ошибка чтения данных закупки: ${error.message}`,
          productCount: 0,
          sourceRowsCount: 0,
          reportWarnings: 0,
          demandInputStatus: null,
          run: null,
        },
      };
    }
    throw error;
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
};
