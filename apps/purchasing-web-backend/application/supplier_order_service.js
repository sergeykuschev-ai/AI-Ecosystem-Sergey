'use strict';

const {
  SUPPLIER_ORDER_BLOCKED_CODE,
  SupplierOrderError,
  buildSupplierOrder,
  buildSupplierOrderXlsx,
} = require('../../../agents/purchasing/services/supplier_order');
const {
  buildFinalOrderState,
} = require('../../../agents/purchasing/services/final_order');
const {
  XLSX_CONTENT_TYPE,
} = require('../../../shared/reporting/xlsx_exporter');
const {
  ensureCompleted,
} = require('./run_query_service');

const MINMAX_SAFETY_BLOCKED_MESSAGE =
  'Заказ поставщику заблокирован: Min/Max не содержит обязательные позиции ' +
  'или содержит неоднозначное сопоставление. Сначала проверьте остатки 1С ' +
  'и привязку номенклатуры.';

class SupplierOrderService {
  constructor(options = {}) {
    if (!options.queryService) {
      throw new TypeError('Run query service обязателен.');
    }
    if (!options.registry) {
      throw new TypeError('Run registry обязателен.');
    }
    this.queryService = options.queryService;
    this.registry = options.registry;
    this.now = options.now || (() => new Date());
  }

  agentJsonFor(runId) {
    try {
      return this.registry.getAgentResult(runId)?.[0]?.json || null;
    } catch {
      return null;
    }
  }

  supplierFor(runId, items) {
    const supplier = this.agentJsonFor(runId)?.supplier;
    if (typeof supplier === 'string' && supplier.trim() !== '') {
      return supplier;
    }
    const item = (items || []).find(candidate =>
      typeof candidate?.supplier === 'string' &&
      candidate.supplier.trim() !== ''
    );
    return item ? item.supplier : null;
  }

  minMaxSafetyFor(runId) {
    return this.agentJsonFor(runId)?.adapter_diagnostics?.minMaxSafety || null;
  }

  assertMinMaxSafety(runId) {
    const safety = this.minMaxSafetyFor(runId);
    if (!safety || !(safety.blockingIssueCount > 0)) return;

    throw new SupplierOrderError(
      SUPPLIER_ORDER_BLOCKED_CODE,
      MINMAX_SAFETY_BLOCKED_MESSAGE,
      {
        details: {
          blocking_issue_count: safety.blockingIssueCount,
          blocking_issues: safety.blockingIssues || [],
        },
      }
    );
  }

  /**
   * Каноническое финальное состояние заказа run. Единый источник
   * правды для UI summary, supplier-order API и Excel.
   */
  getFinalOrderState(runId) {
    ensureCompleted(this.queryService.getRunStatus(runId));
    const items = this.queryService.getDecoratedItems(runId);
    const summary = this.registry.getRunSummary(runId);
    const state = buildFinalOrderState({
      items,
      maximumSafeOrderAmount:
        summary?.financial?.maximum_safe_order_amount ?? null,
      initialRecommendation: {
        itemCount: summary?.sku_count ?? null,
        totalAmount: summary?.amounts?.analyzer_order_sum ?? null,
      },
    });
    return {
      run_id: runId,
      status: state.status,
      reviewComplete: state.reviewComplete,
      itemCount: state.itemCount,
      totalQuantity: state.totalQuantity,
      totalAmount: state.totalAmount,
      autoApprovedAmount: state.autoApprovedAmount,
      manuallyApprovedAmount: state.manuallyApprovedAmount,
      skippedAmount: state.skippedAmount,
      deferredAmount: state.deferredAmount,
      unresolvedCount: state.unresolvedCount,
      unresolvedAmount: state.unresolvedAmount,
      missingPriceIncludedCount: state.missingPriceIncludedCount,
      duplicateIncludedSkus: state.duplicateIncludedSkus,
      remainingBudget: state.remainingBudget,
      initialRecommendation: state.initialRecommendation,
    };
  }

  buildOrder(runId) {
    this.assertMinMaxSafety(runId);
    const items = this.queryService.getDecoratedItems(runId);
    return buildSupplierOrder({
      items,
      supplier: this.supplierFor(runId, items),
      generatedAt: this.now(),
    });
  }

  getSupplierOrder(runId) {
    ensureCompleted(this.queryService.getRunStatus(runId));
    try {
      const order = this.buildOrder(runId);
      return {
        run_id: runId,
        available: true,
        filename: order.filename,
        mimeType: XLSX_CONTENT_TYPE,
        downloadUrl: `/api/v1/runs/${runId}/supplier-order/download`,
        itemCount: order.itemCount,
        totalAmount: order.totalAmount,
        blockedReason: null,
      };
    } catch (error) {
      if (
        error instanceof SupplierOrderError &&
        error.code === SUPPLIER_ORDER_BLOCKED_CODE
      ) {
        return {
          run_id: runId,
          available: false,
          filename: null,
          mimeType: XLSX_CONTENT_TYPE,
          downloadUrl: null,
          itemCount: 0,
          totalAmount: null,
          blockedReason: error.message,
        };
      }
      throw error;
    }
  }

  buildSupplierOrderFile(runId) {
    ensureCompleted(this.queryService.getRunStatus(runId));
    const order = this.buildOrder(runId);
    return {
      filename: order.filename,
      contentType: XLSX_CONTENT_TYPE,
      content: Buffer.from(buildSupplierOrderXlsx(order)),
      itemCount: order.itemCount,
      totalAmount: order.totalAmount,
    };
  }
}

module.exports = {
  MINMAX_SAFETY_BLOCKED_MESSAGE,
  SupplierOrderService,
};
