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
const DUPLICATE_ORDER_RISK_CODE = 'DUPLICATE_ORDER_RISK';
const DUPLICATE_ORDER_RISK_MESSAGE =
  'Заказ поставщику заблокирован: найден недавно сформированный идентичный активный заказ. ' +
  'Проверьте, что предыдущий заказ уже получен или отменён.';

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
    this.purchaseLedgerService = options.purchaseLedgerService || null;
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
   * Полная каноническая модель финального заказа. Не отдаётся наружу
   * напрямую: она содержит included/excluded rows для экспортёров.
   */
  buildCanonicalFinalOrderState(runId) {
    ensureCompleted(this.queryService.getRunStatus(runId));
    const items = this.queryService.getDecoratedItems(runId);
    const summary = this.registry.getRunSummary(runId);
    const agentArtifact = this.registry.getAgentResult(runId);
    const agent = Array.isArray(agentArtifact)
      ? agentArtifact[0]?.json
      : agentArtifact?.json || agentArtifact;
    return buildFinalOrderState({
      items,
      maximumSafeOrderAmount:
        summary?.financial?.maximum_safe_order_amount ?? null,
      initialRecommendation: {
        // Older completed runs have a persisted summary created before
        // analyzer_order_lines was added. Fall back to the immutable agent
        // artifact so the UI can still show the real Min/Max line count.
        itemCount: summary?.amounts?.analyzer_order_lines ??
          agent?.order_rows_count ?? null,
        totalAmount: summary?.amounts?.analyzer_order_sum ?? null,
      },
    });
  }

  /**
   * Публичный DTO финального заказа для UI/API. Единственный источник
   * чисел — полная каноническая модель выше.
   */
  getFinalOrderState(runId) {
    const state = this.buildCanonicalFinalOrderState(runId);
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
      ownerDecisionComplete: state.ownerDecisionComplete,
      ownerDecisionUnresolvedCount: state.ownerDecisionUnresolvedCount,
      ownerDecisionUnresolvedAmount: state.ownerDecisionUnresolvedAmount,
      dataBlockedCount: state.dataBlockedCount,
      dataBlockedAmount: state.dataBlockedAmount,
      missingPriceIncludedCount: state.missingPriceIncludedCount,
      duplicateIncludedSkus: state.duplicateIncludedSkus,
      remainingBudget: state.remainingBudget,
      initialRecommendation: state.initialRecommendation,
    };
  }

  nowIso() {
    const value = this.now();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  duplicateRiskFor(runId, supplier, order) {
    if (!this.purchaseLedgerService) return null;
    return this.purchaseLedgerService.findDuplicateRisk({
      runId,
      supplier,
      order,
      asOf: this.nowIso(),
    });
  }

  recordDownloadedOrder(runId, order) {
    if (!this.purchaseLedgerService || !order) return null;
    const items = this.queryService.getDecoratedItems(runId);
    const supplier = this.supplierFor(runId, items);
    return this.purchaseLedgerService.recordOrder({
      runId,
      supplier,
      order,
      orderedAt: this.nowIso(),
    });
  }

  buildOrder(runId) {
    this.assertMinMaxSafety(runId);
    const items = this.queryService.getDecoratedItems(runId);
    const state = this.buildCanonicalFinalOrderState(runId);
    if (Number.isFinite(state.remainingBudget) && state.remainingBudget < 0) {
      throw new SupplierOrderError(
        SUPPLIER_ORDER_BLOCKED_CODE,
        `Заказ поставщику заблокирован: сумма превышает разрешённый бюджет на ${Math.abs(state.remainingBudget).toFixed(2)} ₽. Сначала сократите заказ до разрешённой суммы.`
      );
    }
    const supplier = this.supplierFor(runId, items);
    const order = buildSupplierOrder({
      items,
      state,
      supplier,
      generatedAt: this.now(),
    });
    const duplicateRisk = this.duplicateRiskFor(runId, supplier, order);
    if (duplicateRisk?.exactDuplicate) {
      throw new SupplierOrderError(
        DUPLICATE_ORDER_RISK_CODE,
        DUPLICATE_ORDER_RISK_MESSAGE,
        { details: duplicateRisk }
      );
    }
    order.duplicateRisk = duplicateRisk;
    return order;
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
        duplicateRisk: order.duplicateRisk || null,
        blockedReason: null,
      };
    } catch (error) {
      if (
        error instanceof SupplierOrderError &&
        [SUPPLIER_ORDER_BLOCKED_CODE, DUPLICATE_ORDER_RISK_CODE].includes(
          error.code
        )
      ) {
        return {
          run_id: runId,
          available: false,
          filename: null,
          mimeType: XLSX_CONTENT_TYPE,
          downloadUrl: null,
          itemCount: 0,
          totalAmount: null,
          duplicateRisk: error.details || null,
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
      order,
    };
  }
}

module.exports = {
  DUPLICATE_ORDER_RISK_CODE,
  DUPLICATE_ORDER_RISK_MESSAGE,
  MINMAX_SAFETY_BLOCKED_MESSAGE,
  SupplierOrderService,
};
