const { canonicalSupplierName } = require('./demand_engine');

// Canonical assortment rules are explicit overrides/protections, not a global
// whitelist. A product that is absent from the matrix may still follow the
// deterministic demand decision when identity and source data are unambiguous.
// Ambiguous assortment identity remains a hard blocker.
const TRUSTED_OPERATIONAL_SUPPLIER_GROUPS = new Set(['валта', 'зооград']);

const UNMATCHED_CLASSES = Object.freeze({
  REVIEW_REQUIRED: 'UNMATCHED_REVIEW_REQUIRED',
  CONFIDENTLY_EXCLUDED: 'UNMATCHED_CONFIDENTLY_EXCLUDED',
  NON_BLOCKING: 'UNMATCHED_NON_BLOCKING',
});

// Keep the matcher's evidence rather than inferring conflicts from articles.
function buildAmbiguousAssortmentIndex(results = []) {
  const index = new Map();
  for (const result of results) {
    if (result.status !== 'ambiguous') continue;
    const evidence = {
      itemIndex: result.itemIndex ?? null,
      recordIndex: result.recordIndex ?? null,
      candidateRowIdentities: [...result.candidateRowIdentities],
    };
    for (const identity of evidence.candidateRowIdentities) {
      if (!index.has(identity)) index.set(identity, []);
      index.get(identity).push(evidence);
    }
  }
  return index;
}

function guardUnmatchedProduct(product, decision, ambiguousMatches = []) {
  const previousProvenance = product.unmatchedGuard?.provenance;
  const conflicts = ambiguousMatches.length > 0
    ? ambiguousMatches : previousProvenance?.ambiguousMatches || [];
  const ambiguous = conflicts.length > 0 ||
    product.warnings?.includes('ambiguous_assortment_match') === true ||
    decision.warnings?.includes('ambiguous_assortment_match') === true;
  if (!ambiguous && product.activeOwnerOrderDecision?.applied === true) {
    return { product, decision };
  }
  if (!ambiguous && product.assortmentPolicy?.matched !== false) return { product, decision };
  const excluded = !ambiguous && decision.decision === 'do_not_buy' &&
    decision.decisionBasis === 'phase2_calculated' &&
    product.finalRecommendedQuantity === 0 && decision.requiredData.length === 0;
  const reason = ambiguous ? 'ambiguous_assortment_match' : excluded
    ? 'unmatched_deterministic_no_demand'
    : 'unmatched_assortment_advisory';
  const provenance = {
    source: ambiguous
      ? 'owner_ambiguous_assortment_safety_policy_2026_09_09'
      : 'assortment_overlay_policy_2026_09_13',
    priorDecision: decision.decision,
    priorReasons: [...decision.reasons],
    calculatedDemandQuantity: product.demandCalculatedQuantity ?? null,
    preGuardFinalRecommendedQuantity: product.finalRecommendedQuantity,
    ...previousProvenance,
    ...(ambiguous ? { ambiguousMatches: conflicts } : {}),
  };

  const trustedOperationalSupplier = TRUSTED_OPERATIONAL_SUPPLIER_GROUPS.has(
    canonicalSupplierName(product.supplier)
  );

  if (!ambiguous && !excluded && trustedOperationalSupplier) {
    return {
      product: {
        ...product,
        unmatchedObservation: {
          classification: UNMATCHED_CLASSES.NON_BLOCKING,
          reasonCode: reason,
          provenance: {
            ...provenance,
            supplierGroup: canonicalSupplierName(product.supplier),
          },
        },
      },
      decision,
    };
  }

  const blockingReason = ambiguous
    ? reason
    : 'unmatched_product_no_assortment_policy';
  const guard = {
    classification: excluded
      ? UNMATCHED_CLASSES.CONFIDENTLY_EXCLUDED
      : UNMATCHED_CLASSES.REVIEW_REQUIRED,
    reasonCode: blockingReason,
    provenance,
  };
  return {
    product: { ...product, unmatchedGuard: guard },
    decision: excluded ? { ...decision, approvedOrderQuantity: null } : {
      ...decision,
      decision: 'manual_review',
      approvedOrderQuantity: null,
      reasons: [blockingReason, ...decision.reasons.filter(value => value !== blockingReason)],
      warnings: [...new Set([...decision.warnings, 'suspicious_unmatched_product'])],
    },
  };
}

module.exports = { UNMATCHED_CLASSES, buildAmbiguousAssortmentIndex, guardUnmatchedProduct };
