function mapOwnerReviewItem(item) {
  return {
    row_id: item.rowIdentity,
    source_row: item.source_row_number ?? null,
    sku: item.article || null,
    name: item.name || null,
    matrix_role: item.suggested_role || null,
    priority: item.owner_review_priority || null,
    score: typeof item.owner_review_score === 'number'
      ? item.owner_review_score
      : null,
    reasons: Array.isArray(item.owner_review_reasons)
      ? [...item.owner_review_reasons]
      : [],
    recommended_action: item.recommended_action || null,
  };
}

function mapOwnerReview(bundle) {
  const review = bundle.ownerReview || {};
  const byIdentity = new Map((review.items || []).map(item => [
    item.rowIdentity,
    item,
  ]));
  const topPriority = (review.sections?.owner_action_required || [])
    .map(rowIdentity => byIdentity.get(rowIdentity))
    .filter(Boolean)
    .map(mapOwnerReviewItem);

  return {
    run_id: bundle.run_id,
    report_version: review.report_version || null,
    status: structuredClone(review.status || null),
    summary: structuredClone(review.summary || {}),
    owner_decisions: structuredClone(review.owner_decisions || {}),
    top_priority: topPriority,
    section: null,
    section_items: [],
    pagination: null,
  };
}

module.exports = {
  mapOwnerReview,
  mapOwnerReviewItem,
};
