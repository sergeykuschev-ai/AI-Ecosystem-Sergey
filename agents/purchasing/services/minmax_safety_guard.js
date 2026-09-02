'use strict';

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function positiveSalesEvidence(row) {
  const directFields = [
    'reportedSalesQuantity',
    'sales7',
    'sales14',
    'sales28',
  ];

  if (directFields.some(field => finiteNumber(row[field]) && row[field] > 0)) {
    return true;
  }

  return Array.isArray(row.weeklySalesHistory) && row.weeklySalesHistory.some(period =>
    finiteNumber(period?.quantity) && period.quantity > 0
  );
}

function sourceFreeStockIsBlank(row) {
  const sourceToken = row?.sourceTokens?.freeStock;
  return sourceToken === null || sourceToken === undefined || sourceToken === '';
}

function shouldInferConfirmedZero(row) {
  return (
    row?.freeStock === null &&
    row?.stockDays === 0 &&
    sourceFreeStockIsBlank(row) &&
    positiveSalesEvidence(row)
  );
}

function applyMinMaxSafetyGuard(adapterResult) {
  if (!adapterResult || !Array.isArray(adapterResult.rows)) {
    throw new TypeError('MinMax safety guard requires adapterResult.rows.');
  }

  const inferredZeroStockRows = [];
  const zeroStockWithSalesButNoSourceOrder = [];

  const rows = adapterResult.rows.map(row => {
    if (!shouldInferConfirmedZero(row)) return row;

    const corrected = {
      ...row,
      freeStock: 0,
      stockInference: {
        status: 'confirmed_zero_inferred',
        reason: 'blank_free_stock_with_zero_stock_days_and_positive_sales',
        sourceFreeStockToken: row?.sourceTokens?.freeStock ?? null,
        originalFreeStock: row.freeStock,
      },
      safetyWarnings: Array.from(new Set([
        ...(Array.isArray(row.safetyWarnings) ? row.safetyWarnings : []),
        'FREE_STOCK_BLANK_INFERRED_ZERO',
      ])),
    };

    const diagnostic = {
      rowIdentity: row.rowIdentity,
      rowNumber: row.rowNumber,
      article: row.article || null,
      name: row.name || null,
      supplier: row.supplier || null,
      abc: row.abc || null,
      xyz: row.xyz || null,
      reportedSalesQuantity: row.reportedSalesQuantity ?? null,
      sales7: row.sales7 ?? null,
      sales14: row.sales14 ?? null,
      sales28: row.sales28 ?? null,
      sourceOrderQty: row.orderQty ?? null,
      action: 'free_stock_normalized_to_confirmed_zero_before_demand_calculation',
    };
    inferredZeroStockRows.push(diagnostic);

    if (!finiteNumber(row.orderQty) || row.orderQty <= 0) {
      zeroStockWithSalesButNoSourceOrder.push({
        ...diagnostic,
        warning: 'ZERO_STOCK_WITH_SALES_BUT_NO_SOURCE_ORDER',
        action: 'do_not_trust_source_zero_order;recalculate_with_demand_engine',
      });
    }

    return corrected;
  });

  return {
    ...adapterResult,
    rows,
    diagnostics: {
      ...(adapterResult.diagnostics || {}),
      minMaxSafety: {
        version: 'minmax-safety-v1',
        inferredZeroStockCount: inferredZeroStockRows.length,
        inferredZeroStockRows,
        zeroStockWithSalesButNoSourceOrderCount:
          zeroStockWithSalesButNoSourceOrder.length,
        zeroStockWithSalesButNoSourceOrder,
      },
    },
  };
}

module.exports = {
  applyMinMaxSafetyGuard,
  positiveSalesEvidence,
  shouldInferConfirmedZero,
};
