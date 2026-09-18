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

function formatMoney(value) {
  if (!Number.isFinite(value)) return 'нет данных';
  return `${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ₽`;
}

function formatCompletedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Vladivostok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replace(',', '');
}

function tryGetOwnerReview(resolver, runId) {
  try {
    return resolver.getOwnerReview(runId);
  } catch {
    return null;
  }
}

function formatPurchasingOverview(metadata, summary, ownerReview) {
  const amounts = summary.amounts || {};
  const phase2 = summary.phase2 || {};
  const lines = [
    'Закупщик — последний завершённый расчёт',
    `${summary.sku_count ?? 0} SKU · ${summary.source_rows_count ?? 0} строк`,
    `Автоодобрено: ${formatMoney(amounts.auto_approved_sum)}`,
    `Ручная проверка: ${phase2.manual_review ?? 0} позиций · ${formatMoney(amounts.pending_review_sum)}`,
    `Must-buy: ${phase2.must_buy ?? 0} · рекомендовано: ${phase2.recommended ?? 0} · отложено: ${phase2.postpone ?? 0}`,
    `Предупреждений: ${(summary.warnings || []).length}`,
  ];
  const ownerLabel = ownerReview?.status?.label;
  if (ownerLabel) lines.push(ownerLabel);
  const completedAt = formatCompletedAt(metadata.completed_at);
  if (completedAt) lines.push(`Завершён: ${completedAt}`);
  return lines.join('\n');
}

async function getStatus(parameters) {
  const resolver = createResolver(parameters);
  const runId = resolveRunId(resolver, parameters);

  if (!runId) {
    return buildNoRunResponse();
  }

  const metadata = resolver.getRunMetadata(runId);
  const summary = resolver.getRunSummary(runId);
  const ownerReview = tryGetOwnerReview(resolver, runId);
  const responseText = formatPurchasingOverview(metadata, summary, ownerReview);

  return {
    status: 'success',
    data: {
      summary: `Закупка: ${summary.sku_count ?? 0} SKU, ${summary.source_rows_count ?? 0} строк`,
      responseText,
      productCount: summary.sku_count ?? 0,
      sourceRowsCount: summary.source_rows_count ?? 0,
      analyzerOrderSum: summary.amounts?.analyzer_order_sum ?? null,
      workingOrderSum: summary.amounts?.auto_approved_sum ?? null,
      pendingReviewSum: summary.amounts?.pending_review_sum ?? null,
      pendingReviewCount: summary.phase2?.manual_review ?? null,
      mustBuyCount: summary.phase2?.must_buy ?? null,
      recommendedCount: summary.phase2?.recommended ?? null,
      postponedCount: summary.phase2?.postpone ?? null,
      reportWarnings: (summary.warnings || []).length,
      ownerReviewStatus: ownerReview?.status || null,
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
  const ownerReview = tryGetOwnerReview(resolver, runId);
  const amounts = summary.amounts || {};
  const phase2 = summary.phase2 || {};
  const responseText = formatPurchasingOverview(metadata, summary, ownerReview);

  return {
    status: 'success',
    data: {
      summary: `Сводка закупки: ${summary.sku_count ?? 0} SKU, ${summary.source_rows_count ?? 0} строк`,
      responseText,
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
