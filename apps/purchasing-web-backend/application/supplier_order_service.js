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

  supplierFor(runId, items) {
    try {
      const agentResult = this.registry.getAgentResult(runId);
      const supplier = agentResult?.[0]?.json?.supplier;
      if (typeof supplier === 'string' && supplier.trim() !== '') {
        return supplier;
      }
    } catch {}
    const item = (items || []).find(candidate =>
      typeof candidate?.supplier === 'string' &&
      candidate.supplier.trim() !== ''
    );
    return item ? item.supplier : null;
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
  SupplierOrderService,
};
