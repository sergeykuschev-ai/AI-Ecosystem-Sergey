'use strict';

/**
 * Semantic classification for owner-review queue.
 *
 * Separates items that truly need an owner decision from informational
 * warnings and confident no-order decisions. Quantities and business
 * recommendations are NOT changed by this classifier.
 */

const OWNER_ACTION_CLASSES = Object.freeze({
  OWNER_ACTION_REQUIRED: 'OWNER_ACTION_REQUIRED',
  WARNING_ONLY: 'WARNING_ONLY',
  SAFE_NO_ORDER: 'SAFE_NO_ORDER',
  POSTPONED: 'POSTPONED',
  RESOLVED: 'RESOLVED',
});

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const n = finiteNumber(value);
    if (n !== null && n > 0) return n;
  }
  return null;
}

function itemQuantities(item) {
  const q = item?.quantities;
  if (q && typeof q === 'object') return q;
  return {
    approved_quantity: finiteNumber(item?.approved_quantity) ??
      finiteNumber(item?.evidence?.phase2_quantity) ?? null,
    provisional_quantity: finiteNumber(item?.provisional_quantity) ?? null,
    calculated_quantity: finiteNumber(item?.calculated_quantity) ??
      finiteNumber(item?.evidence?.phase2_quantity) ?? null,
    analyzer_quantity: finiteNumber(item?.analyzer_quantity) ??
      finiteNumber(item?.evidence?.phase1_quantity) ?? null,
  };
}

function preFinancialQuantity(item) {
  const q = itemQuantities(item);
  return Math.max(
    finiteNumber(q?.calculated_quantity) ?? 0,
    finiteNumber(q?.analyzer_quantity) ?? 0
  );
}

function pendingQuantity(item) {
  const q = itemQuantities(item);
  return finiteNumber(q?.approved_quantity) ??
    finiteNumber(q?.provisional_quantity) ??
    finiteNumber(q?.calculated_quantity) ??
    finiteNumber(q?.analyzer_quantity) ??
    null;
}

function preFinancialValue(item) {
  const qty = preFinancialQuantity(item);
  const price = finiteNumber(
    item?.amounts?.unit_price ?? item?.evidence?.purchase_price ?? null
  );
  if (qty > 0 && price !== null) {
    return Math.round(qty * price * 100) / 100;
  }
  return 0;
}

function itemRole(item) {
  return item?.matrix?.role ?? item?.suggested_role ?? null;
}

function itemReasonCodes(item) {
  return item?.matrix?.reason_codes ?? item?.reason_codes ?? [];
}

function itemOwnerReviewReasons(item) {
  return item?.matrix?.owner_review_reasons ??
    item?.manual_review_reasons ?? [];
}

function itemMissingFields(item) {
  return item?.matrix?.missing_fields ??
    item?.data_quality?.missing_fields ?? [];
}

function hasReasonCode(item, code) {
  return itemReasonCodes(item).includes(code);
}

function hasOwnerReviewReason(item, reason) {
  return itemOwnerReviewReasons(item).includes(reason);
}

function hasMissingField(item, field) {
  return itemMissingFields(item).includes(field);
}

/**
 * Classifies an item into an owner-action class.
 *
 * Accepts both the decorated web-backend item shape and the raw Matrix Builder
 * draft item shape so the same semantics can be reused in reports and summaries.
 *
 * @param {object} item - decorated purchasing item or Matrix Builder draft item
 * @returns {string} one of OWNER_ACTION_CLASSES
 */
