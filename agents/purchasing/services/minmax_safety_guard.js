'use strict';

const REQUIRED_CATALOG = require('../../../data/purchasing/miska-minmax-required-skus.json');

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
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

function isValtaReport(rows) {
  return rows.some(row => normalizeText(row?.supplier).includes('валта'));
}

function matchesRequiredItem(row, item) {
  const name = normalizeText(row?.name);
  return Array.isArray(item.match_tokens) &&
    item.match_tokens.length > 0 &&
    item.match_tokens.every(token => name.includes(normalizeText(token)));
}

function requiredCatalogCoverage(rows, catalog = REQUIRED_CATALOG) {
  if (!isValtaReport(rows)) {
    return {
      checked: false,
      reason: 'report_is_not_valta_scope',
      missingItems: [],
      duplicateItems: [],
      blockingIssues: [],
    };
  }

  const missingItems = [];
  const duplicateItems = [];

  for (const item of catalog.items || []) {
    const matches = rows.filter(row => matchesRequiredItem(row, item));
    if (matches.length === 0) {
      missingItems.push({
        key: item.key,
        supplierGroup: item.supplier_group || null,
        brand: item.brand || null,
        targetStock: item.target_stock ?? null,
        matchTokens: [...(item.match_tokens || [])],
        blocking: item.blocking_if_missing === true,
        warning: 'ACTIVE_REQUIRED_SKU_MISSING_FROM_MINMAX_REPORT',
        action: 'verify_current_1c_stock_and_supplier_mapping_before_order_export',
      });
    } else if (matches.length > 1) {
      duplicateItems.push({
        key: item.key,
        rowIdentities: matches.map(row => row.rowIdentity),
        rowNumbers: matches.map(row => row.rowNumber),
        warning: 'REQUIRED_SKU_MATCHED_MULTIPLE_REPORT_ROWS',
        action: 'manual_mapping_review_required',
      });
    }
  }

  return {
    checked: true,
    catalogVersion: catalog.version || null,
    missingItems,
    duplicateItems,
    blockingIssues: missingItems.filter(item => item.blocking),
  };
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

  const coverage = requiredCatalogCoverage(rows);

  return {
    ...adapterResult,
    rows,
    diagnostics: {
      ...(adapterResult.diagnostics || {}),
      minMaxSafety: {
        version: 'minmax-safety-v2',
        inferredZeroStockCount: inferredZeroStockRows.length,
        inferredZeroStockRows,
        zeroStockWithSalesButNoSourceOrderCount:
          zeroStockWithSalesButNoSourceOrder.length,
        zeroStockWithSalesButNoSourceOrder,
        requiredCatalogChecked: coverage.checked,
        requiredCatalogMissingCount: coverage.missingItems.length,
        requiredCatalogMissingItems: coverage.missingItems,
        requiredCatalogDuplicateCount: coverage.duplicateItems.length,
        requiredCatalogDuplicateItems: coverage.duplicateItems,
        blockingIssueCount:
          coverage.blockingIssues.length + coverage.duplicateItems.length,
        blockingIssues: [
          ...coverage.blockingIssues,
          ...coverage.duplicateItems,
        ],
      },
    },
  };
}

module.exports = {
  applyMinMaxSafetyGuard,
  matchesRequiredItem,
  positiveSalesEvidence,
  requiredCatalogCoverage,
  shouldInferConfirmedZero,
};
