const CRITICAL_MISSING_WARNING =
  'В отчёте поставщика отсутствуют обязательные critical-позиции. Требуется проверить наличие у поставщика или альтернативного поставщика.';
const AVAILABLE_FREE_STOCK_FORMULA =
  'free_stock + in_transit + recommended_order_qty';
const PHYSICAL_STOCK_FORMULA =
  'free_stock + in_transit - reserve + recommended_order_qty';

function round(value, precision = 6) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function recommendedQuantity(product) {
  if (finiteNumber(product.finalRecommendedQuantity)) {
    return product.finalRecommendedQuantity;
  }
  if (finiteNumber(product.analyzerCalculatedQuantity)) {
    return product.analyzerCalculatedQuantity;
  }
  return 0;
}

function resolveInventoryModel(inventoryModel = {}) {
  const subtractReserve =
    inventoryModel.stockBasis === 'physical_stock' ||
    inventoryModel.reserveTreatment === 'subtract_from_physical_stock';

  return subtractReserve
    ? {
      stockBasis: 'physical_stock',
      formula: PHYSICAL_STOCK_FORMULA,
      requiredFields: ['free_stock', 'in_transit', 'reserve'],
    }
    : {
      stockBasis: 'available_free_stock',
      formula: AVAILABLE_FREE_STOCK_FORMULA,
      requiredFields: ['free_stock', 'in_transit'],
    };
}

function buildInventoryProjection(
  product,
  sourceRow,
  matrixItem,
  inventoryModel = {}
) {
  const model = resolveInventoryModel(inventoryModel);
  const freeStock = finiteNumber(product.freeStock) ? product.freeStock : null;
  const inTransit = finiteNumber(product.inTransitQuantity)
    ? product.inTransitQuantity
    : null;
  const reserve = finiteNumber(sourceRow?.reserve) ? sourceRow.reserve : null;
  const orderQuantity = recommendedQuantity(product);
  const values = {
    free_stock: freeStock,
    in_transit: inTransit,
    reserve,
    recommended_order_qty: orderQuantity,
  };
  const missingFields = matrixItem
    ? model.requiredFields.filter(field => !finiteNumber(values[field]))
    : [];
  const calculationStatus = !matrixItem
    ? 'not_applicable'
    : missingFields.length > 0
      ? 'insufficient_data'
      : 'calculated';
  const projectedStock = calculationStatus === 'calculated'
    ? round(
      freeStock +
      inTransit +
      orderQuantity -
      (model.stockBasis === 'physical_stock' ? reserve : 0)
    )
    : null;

  return {
    calculation_status: calculationStatus,
    missing_fields: missingFields,
    formula: matrixItem ? model.formula : null,
    stock_basis: model.stockBasis,
    ...values,
    projected_stock: projectedStock,
    below_matrix_minimum: matrixItem && projectedStock !== null
      ? projectedStock < matrixItem.minimum_shelf_stock
      : null,
  };
}

function matrixAnnotation(match) {
  if (!match) return { matched: false };
  const item = match.item;
  return {
    matched: true,
    match_method: match.matchMethod,
    priority: item.priority,
    minimum_shelf_stock: item.minimum_shelf_stock,
    target_stock: item.target_stock,
    allow_zero_stock: item.allow_zero_stock,
    notes: item.notes,
  };
}

function missingProjectionFields(projection) {
  return projection.missing_fields || [];
}

function withDecision(decision, changes) {
  return {
    ...decision,
    ...changes,
    reasons: Array.from(new Set([
      ...decision.reasons,
      ...(changes.reasons || []),
    ])),
    warnings: Array.from(new Set([
      ...decision.warnings,
      ...(changes.warnings || []),
    ])),
    requiredData: Array.from(new Set([
      ...decision.requiredData,
      ...(changes.requiredData || []),
    ])),
  };
}