function classifyOwnerAction(item) {
  const ownerDecision =
    item?.owner_decision?.decision ??
    item?.owner_order_decision ??
    null;

  // Already resolved by an explicit owner decision.
  if (ownerDecision === 'BUY' || ownerDecision === 'SKIP' ||
      ownerDecision === 'DEFER') {
    return OWNER_ACTION_CLASSES.RESOLVED;
  }

  // Postponed is a distinct transient state.
  const itemDecision = item?.decision ?? item?.evidence?.phase2_decision ?? null;
  if (
    itemDecision === 'postpone' ||
    item?.workflow_status === 'postponed'
  ) {
    return OWNER_ACTION_CLASSES.POSTPONED;
  }

  const role = itemRole(item);
  const pendingQty = pendingQuantity(item);
  const preFinQty = preFinancialQuantity(item);
  const preFinValue = preFinancialValue(item);
  const approvedQty = finiteNumber(itemQuantities(item).approved_quantity);
  const ownerReviewFlag =
    item?.matrix?.owner_review_required ??
    item?.owner_action_required ??
    false;

  // Financial Controller stopped a meaningful positive recommendation.
  // This is a real blocker even when the final quantity became 0.
  if (approvedQty === 0 && preFinQty > 0 && preFinValue >= 100) {
    return OWNER_ACTION_CLASSES.OWNER_ACTION_REQUIRED;
  }

  // Real business conflicts that cannot be auto-resolved.
  if (hasReasonCode(item, 'approved_policy_conflict')) {
    return OWNER_ACTION_CLASSES.OWNER_ACTION_REQUIRED;
  }
  if (hasReasonCode(item, 'ambiguous_identity')) {
    return OWNER_ACTION_CLASSES.OWNER_ACTION_REQUIRED;
  }

  // Critical assortment role with missing stock data: owner must decide.
  if (
    (role === 'CORE' || role === 'TEST') &&
    (
      hasMissingField(item, 'free_stock') ||
      hasMissingField(item, 'stock_days') ||
      hasReasonCode(item, 'missing_inventory_data')
    )
  ) {
    return OWNER_ACTION_CLASSES.OWNER_ACTION_REQUIRED;
  }

  // Real owner-decision conflicts or forced review override the nominal role.
  if (
    item?.owner_decision_conflict === true ||
    item?.owner_decision_force_review === true
  ) {
    return OWNER_ACTION_CLASSES.OWNER_ACTION_REQUIRED;
  }

  // Positive pending recommendations need owner attention only when the
  // owner-review layer has already flagged the row. This preserves the
  // separation between workflow-level pending and owner-review-required.
  if (
    pendingQty !== null &&
    pendingQty > 0 &&
    ownerReviewFlag === true
  ) {
    return OWNER_ACTION_CLASSES.OWNER_ACTION_REQUIRED;
  }

  // Auto-approved positions that already enter the final order are resolved
  // from the owner-queue point of view. They remain visible as confirmed.
  if (
    ownerReviewFlag === false &&
    item?.workflow_status === 'auto_approved' &&
    pendingQty !== null &&
    pendingQty > 0
  ) {
    return OWNER_ACTION_CLASSES.RESOLVED;
  }

  // EXIT candidates without conflict are normal do-not-order results.
  if (role === 'EXIT') {
    return OWNER_ACTION_CLASSES.SAFE_NO_ORDER;
  }

  // Hard informational warnings: always surface, even when qty=0.
  if (
    hasReasonCode(item, 'large_inventory_days') ||
    hasReasonCode(item, 'large_inventory_value') ||
    hasReasonCode(item, 'large_inventory_units_fallback') ||
    hasReasonCode(item, 'large_inventory_units')
  ) {
    return OWNER_ACTION_CLASSES.WARNING_ONLY;
  }
  if (hasReasonCode(item, 'missing_stable_identifier')) {
    return OWNER_ACTION_CLASSES.WARNING_ONLY;
  }
  if (role === 'UNCLASSIFIED') {
    return OWNER_ACTION_CLASSES.WARNING_ONLY;
  }

  // Confident no-buy decisions with no real blocker are safe no-order results.
  const confidentNoBuy =
    itemDecision === 'do_not_buy' ||
    item?.workflow_status === 'no_order_action' ||
    item?.workflow_status === 'confidently_excluded';
  if (confidentNoBuy) {
    return OWNER_ACTION_CLASSES.SAFE_NO_ORDER;
  }

  return OWNER_ACTION_CLASSES.SAFE_NO_ORDER;
}

module.exports = {
  OWNER_ACTION_CLASSES,
  classifyOwnerAction,
  pendingQuantity,
  preFinancialQuantity,
  preFinancialValue,
};
