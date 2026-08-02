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
    const minmaxQuantity = finiteOrNull(
      product.minmaxRecommendedQuantity ?? product.finalRecommendedQuantity
    );
    const policyQuantity = finiteOrNull(product.finalRecommendedQuantity);
    const policy = product.assortmentPolicy || null;

    return {
      row_id: rowIdentity,
      source_row: Number.isInteger(product.rowNumber)
        ? product.rowNumber
        : null,
      sku: product.article ||
        product.barcode ||
        product.internalProductId ||
        null,
      barcode: product.barcode || null,
      name: product.name || null,
      brand: product.brand || matrix.brand || null,
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
        reason_codes: Array.isArray(matrix.reason_codes)
          ? [...matrix.reason_codes]
          : [],
        missing_fields: Array.isArray(matrix.data_quality?.missing_fields)
          ? [...matrix.data_quality.missing_fields]
          : [],
        average_weekly_sales: finiteOrNull(
          matrix.evidence?.average_weekly_sales
        ),
        active_week_ratio: finiteOrNull(
          matrix.evidence?.active_week_ratio
        ),
        strategic_protected:
          (matrix.evidence?.strategic_group_matches || []).length > 0,
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
        calculated_quantity: minmaxQuantity,
        minmax_quantity: minmaxQuantity,
        policy_quantity: policyQuantity,
        approved_quantity: approvedQuantity,
        provisional_quantity: provisionalQuantity,
        final_quantity: policyQuantity,
      },
      assortment_policy: policy
        ? {
          matched: policy.matched === true,
          adjusted: policy.policy_adjusted === true,
          rule: policy.policy_rule || 'NONE',
          applied_rules: Array.isArray(policy.applied_rules)
            ? [...policy.applied_rules]
            : [],
          explanation: policy.explanation || null,
          assortment_status: policy.assortment_status || null,
          min_stock: finiteOrNull(policy.min_stock),
          max_stock: finiteOrNull(policy.max_stock),
          target_stock: finiteOrNull(policy.target_stock),
          order_mode: policy.order_mode || null,
          box_qty: finiteOrNull(policy.box_qty),
          display_stock: policy.display_stock === true,
          display_min_qty: finiteOrNull(policy.display_min_qty),
          purchase_hold: policy.purchase_hold === true,
          purchase_hold_until_stock: finiteOrNull(
            policy.purchase_hold_until_stock
          ),
          mandatory_assortment: policy.mandatory_assortment === true,
          owner_comment: policy.owner_comment || '',
          rule_source: policy.rule_source || null,
          projected_stock: finiteOrNull(policy.projected_stock),
          warnings: Array.isArray(policy.policy_warnings)
            ? [...policy.policy_warnings]
            : [],
        }
        : {
          matched: false,
          adjusted: false,
          rule: 'NONE',
          applied_rules: [],
          explanation: null,
          warnings: [],
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
      owner_decision: {
        status: matrix.owner_decision_status || 'none',
        decision: matrix.owner_order_decision || null,
        quantity: finiteOrNull(matrix.owner_order_quantity),
        decided_at: null,
        decided_by: null,
        reason: matrix.owner_decision_summary || null,
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