function controlDecision(product, decision, match) {
  if (!match || match.item.priority === 'standard') return decision;

  const item = match.item;
  const projection = product.inventory_projection;
  const incompleteFields = missingProjectionFields(projection);
  const quantity = projection.recommended_order_qty;
  const positiveSales = finiteNumber(product.salesDailyRate) && product.salesDailyRate > 0;
  const confirmedZeroMustBuy =
    item.priority === 'critical' &&
    item.allow_zero_stock === false &&
    projection.free_stock === 0 &&
    positiveSales &&
    quantity > 0;

  if (incompleteFields.length > 0) {
    return withDecision(decision, {
      decision: 'manual_review',
      decisionBasis: 'assortment_matrix_data_incomplete',
      approvedOrderQuantity: null,
      reasons: ['assortment_projection_incomplete'],
      requiredData: incompleteFields,
    });
  }

  if (confirmedZeroMustBuy) {
    return withDecision(decision, {
      decision: 'must_buy',
      decisionBasis: 'assortment_matrix_control',
      approvedOrderQuantity: quantity,
      reasons: ['critical_zero_stock_with_confirmed_sales'],
      requiredData: [],
    });
  }

  if (projection.below_matrix_minimum !== true) return decision;

  if (item.priority === 'critical' && decision.decision === 'do_not_buy') {
    return withDecision(decision, quantity > 0
      ? {
        decision: 'must_buy',
        decisionBasis: 'assortment_matrix_control',
        approvedOrderQuantity: quantity,
        reasons: ['critical_projected_stock_below_minimum'],
      }
      : {
        decision: 'manual_review',
        decisionBasis: 'assortment_matrix_control',
        approvedOrderQuantity: null,
        reasons: ['critical_below_minimum_without_positive_quantity'],
        requiredData: ['recommended_order_quantity'],
      });
  }

  if (item.priority === 'important') {
    return withDecision(decision, quantity > 0
      ? {
        decision: 'recommended',
        decisionBasis: 'assortment_matrix_control',
        approvedOrderQuantity: quantity,
        reasons: ['important_projected_stock_below_minimum'],
      }
      : {
        decision: 'manual_review',
        decisionBasis: 'assortment_matrix_control',
        approvedOrderQuantity: null,
        reasons: ['important_below_minimum_without_positive_quantity'],
        requiredData: ['recommended_order_quantity'],
      });
  }

  return decision;
}

function missingMatrixItems(matrix, matchResult) {
  return matchResult.itemResults
    .filter(result => result.status !== 'matched')
    .map(result => {
      const item = matrix.items[result.itemIndex];
      return {
        article: item.article,
        name: item.name,
        priority: item.priority,
        reason: result.status === 'ambiguous'
          ? 'ambiguous_supplier_report_match'
          : 'not_found_in_supplier_report',
      };
    });
}

function applyAssortmentMatrixControl({
  analysis,
  demandProducts,
  decisions,
  matrix,
  matchResult,
  source = 'file',
  inventoryModel = {},
}) {
  const rowsByIdentity = new Map(
    analysis.productRows.map(row => [row.rowIdentity, row])
  );
  const decisionsByIdentity = new Map(
    decisions.map(decision => [decision.rowIdentity, decision])
  );
  const products = demandProducts.map(product => {
    const match = matchResult.matchesByRowIdentity.get(product.rowIdentity) || null;
    const sourceRow = rowsByIdentity.get(product.rowIdentity) || null;
    return {
      ...product,
      assortment_matrix: matrixAnnotation(match),
      inventory_projection: buildInventoryProjection(
        product,
        sourceRow,
        match?.item || null,
        inventoryModel
      ),
    };
  });
  const controlledDecisions = products.map(product => {
    const decision = decisionsByIdentity.get(product.rowIdentity);
    if (!decision) {
      throw new TypeError(`Не найдено решение Phase 2 для ${product.rowIdentity}.`);
    }
    const match = matchResult.matchesByRowIdentity.get(product.rowIdentity) || null;
    return controlDecision(product, decision, match);
  });
  const controlledByIdentity = new Map(
    controlledDecisions.map(decision => [decision.rowIdentity, decision])
  );
  const missingItems = missingMatrixItems(matrix, matchResult);
  const criticalBelowMinimum = products.filter(product =>
    product.assortment_matrix.matched &&
    product.assortment_matrix.priority === 'critical' &&
    product.inventory_projection.below_matrix_minimum === true
  );
  const matrixManualReview = products.filter(product =>
    product.assortment_matrix.matched &&
    controlledByIdentity.get(product.rowIdentity)?.decision === 'manual_review' &&
    String(
      controlledByIdentity.get(product.rowIdentity)?.decisionBasis || ''
    ).startsWith('assortment_matrix_')
  );
  const warnings = missingItems.some(item => item.priority === 'critical')
    ? [CRITICAL_MISSING_WARNING]
    : [];

  return {
    products,
    decisions: controlledDecisions,
    summary: {
      source,
      total_matrix_items: matrix.items.length,
      matched_matrix_items: matchResult.itemResults.filter(
        result => result.status === 'matched'
      ).length,
      missing_matrix_items_count: missingItems.length,
      critical_items_count: matrix.items.filter(
        item => item.priority === 'critical'
      ).length,
      critical_below_minimum_count: criticalBelowMinimum.length,
      manual_review_count: matrixManualReview.length,
      inventory_projection_calculated_count: products.filter(
        product => product.inventory_projection.calculation_status === 'calculated'
      ).length,
      inventory_projection_insufficient_data_count: products.filter(
        product =>
          product.inventory_projection.calculation_status === 'insufficient_data'
      ).length,
    },
    missingMatrixItems: missingItems,
    criticalBelowMinimum,
    warnings,
  };
}

module.exports = {
  CRITICAL_MISSING_WARNING,
  AVAILABLE_FREE_STOCK_FORMULA,
  PHYSICAL_STOCK_FORMULA,
  resolveInventoryModel,
  buildInventoryProjection,
  matrixAnnotation,
  controlDecision,
  missingMatrixItems,
  applyAssortmentMatrixControl,
};
