function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function indexByIdentity(items) {
  return new Map((items || [])
    .filter(item => typeof item?.rowIdentity === 'string')
    .map(item => [item.rowIdentity, item]));
}

function sectionMemberships(ownerReview) {
  const memberships = new Map();
  const add = (rowIdentity, section) => {
    if (!memberships.has(rowIdentity)) memberships.set(rowIdentity, []);
    memberships.get(rowIdentity).push(section);
  };
  for (const [section, value] of Object.entries(ownerReview?.sections || {})) {
    if (section === 'data_quality') {
      Object.entries(value || {}).forEach(([group, rowIdentities]) => {
        (rowIdentities || []).forEach(rowIdentity =>
          add(rowIdentity, `data_quality:${group}`)
        );
      });
    } else {
      (value || []).forEach(rowIdentity => add(rowIdentity, section));
    }
  }
  return memberships;
}

function explanationCodes(explanation) {
  return (explanation?.explanation_reasons || [])
    .map(reason => reason?.code)
    .filter(code => typeof code === 'string');
}

function mapPurchasingItems(bundle) {
  const agent = bundle.agentResult?.[0]?.json || {};
  const products = agent.workingOrderProducts || [];
  const decisions = indexByIdentity(agent.decisions);
  const matrixItems = indexByIdentity(bundle.matrixDraft?.items);
  const ownerItems = indexByIdentity(bundle.ownerReview?.items);
  const memberships = sectionMemberships(bundle.ownerReview);
  const explanationItems = bundle.explanations?.items || [];

  return products.map((product, index) => {
    const rowIdentity = product.rowIdentity;
    const decision = decisions.get(rowIdentity) || {};
    const matrix = matrixItems.get(rowIdentity) || {};
    const owner = ownerItems.get(rowIdentity) || {};
    const explanation = explanationItems[index] || {};
    const approvedQuantity = finiteOrNull(product.approvedOrderQuantity);
    const provisionalQuantity = finiteOrNull(
      product.provisionalOrderQuantity
    );

    return {
      row_id: rowIdentity,
      source_row: Number.isInteger(product.rowNumber)
        ? product.rowNumber
        : null,
      sku: product.article ||
        product.barcode ||
        product.internalProductId ||
        null,
      name: product.name || null,
      supplier: product.supplier || null,
      decision: decision.decision || product.phase2Decision || null,
      workflow_status: product.workflowStatus || null,
      confidence: explanation.confidence_level ||
        decision.confidence ||
        null,
      matrix: {
        role: matrix.suggested_role ||
          explanation.calculation_facts?.matrix_role ||
          null,
        priority: matrix.suggested_priority || null,
        owner_review_required: owner.owner_action_required === true,
        owner_review_priority: owner.owner_review_priority || null,
        owner_review_score: finiteOrNull(owner.owner_review_score),
        owner_review_reasons: Array.isArray(owner.owner_review_reasons)
          ? [...owner.owner_review_reasons]
          : [],
        owner_review_sections: [
          ...(memberships.get(rowIdentity) || []),
        ],
        recommended_action: owner.recommended_action || null,
      },
      stock: {
        free_stock: finiteOrNull(product.freeStock),
        stock_known: typeof product.freeStock === 'number' &&
          Number.isFinite(product.freeStock),
      },
      sales: {
        last_28_days: finiteOrNull(product.sales28),
      },
      quantities: {
        analyzer_quantity: finiteOrNull(
          product.analyzerCalculatedQuantity
        ),
        calculated_quantity: finiteOrNull(
          product.finalRecommendedQuantity
        ),
        approved_quantity: approvedQuantity,
        provisional_quantity: provisionalQuantity,
      },
      amounts: {
        unit_price: finiteOrNull(product.priceNum),
        approved_line_value: approvedQuantity === null
          ? null
          : finiteOrNull(product.approvedLineSum),
        provisional_line_value: provisionalQuantity === null
          ? null
          : finiteOrNull(product.provisionalLineSum),
      },
      explanation: {
        summary: explanation.explanation_summary || null,
        reason_codes: explanationCodes(explanation),
        risk_flags: Array.isArray(explanation.risk_flags)
          ? [...explanation.risk_flags]
          : [],
      },
    };
  });
}

module.exports = {
  explanationCodes,
  finiteOrNull,
  indexByIdentity,
  mapPurchasingItems,
  sectionMemberships,
};
