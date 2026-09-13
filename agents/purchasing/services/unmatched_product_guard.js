// An absent assortment policy cannot authorize a purchase. Calculated demand
// remains evidence for matrix review, never a fallback permission.
const UNMATCHED_CLASSES = Object.freeze({
  REVIEW_REQUIRED: 'UNMATCHED_REVIEW_REQUIRED',
  CONFIDENTLY_EXCLUDED: 'UNMATCHED_CONFIDENTLY_EXCLUDED',
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
    : 'unmatched_product_no_assortment_policy';
  const guard = {
    classification: excluded ? UNMATCHED_CLASSES.CONFIDENTLY_EXCLUDED : UNMATCHED_CLASSES.REVIEW_REQUIRED,
    reasonCode: reason,
    provenance: {
      source: 'owner_unmatched_safety_policy_2026_09_08',
      priorDecision: decision.decision,
      priorReasons: [...decision.reasons],
      calculatedDemandQuantity: product.demandCalculatedQuantity ?? null,
      preGuardFinalRecommendedQuantity: product.finalRecommendedQuantity,
      ...previousProvenance,
      ...(ambiguous ? {
        source: 'owner_ambiguous_assortment_safety_policy_2026_09_09',
        ambiguousMatches: conflicts,
      } : {}),
    },
  };
  return {
    product: { ...product, unmatchedGuard: guard },
    decision: excluded ? { ...decision, approvedOrderQuantity: null } : {
      ...decision,
      decision: 'manual_review',
      approvedOrderQuantity: null,
      reasons: [reason, ...decision.reasons.filter(value => value !== reason)],
      warnings: [...new Set([...decision.warnings, 'suspicious_unmatched_product'])],
    },
  };
}

module.exports = { UNMATCHED_CLASSES, buildAmbiguousAssortmentIndex, guardUnmatchedProduct };
