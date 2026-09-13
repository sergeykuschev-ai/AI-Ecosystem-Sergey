'use strict';

/**
 * Read-only triage of the purchasing manual review queue.
 *
 * Takes the last completed Purchasing Agent run bundle (agentJson +
 * manualReview + ownerReview) and classifies every problematic position
 * into explicit categories. This module NEVER changes quantities,
 * recommendations, Min/Max values, matrices or owner decisions. It only
 * reads upstream signals (exact canonical matching, adapter diagnostics,
 * existing reason codes) and groups them for the owner.
 *
 * Deterministic: works without any AI provider. See
 * review_triage_explainer.js for optional plain-language enrichment.
 */

const { compactOwnerReview } = require('./owner_review_compactor');

const TRIAGE_VERSION = 'review-triage-v2';

const TRIAGE_CATEGORIES = Object.freeze({
  DATA_ERROR_UNKNOWN_STOCK: 'DATA_ERROR_UNKNOWN_STOCK',
  DATA_ERROR_IDENTITY: 'DATA_ERROR_IDENTITY',
  SUPPLIER_DATA_MISSING: 'SUPPLIER_DATA_MISSING',
  DUPLICATE_SKU: 'DUPLICATE_SKU',
  MATRIX_UNMATCHED: 'MATRIX_UNMATCHED',
  NEW_SKU_REVIEW: 'NEW_SKU_REVIEW',
  SALES_SPIKE_REVIEW: 'SALES_SPIKE_REVIEW',
  FINANCIAL_LIMIT_REVIEW: 'FINANCIAL_LIMIT_REVIEW',
  OWNER_DECISION_REQUIRED: 'OWNER_DECISION_REQUIRED',
  READY_WITH_EXPLANATION: 'READY_WITH_EXPLANATION',
});

const SEVERITY = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  BLOCKING: 'blocking',
});

const OWNER_SECTIONS = Object.freeze({
  READY: 'ready',
  DATA_PROBLEMS: 'data_problems',
  MATRIX_GAPS: 'matrix_gaps',
  OWNER_DECISIONS: 'owner_decisions',
});

/**
 * Lifecycle of an owner business decision on a position. ACTIVE decisions go
 * into the compactor (packages/individuals). BLOCKED_BY_DATA positions keep
 * their owner_signals and requires_owner_decision (the future business choice
 * is not lost), but they cannot be decided until a data/linkage defect or a
 * missing calculated quantity is fixed upstream.
 */
const OWNER_DECISION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  BLOCKED_BY_DATA: 'BLOCKED_BY_DATA',
});

const BLOCKED_BY_DATA_NOTE =
  'После исправления данных может потребоваться решение владельца';

/**
 * Signals whose business question does not depend on a calculated order
 * quantity (e.g. "approve EXIT from the assortment"). For those, a missing
 * recommendedQty must NOT block the owner decision.
 */
const QUANTITY_INDEPENDENT_SIGNALS = new Set([
  'exit_candidate',
  'owner_rejected_exit',
  'strategic_exit_risk',
  'exit_blocked_approved_policy',
]);

const CATEGORY_SECTION = Object.freeze({
  DATA_ERROR_UNKNOWN_STOCK: OWNER_SECTIONS.DATA_PROBLEMS,
  DATA_ERROR_IDENTITY: OWNER_SECTIONS.DATA_PROBLEMS,
  SUPPLIER_DATA_MISSING: OWNER_SECTIONS.DATA_PROBLEMS,
  DUPLICATE_SKU: OWNER_SECTIONS.DATA_PROBLEMS,
  SALES_SPIKE_REVIEW: OWNER_SECTIONS.DATA_PROBLEMS,
  MATRIX_UNMATCHED: OWNER_SECTIONS.MATRIX_GAPS,
  NEW_SKU_REVIEW: OWNER_SECTIONS.MATRIX_GAPS,
  FINANCIAL_LIMIT_REVIEW: OWNER_SECTIONS.OWNER_DECISIONS,
  OWNER_DECISION_REQUIRED: OWNER_SECTIONS.OWNER_DECISIONS,
  READY_WITH_EXPLANATION: OWNER_SECTIONS.READY,
});

const CATEGORY_LABELS_RU = Object.freeze({
  DATA_ERROR_UNKNOWN_STOCK: 'Ошибка данных: остаток неизвестен',
  DATA_ERROR_IDENTITY: 'Ошибка данных: неоднозначная идентификация',
  SUPPLIER_DATA_MISSING: 'Не хватает данных поставщика',
  DUPLICATE_SKU: 'Дубль SKU / артикула',
  MATRIX_UNMATCHED: 'Нет связи с canonical-матрицей',
  NEW_SKU_REVIEW: 'Новый SKU на рассмотрении',
  SALES_SPIKE_REVIEW: 'Аномалия спроса',
  FINANCIAL_LIMIT_REVIEW: 'Финансовое ограничение',
  OWNER_DECISION_REQUIRED: 'Требуется решение владельца',
  READY_WITH_EXPLANATION: 'Готово, объяснение сформировано',
});

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function display(value, fallback = null) {
  return value === null || value === undefined || value === ''
    ? fallback
    : String(value);
}

function isUnknownStock(value) {
  // Unknown stock is strictly null/undefined. Numeric zero is a real value
  // and must never be coerced into this category.
  return value === null || value === undefined;
}

/**
 * Merges every signal source for one review-queue position.
 * Sources never invent data: each field keeps its upstream provenance.
 */
function collectCandidates(bundle) {
  const agentJson = bundle?.agentJson || {};
  const manualReview = bundle?.manualReview || {};
  const ownerReview = bundle?.ownerReview || {};

  const byIdentity = new Map();
  const workingProducts = asArray(agentJson.workingOrderProducts);
  const hasWorkflowState = workingProducts.some(
    product => typeof product?.workflowStatus === 'string'
  );
  const pendingRowIdentities = new Set(
    workingProducts
      .filter(product => product?.workflowStatus === 'pending_manual_review')
      .map(product => product?.rowIdentity)
      .filter(Boolean)
  );

  function candidateFor(key) {
    if (!byIdentity.has(key)) {
      byIdentity.set(key, {
        key,
        rowIdentity: null,
        source_row_number: null,
        article: null,
        barcode: null,
        internal_product_id: null,
        name: null,
        supplier: null,
        category: null,
        suggested_role: null,
        // matrix_builder draft item (may be null for matrix-only gaps)
        draft: null,
        // owner review model entry (may be null)
        review: null,
        // working order product (may be null)
        product: null,
        provenance: [],
      });
    }
    return byIdentity.get(key);
  }

  for (const item of asArray(manualReview.items)) {
    if (!item || typeof item !== 'object') continue;
    if (hasWorkflowState && item.rowIdentity && !pendingRowIdentities.has(item.rowIdentity)) {
      const ownerEntry = asArray(ownerReview.items).find(
        entry => entry?.rowIdentity === item.rowIdentity
      );
      const keepResolvedExplanation = [
        'SAFE_NO_ORDER',
        'POSTPONED',
        'RESOLVED',
      ].includes(ownerEntry?.owner_action_class);
      if (!keepResolvedExplanation) continue;
    }
    const key = item.rowIdentity || `article:${display(item.article, 'unknown')}`;
    const candidate = candidateFor(key);
    candidate.rowIdentity = item.rowIdentity ?? candidate.rowIdentity;
    candidate.source_row_number = item.source_row_number ?? null;
    candidate.article = display(item.article, candidate.article);
    candidate.barcode = display(item.barcode, candidate.barcode);
    candidate.internal_product_id = display(
      item.internal_product_id,
      candidate.internal_product_id
    );
    candidate.name = display(item.name, candidate.name);
    candidate.supplier = display(item.supplier, candidate.supplier);
    candidate.category = display(item.category, candidate.category);
    candidate.suggested_role = item.suggested_role ?? candidate.suggested_role;
    candidate.draft = item;
    candidate.provenance.push('manual_review');
  }

  const reviewByIdentity = new Map();
  for (const entry of asArray(ownerReview.items)) {
    if (entry?.rowIdentity) reviewByIdentity.set(entry.rowIdentity, entry);
  }
  for (const candidate of byIdentity.values()) {
    const review = candidate.rowIdentity
      ? reviewByIdentity.get(candidate.rowIdentity)
      : null;
    if (review) {
      candidate.review = review;
      candidate.provenance.push('owner_review');
    }
  }

  const productByIdentity = new Map();
  for (const product of asArray(agentJson.workingOrderProducts)) {
    if (product?.rowIdentity) productByIdentity.set(product.rowIdentity, product);
  }
  for (const candidate of byIdentity.values()) {
    const product = candidate.rowIdentity
      ? productByIdentity.get(candidate.rowIdentity)
      : null;
    if (product) {
      candidate.product = product;
      candidate.name = candidate.name || display(product.name);
      candidate.article = candidate.article || display(product.article);
      candidate.supplier = candidate.supplier || display(product.supplier);
      candidate.category = candidate.category || display(product.category);
      candidate.suggested_role = candidate.suggested_role ?? null;
      candidate.provenance.push('working_order');
    }
  }

  // Matrix-side gaps: canonical items not matched to the supplier report.
  // These have no rowIdentity; they are tracked by matrix article.
  const matrixGaps = [];
  const gapLists = [
    ['missing_matrix_items', 'not_found_in_supplier_report'],
    ['supplier_unassigned_matrix_items', 'supplier_unassigned'],
    ['out_of_scope_matrix_items', 'out_of_scope_for_supplier_report'],
  ];
  for (const [field, fallbackReason] of gapLists) {
    for (const gap of asArray(agentJson[field])) {
      if (!gap || typeof gap !== 'object') continue;
      matrixGaps.push({
        key: `matrix:${display(gap.article, display(gap.name, 'unknown'))}`,
        article: display(gap.article),
        name: display(gap.name),
        priority: gap.priority ?? null,
        reason: gap.reason || fallbackReason,
        provenance: [field],
      });
    }
  }

  // Safety net: working-order positions blocked for review that are not in
  // the matrix-builder manual review file (should be rare; kept visible).
  for (const product of asArray(agentJson.workingOrderProducts)) {
    if (product?.workflowStatus !== 'pending_manual_review') continue;
    if (product.rowIdentity && byIdentity.has(product.rowIdentity)) continue;
    const candidate = candidateFor(`orphan:${product.rowIdentity}`);
    candidate.rowIdentity = product.rowIdentity ?? null;
    candidate.source_row_number = product.rowNumber ?? null;
    candidate.article = display(product.article, candidate.article);
    candidate.name = display(product.name, candidate.name);
    candidate.supplier = display(product.supplier, candidate.supplier);
    candidate.category = display(product.category, candidate.category);
    candidate.product = product;
    candidate.provenance.push('working_order');
  }

  return { candidates: Array.from(byIdentity.values()), matrixGaps };
}

function draftReasonCodes(candidate) {
  return asArray(candidate.draft?.reason_codes);
}

function draftQueues(candidate) {
  return asArray(candidate.draft?.review_queue_memberships);
}

function inQueue(candidate, queue) {
  return draftQueues(candidate).includes(queue);
}

function hasDraftReason(candidate, reason) {
  return draftReasonCodes(candidate).includes(reason);
}

function draftMissingFields(candidate) {
  return asArray(candidate.draft?.data_quality?.missing_fields);
}

function draftHasMissing(candidate, field) {
  return draftMissingFields(candidate).includes(field);
}

function decisionReasons(candidate) {
  return asArray(candidate.product?.decisionReasons);
}

function hasDecisionReason(candidate, reason) {
  return decisionReasons(candidate).includes(reason);
}

function requiredData(candidate) {
  return asArray(candidate.product?.requiredData);
}

function blockingReason(candidate) {
  return display(candidate.product?.blockingReason);
}

function authoritativePendingBlocker(candidate) {
  if (candidate.product?.workflowStatus !== 'pending_manual_review') return null;
  return blockingReason(candidate);
}

function authoritativeBlockerClassification(candidate, bundle) {
  const blocker = authoritativePendingBlocker(candidate);
  if (!blocker) return null;
  if (blocker === 'unmatched_product_no_assortment_policy') {
    return {
      category: TRIAGE_CATEGORIES.MATRIX_UNMATCHED,
      severity: SEVERITY.BLOCKING,
      action: CATEGORY_ACTIONS_RU.MATRIX_UNMATCHED,
      extras: [],
    };
  }
  if (blocker === 'ambiguous_assortment_match') {
    const duplicates = duplicateGroupsFor(bundle, candidate);
    return duplicates.length > 0
      ? {
        category: TRIAGE_CATEGORIES.DUPLICATE_SKU,
        severity: SEVERITY.BLOCKING,
        action: CATEGORY_ACTIONS_RU.DUPLICATE_SKU,
        extras: [],
      }
      : {
        category: TRIAGE_CATEGORIES.DATA_ERROR_IDENTITY,
        severity: SEVERITY.BLOCKING,
        action: CATEGORY_ACTIONS_RU.DATA_ERROR_IDENTITY,
        extras: [],
      };
  }
  if (
    blocker === 'incomplete_demand_data' &&
    requiredData(candidate).includes('supplier_delivery_cycle_days')
  ) {
    return {
      category: TRIAGE_CATEGORIES.SUPPLIER_DATA_MISSING,
      severity: SEVERITY.BLOCKING,
      action: CATEGORY_ACTIONS_RU.SUPPLIER_DATA_MISSING,
      extras: ['missing=supplier_delivery_cycle_days'],
    };
  }
  if (blocker === 'sales_spike_quantity_requires_review') {
    return {
      category: TRIAGE_CATEGORIES.SALES_SPIKE_REVIEW,
      severity: SEVERITY.WARNING,
      action: CATEGORY_ACTIONS_RU.SALES_SPIKE_REVIEW,
      extras: [],
    };
  }
  if (blocker === 'short_long_trend_conflict' || blocker.startsWith('abc_xyz_risk:')) {
    return {
      category: TRIAGE_CATEGORIES.OWNER_DECISION_REQUIRED,
      severity: SEVERITY.WARNING,
      action: CATEGORY_ACTIONS_RU.OWNER_DECISION_REQUIRED,
      extras: [],
    };
  }
  return null;
}

function duplicateGroupsFor(bundle, candidate) {
  const diagnostics = asArray(
    bundle?.agentJson?.adapter_diagnostics?.duplicateIdentifiers
  );
  if (diagnostics.length === 0) return [];
  const identities = new Set();
  if (candidate.rowIdentity) identities.add(candidate.rowIdentity);
  return diagnostics.filter(group =>
    asArray(group?.rowIdentities).some(identity => identities.has(identity))
  );
}

function pendingQuantity(candidate) {
  const product = candidate.product;
  if (!product) return null;
  return positiveNumber(product.approvedOrderQuantity) ??
    positiveNumber(product.provisionalOrderQuantity) ??
    positiveNumber(product.finalRecommendedQuantity) ??
    positiveNumber(product.minmaxRecommendedQuantity) ??
    positiveNumber(product.analyzerCalculatedQuantity);
}

function preFinancialQuantity(candidate) {
  const product = candidate.product;
  if (!product) return null;
  const calculated = positiveNumber(product.finalRecommendedQuantity) ??
    positiveNumber(product.minmaxRecommendedQuantity);
  const analyzer = positiveNumber(product.analyzerCalculatedQuantity);
  if (calculated === null && analyzer === null) return null;
  return Math.max(calculated ?? 0, analyzer ?? 0);
}

function unitPrice(candidate) {
  return positiveNumber(candidate.product?.priceNum) ??
    positiveNumber(candidate.draft?.evidence?.purchase_price);
}

function knownLineValue(candidate) {
  const qty = pendingQuantity(candidate);
  const price = unitPrice(candidate);
  if (qty === null || price === null) return null;
  return roundCurrency(qty * price);
}

function freeStockValue(candidate) {
  if (candidate.product && 'freeStock' in candidate.product) {
    return candidate.product.freeStock;
  }
  return candidate.draft?.evidence?.free_stock ?? null;
}

function stockIsUnknown(candidate) {
  const value = freeStockValue(candidate);
  if (!isUnknownStock(value)) return false;
  return (
    draftHasMissing(candidate, 'free_stock') ||
    draftHasMissing(candidate, 'stock_days') ||
    hasDraftReason(candidate, 'missing_inventory_data') ||
    hasDraftReason(candidate, 'free_stock_unknown') ||
    requiredData(candidate).includes('free_stock') ||
    blockingReason(candidate) === 'free_stock_unknown'
  );
}

function identityIsAmbiguous(candidate) {
  return (
    candidate.draft?.data_quality?.identity_ambiguous === true ||
    hasDraftReason(candidate, 'ambiguous_identity') ||
    hasDraftReason(candidate, 'missing_stable_identifier') ||
    inQueue(candidate, 'identity_remediation')
  );
}

function missingSupplierData(candidate) {
  const missing = [];
  if (
    candidate.draft?.evidence?.purchase_price === null ||
    hasDraftReason(candidate, 'missing_purchase_price') ||
    draftHasMissing(candidate, 'purchase_price')
  ) {
    missing.push('purchase_price');
  }
  if (!candidate.supplier && !candidate.draft?.evidence?.supplier) {
    missing.push('supplier');
  }
  if (!candidate.article && !candidate.barcode &&
      !candidate.internal_product_id) {
    missing.push('identifier');
  }
  if (
    candidate.draft?.evidence?.supplier_need_qty === null ||
    candidate.draft?.evidence?.supplier_recommended_qty === null
  ) {
    missing.push('supplier_recommendation');
  }
  if (requiredData(candidate).includes('supplier_delivery_cycle_days')) {
    missing.push('supplier_delivery_cycle_days');
  }
  return Array.from(new Set(missing));
}

function isNewSku(candidate) {
  return (
    candidate.draft?.first_rollout_test_awaiting === true ||
    candidate.product?.firstRolloutTestAwaiting === true ||
    candidate.product?.rolloutStatus === 'FIRST_ROLLOUT' ||
    candidate.draft?.rollout_status === 'FIRST_ROLLOUT' ||
    hasDraftReason(candidate, 'insufficient_sales_history') ||
    hasDraftReason(candidate, 'no_completed_week_sales')
  );
}

function isExitCandidate(candidate) {
  return (
    candidate.suggested_role === 'EXIT' ||
    inQueue(candidate, 'exit_review')
  );
}

function hasSalesSpike(candidate) {
  return (
    hasDecisionReason(candidate, 'sales_spike_quantity_requires_review') ||
    hasDraftReason(candidate, 'sales_spike_quantity_requires_review') ||
    hasDraftReason(candidate, 'irregular_sales')
  );
}

function financialLimitSignal(candidate, bundle) {
  const product = candidate.product;
  if (!product) return null;
  // Claim a budget cut only when the order-level financial controller
  // actually reported limit pressure. Zero approved quantity under a clean
  // APPROVED/PRELIMINARY status has many ordinary explanations.
  const status = bundle?.agentJson?.financial_assessment?.status;
  const financialPressure =
    status === 'REJECTED' ||
    status === 'MANUAL_APPROVAL_REQUIRED' ||
    status === 'APPROVED_WITH_WARNING';
  if (!financialPressure) return null;
  // EXIT candidates are deliberately not ordered by design; that is not a
  // budget cut, so the financial heuristic must not claim them.
  if (isExitCandidate(candidate)) return null;
  // A confident no-buy decision (EXIT, do_not_buy) with zero approved
  // quantity is normal, not a budget cut. The heuristic applies only when
  // the item still wanted to order.
  if (
    product.phase2Decision === 'do_not_buy' ||
    product.workflowStatus === 'confidently_excluded' ||
    product.workflowStatus === 'no_order_action'
  ) {
    return null;
  }
  const approved = finiteNumber(product.approvedOrderQuantity);
  const preFinQty = preFinancialQuantity(candidate);
  const preFinValueQty = preFinancialQuantity(candidate);
  const price = unitPrice(candidate);
  if (
    approved !== null && approved === 0 &&
    preFinQty !== null && preFinQty > 0 &&
    preFinValueQty !== null && price !== null &&
    roundCurrency(preFinValueQty * price) >= 100
  ) {
    return roundCurrency(preFinValueQty * price);
  }
  return null;
}

/**
 * Independent owner-level business signals. These exist on their own (a
 * conflict with an owner-approved policy, an EXIT awaiting approval, ...),
 * so they require a real owner decision even without an owner-review entry.
 * Reasons that merely mirror a data problem (insufficient_data,
 * identity_only_issue, missing_price_risk) are deliberately NOT signals:
 * fixing the data resolves them, no business choice is involved.
 */
const STRONG_OWNER_SIGNALS = new Set([
  'approved_policy_conflict',
  'owner_decision_conflict',
  'policy_requires_confirmation',
  'owner_decision_force_review',
  'exit_candidate',
  'strategic_exit_risk',
  'exit_blocked_approved_policy',
  'critical_inventory_value',
  'owner_rejected_exit',
]);

/**
 * Verified owner-review sessions, read from the bundle
 * (bundle.ownerReviewSessions — loaded by the CLI/adapter from
 * data/purchasing/owner-review-sessions.json). Each entry must carry a
 * session_id and a control-artifact reference confirmed by the loader;
 * the triage module itself never trusts rule_changed_by/rule_changed_at
 * alone as proof of owner approval.
 *
 * Fail-safe by design: no registry, a broken registry or a missing session
 * means NO verified sessions, so every policy conflict stays in the owner
 * queue.
 */
function verifiedOwnerSessionIds(bundle) {
  const ids = new Set();
  for (const session of asArray(bundle?.ownerReviewSessions)) {
    const id = display(session?.session_id);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Looks up the canonical matrix item for a candidate by exact supplier_sku.
 * Returns null when the bundle carries no canonical matrix or no exact match
 * (no fuzzy matching, ever).
 */
function canonicalItemFor(candidate, bundle) {
  const article = display(candidate.article);
  if (!article) return null;
  const items = asArray(bundle?.canonicalMatrix?.items);
  for (const item of items) {
    if (display(item?.supplier_sku) === article) return item;
  }
  return null;
}

/**
 * No link to the canonical matrix. Shared by the diagnostic classification
 * and the owner-decision blocker so both axes judge linkage identically.
 */
function matrixLinkUnmatched(candidate) {
  return (
    candidate.product?.assortment_matrix?.matched === false ||
    candidate.draft?.existing_matrix_item === false ||
    (candidate.draft && candidate.draft.existing_matrix_item == null &&
      !candidate.draft.existing_policy && candidate.draft.suggested_role === 'UNCLASSIFIED')
  );
}

/**
 * Deterministic data/linkage problems that prevent a policy-window conflict
 * from being treated as (or auto-resolved from) an owner business decision:
 * unknown stock, missing supplier data, duplicate identifiers, ambiguous
 * identity, no canonical link. Fixing the data comes first; only a clean
 * position can carry a business choice.
 */
function hasDataOrLinkageProblem(candidate, bundle) {
  const authoritative = authoritativePendingBlocker(candidate);
  if (authoritative) {
    if (authoritative.startsWith('abc_xyz_risk:')) return false;
    if (
      authoritative === 'unmatched_product_no_assortment_policy' ||
      authoritative === 'ambiguous_assortment_match' ||
      authoritative === 'free_stock_unknown'
    ) return true;
  }
  return (
    stockIsUnknown(candidate) ||
    missingSupplierData(candidate).length > 0 ||
    duplicateGroupsFor(bundle, candidate).length > 0 ||
    identityIsAmbiguous(candidate) ||
    matrixLinkUnmatched(candidate)
  );
}

/**
 * Deterministic blocker for an owner business decision (null = ACTIVE):
 *   - 'data_or_linkage': the position carries a data/linkage defect that
 *     must be fixed before any business choice (same predicate POLICY A
 *     uses; derived from facts, never from the reason_code string);
 *   - 'missing_recommended_quantity': no calculated order quantity exists
 *     upstream and the decision is quantity-dependent, so there is nothing
 *     to order against (TRUE_UPSTREAM_DATA_GAP). Quantity-independent
 *     decisions (EXIT approval and kin) are never blocked by this.
 * reason_code and owner_signals stay untouched; the status only gates
 * whether the compactor may offer the position as a decidable choice.
 */
function ownerDecisionBlocker(candidate, bundle, signals = []) {
  if (hasDataOrLinkageProblem(candidate, bundle)) {
    return 'data_or_linkage';
  }
  const quantityIndependent =
    signals.length > 0 &&
    signals.every(signal => QUANTITY_INDEPENDENT_SIGNALS.has(signal));
  if (
    !quantityIndependent &&
    pendingQuantity(candidate) === null &&
    preFinancialQuantity(candidate) === null
  ) {
    return 'missing_recommended_quantity';
  }
  return null;
}

/**
 * An independent business signal on the same position keeps it with the
 * owner even when the policy-window conflict itself is auto-resolved:
 * any strong owner signal other than the policy conflict, or a
 * commercial/large-inventory review that the owner-review layer flagged as
 * a real required action (WARNING_ONLY / SAFE_NO_ORDER / POSTPONED do not
 * block auto-resolution, mirroring ownerDecisionAssessment semantics).
 */
function hasIndependentBusinessSignal(candidate, otherSignals) {
  if (otherSignals.some(signal => STRONG_OWNER_SIGNALS.has(signal))) {
    return true;
  }
  const reviewDriven = otherSignals.filter(
    signal => signal === 'commercial_review' || signal === 'large_inventory_review'
  );
  return (
    reviewDriven.length > 0 &&
    candidate.review?.owner_action_required === true &&
    candidate.review?.owner_action_class === 'OWNER_ACTION_REQUIRED'
  );
}

/**
 * POLICY A auto-resolution. Returns { resolved, reason, ... }.
 * All conditions are deterministic and read from existing data:
 *   - the position carries a policy-window conflict (approved_policy_conflict);
 *   - its canonical item is matched exactly by supplier_sku;
 *   - canonical rule_changed_by is present in the verified owner-review
 *     session registry (bundle.ownerReviewSessions, loaded data-driven;
 *     provenance backed by an independent control artifact);
 *   - no data/linkage problem, no independent business signal.
 * Any unmet condition → resolved:false and the position stays with the owner
 * (or in data problems).
 */
function policyConflictAutoResolved(candidate, bundle, otherSignals = []) {
  const reviewReasons = asArray(candidate.review?.owner_review_reasons);
  const hasConflict =
    candidate.draft?.approved_policy_conflict === true ||
    reviewReasons.includes('approved_policy_conflict');
  if (!hasConflict) return { resolved: false, reason: 'no_policy_conflict' };

  const canonical = canonicalItemFor(candidate, bundle);
  if (!canonical) {
    return { resolved: false, reason: 'canonical_item_not_found' };
  }
  const changedBy = display(canonical.rule_changed_by);
  if (!changedBy || !verifiedOwnerSessionIds(bundle).has(changedBy)) {
    return {
      resolved: false,
      reason: 'owner_provenance_unverified',
      rule_changed_by: changedBy,
    };
  }
  if (hasDataOrLinkageProblem(candidate, bundle)) {
    return { resolved: false, reason: 'data_or_linkage_problem' };
  }
  if (hasIndependentBusinessSignal(candidate, otherSignals)) {
    return { resolved: false, reason: 'independent_business_signal' };
  }
  return { resolved: true, rule_changed_by: changedBy };
}

/**
 * Assesses whether a position carries a genuine owner business decision.
 * Two axes are kept separate on purpose:
 *   - signals: which business signals the position carries (evidence only);
 *   - requiresOwnerDecision: whether Sergey must actually make a choice.
 *
 * Derived from the actual owner-review fields (owner_action_required is the
 * dashboard's P1/P2 flag, owner_action_class separates real actions from
 * WARNING_ONLY / SAFE_NO_ORDER / POSTPONED / RESOLVED per
 * services/owner_action_classifier.js) plus the matrix-builder draft fields.
 */
function ownerDecisionAssessment(candidate, bundle = {}) {
  const signals = [];
  const reviewReasons = asArray(candidate.review?.owner_review_reasons);
  const queues = draftQueues(candidate);

  if (candidate.draft?.approved_policy_conflict === true ||
      reviewReasons.includes('approved_policy_conflict')) {
    signals.push('approved_policy_conflict');
  }
  if (candidate.draft?.owner_decision_conflict === true ||
      candidate.review?.owner_decision_conflict === true ||
      reviewReasons.includes('OWNER_DECISION_CONFLICT')) {
    signals.push('owner_decision_conflict');
  }
  if (candidate.draft?.policy_requires_confirmation === true) {
    signals.push('policy_requires_confirmation');
  }
  if (candidate.draft?.owner_decision_force_review === true ||
      reviewReasons.includes('owner_decision_requires_review')) {
    signals.push('owner_decision_force_review');
  }
  if (isExitCandidate(candidate) &&
      candidate.draft?.owner_exit_approved !== true) {
    signals.push('exit_candidate');
  }
  if (reviewReasons.includes('OWNER_REJECTED_EXIT')) {
    signals.push('owner_rejected_exit');
  }
  if (hasDraftReason(candidate, 'exit_blocked_strategic_policy')) {
    signals.push('strategic_exit_risk');
  }
  if (hasDraftReason(candidate, 'exit_blocked_approved_policy')) {
    signals.push('exit_blocked_approved_policy');
  }
  if (reviewReasons.includes('critical_inventory_value')) {
    signals.push('critical_inventory_value');
  }

  // Review-driven signals: commercial / large-inventory reviews only require
  // a decision when the owner-review layer itself flagged the row (P1/P2)
  // and the classifier treated it as a real action rather than an
  // informational warning or a safe automatic no-order/postponed result.
  const reviewDriven = [];
  if (reviewReasons.includes('large_inventory_review') ||
      queues.includes('large_inventory_review')) {
    reviewDriven.push('large_inventory_review');
  }
  if (reviewReasons.includes('commercial_review') ||
      queues.includes('commercial_review')) {
    reviewDriven.push('commercial_review');
  }
  signals.push(...reviewDriven);

  // A position whose owner decision was already applied — without a conflict
  // or forced review — is resolved per the dashboard's own suppression
  // semantics (owner_decision_applied); draft-level signal leftovers must not
  // resurrect a decision that has already been made.
  const suppressedByAppliedDecision =
    reviewReasons.includes('owner_decision_applied') &&
    candidate.draft?.owner_decision_conflict !== true &&
    candidate.draft?.owner_decision_force_review !== true &&
    candidate.review?.owner_decision_conflict !== true;

  let requiresOwnerDecision =
    !suppressedByAppliedDecision &&
    signals.some(signal => STRONG_OWNER_SIGNALS.has(signal));

  // POLICY A: a policy-window conflict evaluated on broken data is a data
  // problem, not a business decision — fixing the data resolves the conflict.
  // Applies only when the policy conflict is the position's sole signal.
  const policyResolution = policyConflictAutoResolved(
    candidate,
    bundle,
    signals.filter(signal => signal !== 'approved_policy_conflict')
  );
  if (!policyResolution.resolved &&
      requiresOwnerDecision &&
      signals.length > 0 &&
      signals.every(signal => signal === 'approved_policy_conflict') &&
      hasDataOrLinkageProblem(candidate, bundle)) {
    requiresOwnerDecision = false;
  }

  // POLICY A: verified owner-approved canonical policy stays in force until
  // the owner revises it; a differing fresh calculation does not re-ask.
  if (policyResolution.resolved) {
    requiresOwnerDecision = false;
  }

  if (!requiresOwnerDecision &&
      candidate.review?.owner_action_required === true &&
      reviewDriven.length > 0) {
    requiresOwnerDecision =
      candidate.review?.owner_action_class === 'OWNER_ACTION_REQUIRED';
  }
  return { signals, requiresOwnerDecision, policyResolution };
}

function buildEvidence(candidate, bundle, extras = [], ownerSignals = []) {
  const evidence = [...asArray(extras)];
  const freeStock = freeStockValue(candidate);
  if (isUnknownStock(freeStock)) {
    if (stockIsUnknown(candidate)) evidence.push('free_stock=unknown');
  } else {
    evidence.push(`free_stock=${freeStock}`);
  }
  const qty = pendingQuantity(candidate);
  evidence.push(qty !== null ? `pending_quantity=${qty}` : 'pending_quantity=unknown');
  const price = unitPrice(candidate);
  if (price !== null) evidence.push(`unit_price=${price}`);
  const queues = draftQueues(candidate);
  if (queues.length > 0) evidence.push(`queues=[${queues.join(', ')}]`);
  const reasons = draftReasonCodes(candidate);
  if (reasons.length > 0) evidence.push(`reason_codes=[${reasons.join(', ')}]`);
  const blocking = blockingReason(candidate);
  if (blocking) evidence.push(`blocking=${blocking}`);
  if (candidate.review?.owner_review_priority) {
    evidence.push(`owner_review_priority=${candidate.review.owner_review_priority}`);
  }
  const duplicates = duplicateGroupsFor(bundle, candidate);
  for (const group of duplicates) {
    evidence.push(
      `duplicate_${group.identifierType}=${group.value} (rows: ${asArray(group.rowNumbers).join(', ')})`
    );
  }
  const missing = missingSupplierData(candidate);
  if (missing.length > 0) evidence.push(`missing=[${missing.join(', ')}]`);
  if (ownerSignals.length > 0) {
    evidence.push(`owner_signals=[${ownerSignals.join(', ')}]`);
  }
  evidence.push(`provenance=[${candidate.provenance.join(' + ')}]`);
  return evidence;
}

const CATEGORY_ACTIONS_RU = Object.freeze({
  DATA_ERROR_UNKNOWN_STOCK:
    'Проверить остаток в 1С и обновить отчёт SmartZapas; автозаказ запрещён до восстановления данных.',
  DATA_ERROR_IDENTITY:
    'Уточнить артикул/штрихкод в 1С или у поставщика; устранить неоднозначность идентификации.',
  SUPPLIER_DATA_MISSING:
    'Дозаполнить обязательные поля карточки товара (цена поставщика, поставщик, единица измерения).',
  DUPLICATE_SKU:
    'Разобрать дубль: оставить один идентификатор, дубликат исключить из заказа и матрицы.',
  MATRIX_UNMATCHED:
    'Сопоставить товар с canonical-матрицей по supplier_sku или добавить правило матрицы.',
  NEW_SKU_REVIEW:
    'Рассмотреть тестовый ввод SKU; действующее правило TEST показано в данных, новое правило не применяется автоматически.',
  SALES_SPIKE_REVIEW:
    'Проверить аномалию продаж (возврат, разовая оптовая продажа); при подтверждении спроса Min/Max пересчитает модуль аналитики.',
  FINANCIAL_LIMIT_REVIEW:
    'Решение о приоритете закупки при финансовом ограничении принимает владелец.',
  OWNER_DECISION_REQUIRED:
    'Требуется явное решение владельца (см. рекомендацию Owner Review).',
  READY_WITH_EXPLANATION:
    'Данные полные, расчёт однозначен; ручное вмешательство не требуется.',
});

function classifyCandidate(candidate, bundle) {
  const needsDecision =
    pendingQuantity(candidate) !== null ||
    candidate.draft?.manual_review_required === true ||
    draftQueues(candidate).length > 0 ||
    candidate.review?.owner_action_required === true ||
    candidate.product?.workflowStatus === 'pending_manual_review';

  // The final working-order blocker is authoritative for positions that are
  // still pending. Draft diagnostics are useful evidence, but must not
  // overwrite the actual reason the order agent refused to resolve the row.
  const authoritative = authoritativeBlockerClassification(candidate, bundle);
  if (authoritative) return authoritative;

  // 1. Unknown stock is a data error and can never be treated as zero.
  if (stockIsUnknown(candidate) && needsDecision) {
    return {
      category: TRIAGE_CATEGORIES.DATA_ERROR_UNKNOWN_STOCK,
      severity: SEVERITY.BLOCKING,
      action: CATEGORY_ACTIONS_RU.DATA_ERROR_UNKNOWN_STOCK,
      extras: [],
    };
  }

  // 2. Missing mandatory supplier/commercial data.
  const missing = missingSupplierData(candidate);
  if (missing.length > 0 && needsDecision) {
    return {
      category: TRIAGE_CATEGORIES.SUPPLIER_DATA_MISSING,
      severity: SEVERITY.BLOCKING,
      action: CATEGORY_ACTIONS_RU.SUPPLIER_DATA_MISSING,
      extras: [],
    };
  }

  // 3. Duplicate identifiers (exact adapter diagnostics).
  const duplicates = duplicateGroupsFor(bundle, candidate);
  if (duplicates.length > 0) {
    return {
      category: TRIAGE_CATEGORIES.DUPLICATE_SKU,
      severity: SEVERITY.BLOCKING,
      action: CATEGORY_ACTIONS_RU.DUPLICATE_SKU,
      extras: [],
    };
  }

  // 4. Ambiguous identity without a confirmed duplicate group.
  if (identityIsAmbiguous(candidate)) {
    return {
      category: TRIAGE_CATEGORIES.DATA_ERROR_IDENTITY,
      severity: needsDecision ? SEVERITY.BLOCKING : SEVERITY.WARNING,
      action: CATEGORY_ACTIONS_RU.DATA_ERROR_IDENTITY,
      extras: [],
    };
  }

  // 5. No link to the canonical matrix.
  const matrixUnmatched = matrixLinkUnmatched(candidate);
  if (matrixUnmatched && needsDecision && !isNewSku(candidate)) {
    return {
      category: TRIAGE_CATEGORIES.MATRIX_UNMATCHED,
      severity: SEVERITY.BLOCKING,
      action: CATEGORY_ACTIONS_RU.MATRIX_UNMATCHED,
      extras: [],
    };
  }

  // 6. New SKU / no sales history: show the approved TEST rule, do not
  //    invent demand and do not apply new rules.
  if (isNewSku(candidate)) {
    const testRule = candidate.draft?.suggested_policy
      ? `suggested_policy: min=${display(candidate.draft.suggested_policy.minimum_shelf_stock, '—')} target=${display(candidate.draft.suggested_policy.target_stock, '—')} max=${display(candidate.draft.suggested_policy.maximum_stock, '—')}`
      : null;
    return {
      category: TRIAGE_CATEGORIES.NEW_SKU_REVIEW,
      severity: SEVERITY.WARNING,
      action: CATEGORY_ACTIONS_RU.NEW_SKU_REVIEW,
      extras: testRule ? [testRule] : [],
    };
  }

  // 7. Sales spike / demand anomaly already flagged upstream.
  if (hasSalesSpike(candidate) && needsDecision) {
    return {
      category: TRIAGE_CATEGORIES.SALES_SPIKE_REVIEW,
      severity: SEVERITY.WARNING,
      action: CATEGORY_ACTIONS_RU.SALES_SPIKE_REVIEW,
      extras: [],
    };
  }

  // 8. Owner-level business decision WITHOUT a more specific diagnostic
  //    category. Positions already matched by checks 1-7 keep their
  //    diagnostic reason_code; their owner-decision flag is computed
  //    independently in buildTriageItem.
  if (ownerDecisionAssessment(candidate, bundle).requiresOwnerDecision) {
    const upstreamAction = display(candidate.review?.recommended_action);
    return {
      category: TRIAGE_CATEGORIES.OWNER_DECISION_REQUIRED,
      severity: SEVERITY.WARNING,
      action: upstreamAction ||
        CATEGORY_ACTIONS_RU.OWNER_DECISION_REQUIRED,
      extras: [],
    };
  }

  // 9. Financial limit suppressed a positive recommendation (heuristic from
  //    the owner-action classifier semantics; order-level verdict lives in
  //    financial_assessment).
  const financialValue = financialLimitSignal(candidate, bundle);
  if (financialValue !== null) {
    return {
      category: TRIAGE_CATEGORIES.FINANCIAL_LIMIT_REVIEW,
      severity: SEVERITY.WARNING,
      action: CATEGORY_ACTIONS_RU.FINANCIAL_LIMIT_REVIEW,
      extras: [
        `pre_financial_value=${financialValue}`,
        `financial_status=${display(bundle?.agentJson?.financial_assessment?.status, 'unknown')}`,
      ],
    };
  }

  // 10. Everything else in the queue with complete data is explainable.
  return {
    category: TRIAGE_CATEGORIES.READY_WITH_EXPLANATION,
    severity: SEVERITY.INFO,
    action: CATEGORY_ACTIONS_RU.READY_WITH_EXPLANATION,
    extras: [
      candidate.product?.workflowStatus
        ? `workflow_status=${candidate.product.workflowStatus}`
        : 'workflow_status=not_in_working_order',
    ],
  };
}

function classifyMatrixGap(gap) {
  const reason = gap.reason;
  if (reason === 'ambiguous_supplier_report_match') {
    return {
      category: TRIAGE_CATEGORIES.DATA_ERROR_IDENTITY,
      severity: SEVERITY.WARNING,
      action: CATEGORY_ACTIONS_RU.DATA_ERROR_IDENTITY,
      reason_detail: 'Неоднозначное совпадение в отчёте поставщика.',
    };
  }
  if (reason === 'supplier_unassigned') {
    return {
      category: TRIAGE_CATEGORIES.SUPPLIER_DATA_MISSING,
      severity: SEVERITY.WARNING,
      action: CATEGORY_ACTIONS_RU.SUPPLIER_DATA_MISSING,
      reason_detail: 'Позиция матрицы без назначенного поставщика.',
    };
  }
  return {
    category: TRIAGE_CATEGORIES.MATRIX_UNMATCHED,
    severity: SEVERITY.WARNING,
    action: CATEGORY_ACTIONS_RU.MATRIX_UNMATCHED,
    reason_detail: reason === 'out_of_scope_for_supplier_report'
      ? 'Позиция матрицы вне области текущего отчёта поставщика.'
      : 'Позиция canonical-матрицы не найдена в отчёте поставщика.',
  };
}

function buildTriageItem(candidate, bundle, context) {
  let result = classifyCandidate(candidate, bundle);
  // The owner-decision axis is independent of the diagnostic reason_code:
  // a position keeps its diagnostic category AND carries the flag when a
  // genuine owner business decision exists (see ownerDecisionAssessment).
  const ownerAssessment = ownerDecisionAssessment(candidate, bundle);
  // POLICY A auto-resolution: the position keeps its diagnostic category and
  // its approved_policy_conflict signal (full traceability), but the
  // recommended action becomes "apply the verified owner-approved canonical
  // policy until the owner explicitly revises it".
  if (ownerAssessment.policyResolution?.resolved) {
    result = {
      ...result,
      action: `Применить утверждённую owner-политику canonical (сессия ${ownerAssessment.policyResolution.rule_changed_by}) до явного пересмотра владельцем; отклонение 12-недельного расчёта зафиксировано в evidence, повторное решение не требуется.`,
      extras: [
        ...asArray(result.extras),
        `policy_provenance=${ownerAssessment.policyResolution.rule_changed_by}`,
        'policy_window_conflict=auto_resolved',
      ],
    };
  }
  const requiresOwnerDecision =
    ownerAssessment.requiresOwnerDecision ||
    result.category === TRIAGE_CATEGORIES.OWNER_DECISION_REQUIRED ||
    result.category === TRIAGE_CATEGORIES.FINANCIAL_LIMIT_REVIEW;
  // Lifecycle of the business decision: a position whose decision is blocked
  // by a data/linkage defect or a missing calculated quantity keeps its
  // signals and requires_owner_decision (the choice itself is not lost), but
  // is not offered as an ACTIVE decision until upstream data is fixed.
  const ownerDecisionBlockerReason = requiresOwnerDecision
    ? ownerDecisionBlocker(candidate, bundle, ownerAssessment.signals)
    : null;
  // Traceability: the internal sku_id travels with the position. The
  // report's own identifiers win (upstream truth); when the report has no
  // internal id, the exactly canonical-matched matrix item contributes its
  // sku_id. The article stays the sole canonical matching key — sku_id is
  // never used for matching and never substituted for the article.
  const canonicalMatch = canonicalItemFor(candidate, bundle);
  const reportInternalId = display(candidate.internal_product_id);
  const reportBarcode = display(candidate.barcode);
  const skuId = reportInternalId || reportBarcode ||
    display(canonicalMatch?.sku_id) || null;
  const skuIdSource = reportInternalId
    ? 'report_internal_product_id'
    : reportBarcode
      ? 'report_barcode'
      : skuId
        ? 'canonical_matrix_exact_match'
        : null;
  const section = requiresOwnerDecision
    ? OWNER_SECTIONS.OWNER_DECISIONS
    : CATEGORY_SECTION[result.category];
  return {
    sku: candidate.internal_product_id ?? candidate.barcode ?? null,
    sku_id: skuId,
    sku_id_source: skuIdSource,
    supplier_sku: candidate.article,
    name: candidate.name,
    supplier: candidate.supplier,
    category: candidate.category,
    severity: result.severity,
    requires_owner_decision: requiresOwnerDecision,
    owner_decision_status: requiresOwnerDecision
      ? (ownerDecisionBlockerReason
        ? OWNER_DECISION_STATUS.BLOCKED_BY_DATA
        : OWNER_DECISION_STATUS.ACTIVE)
      : null,
    owner_decision_blocker: ownerDecisionBlockerReason,
    owner_signals: ownerAssessment.signals,
    reason_code: result.category,
    reason: CATEGORY_LABELS_RU[result.category],
    evidence: buildEvidence(candidate, bundle, result.extras, ownerAssessment.signals),
    recommended_action: result.action,
    source_run_id: context.sourceRunId,
    calculation_version: context.calculationVersion,
    // Extra read-only context for the UI/report (not part of the contract).
    row_identity: candidate.rowIdentity,
    section,
    // New SKUs carry no sales history: any quantity comes from the approved
    // TEST rule, not from demand, so no monetary claim is attached to them.
    line_value: result.category === TRIAGE_CATEGORIES.NEW_SKU_REVIEW
      ? null
      : knownLineValue(candidate),
  };
}

function buildMatrixGapItem(gap, context) {
  const result = classifyMatrixGap(gap);
  const section = CATEGORY_SECTION[result.category];
  return {
    sku: null,
    supplier_sku: gap.article,
    name: gap.name,
    supplier: null,
    category: null,
    severity: result.severity,
    requires_owner_decision: section === OWNER_SECTIONS.OWNER_DECISIONS,
    reason_code: result.category,
    reason: result.reason_detail || CATEGORY_LABELS_RU[result.category],
    evidence: [
      `matrix_gap_reason=${gap.reason}`,
      `matrix_priority=${display(gap.priority, 'unknown')}`,
      `provenance=[${gap.provenance.join(' + ')}]`,
    ],
    recommended_action: result.action,
    source_run_id: context.sourceRunId,
    calculation_version: context.calculationVersion,
    row_identity: null,
    section,
    line_value: null,
    owner_decision_status: null,
    owner_decision_blocker: null,
  };
}

function summarizeSection(items) {
  const sumKnown = roundCurrency(
    items.reduce((sum, item) => sum + (item.line_value ?? 0), 0)
  );
  const unknownValueCount = items.filter(item => item.line_value === null).length;
  const reasons = {};
  for (const item of items) {
    reasons[item.reason_code] = (reasons[item.reason_code] || 0) + 1;
  }
  return {
    count: items.length,
    sum: items.length > 0 ? sumKnown : 0,
    sum_is_partial: unknownValueCount > 0,
    value_unknown_count: unknownValueCount,
    reasons,
    blocking: items
      .filter(item => item.severity === SEVERITY.BLOCKING)
      .map(item => ({ supplier_sku: item.supplier_sku, name: item.name, reason_code: item.reason_code })),
    next_actions: Array.from(new Set(items.map(item => item.recommended_action))),
    items,
  };
}

/**
 * Main entry point. Read-only.
 *
 * @param {object} bundle - { agentJson, manualReview, ownerReview, runId? }
 * @param {object} [options] - { generatedAt? }
 * @returns {object} triage report with items and four owner sections
 */
function triageReviewQueue(bundle, options = {}) {
  if (!bundle || typeof bundle !== 'object') {
    throw new TypeError('triageReviewQueue requires a run bundle object.');
  }
  const agentJson = bundle.agentJson || {};
  const context = {
    sourceRunId: bundle.runId ||
      agentJson.run_id ||
      bundle.ownerReview?.source?.file ||
      null,
    calculationVersion: agentJson.workingOrderVersion ||
      agentJson.decisionVersion ||
      bundle.ownerReview?.report_version ||
      null,
  };

  const { candidates, matrixGaps } = collectCandidates(bundle);
  const items = candidates.map(candidate => buildTriageItem(candidate, bundle, context));
  const gapItems = matrixGaps.map(gap => buildMatrixGapItem(gap, context));
  const allItems = [...items, ...gapItems];

  const sections = {
    [OWNER_SECTIONS.READY]: summarizeSection(
      allItems.filter(item => item.section === OWNER_SECTIONS.READY)
    ),
    [OWNER_SECTIONS.DATA_PROBLEMS]: summarizeSection(
      allItems.filter(item => item.section === OWNER_SECTIONS.DATA_PROBLEMS)
    ),
    [OWNER_SECTIONS.MATRIX_GAPS]: summarizeSection(
      allItems.filter(item => item.section === OWNER_SECTIONS.MATRIX_GAPS)
    ),
    [OWNER_SECTIONS.OWNER_DECISIONS]: summarizeSection(
      allItems.filter(item => item.section === OWNER_SECTIONS.OWNER_DECISIONS)
    ),
  };

  const workflowProducts = asArray(agentJson.workingOrderProducts);
  const workflowQueueIsAuthoritative = workflowProducts.some(
    product => typeof product?.workflowStatus === 'string'
  );
  const pendingRowIdentities = new Set(
    workflowProducts
      .filter(product => product?.workflowStatus === 'pending_manual_review')
      .map(product => product?.rowIdentity)
      .filter(Boolean)
  );
  const currentItems = workflowQueueIsAuthoritative
    ? allItems.filter(item => item?.row_identity && pendingRowIdentities.has(item.row_identity))
    : items;
  // Owner signals on a data/linkage defect describe a FUTURE business
  // question, not a decision the owner can safely make now. Keep the full
  // audit classification above, but move current BLOCKED_BY_DATA positions
  // back to their operational data/matrix section. Only ACTIVE positions are
  // shown in the current owner-decision queue.
  const currentOperationalItems = currentItems.map(item => {
    if (item?.owner_decision_status !== OWNER_DECISION_STATUS.BLOCKED_BY_DATA) {
      return item;
    }
    const classifiedSection = CATEGORY_SECTION[item.reason_code];
    const operationalSection = classifiedSection === OWNER_SECTIONS.MATRIX_GAPS
      ? OWNER_SECTIONS.MATRIX_GAPS
      : OWNER_SECTIONS.DATA_PROBLEMS;
    return {
      ...item,
      original_section: item.section,
      section: operationalSection,
    };
  });
  const currentSections = {
    [OWNER_SECTIONS.READY]: summarizeSection(
      currentOperationalItems.filter(item => item.section === OWNER_SECTIONS.READY)
    ),
    [OWNER_SECTIONS.DATA_PROBLEMS]: summarizeSection(
      currentOperationalItems.filter(item => item.section === OWNER_SECTIONS.DATA_PROBLEMS)
    ),
    [OWNER_SECTIONS.MATRIX_GAPS]: summarizeSection(
      currentOperationalItems.filter(item => item.section === OWNER_SECTIONS.MATRIX_GAPS)
    ),
    [OWNER_SECTIONS.OWNER_DECISIONS]: summarizeSection(
      currentOperationalItems.filter(item => item.section === OWNER_SECTIONS.OWNER_DECISIONS)
    ),
  };
  const beforeTotal = workflowQueueIsAuthoritative
    ? pendingRowIdentities.size
    : currentItems.length;
  const ownerSectionCount = currentSections[OWNER_SECTIONS.OWNER_DECISIONS].count;

  return {
    triage_version: TRIAGE_VERSION,
    generated_at: options.generatedAt || new Date().toISOString(),
    source_run_id: context.sourceRunId,
    calculation_version: context.calculationVersion,
    categories: Object.values(TRIAGE_CATEGORIES).reduce((acc, code) => {
      acc[code] = allItems.filter(item => item.reason_code === code).length;
      return acc;
    }, {}),
    current_manual_categories: Object.values(TRIAGE_CATEGORIES).reduce((acc, code) => {
      acc[code] = currentItems.filter(item => item.reason_code === code).length;
      return acc;
    }, {}),
    sections,
    current_manual_sections: currentSections,
    current_manual_item_count: currentItems.length,
    comparison: {
      manual_queue_total_before: beforeTotal,
      ready: currentSections[OWNER_SECTIONS.READY].count,
      data_problems: currentSections[OWNER_SECTIONS.DATA_PROBLEMS].count,
      matrix_gaps: currentSections[OWNER_SECTIONS.MATRIX_GAPS].count,
      real_owner_decisions_after: ownerSectionCount,
      moved_out_of_owner_queue: beforeTotal - ownerSectionCount,
    },
    read_only: true,
    items: allItems,
    // Read-only compaction of the owner queue into package/individual
    // decisions. Additive field: no existing contract key is changed.
    owner_review_compaction: compactOwnerReview(
      {
        source_run_id: context.sourceRunId,
        items: currentItems,
      },
      {
        canonicalMatrix: bundle.canonicalMatrix,
        verifiedOwnerSessionIds: verifiedOwnerSessionIds(bundle),
      }
    ),
  };
}

module.exports = {
  TRIAGE_VERSION,
  TRIAGE_CATEGORIES,
  SEVERITY,
  OWNER_SECTIONS,
  OWNER_DECISION_STATUS,
  BLOCKED_BY_DATA_NOTE,
  CATEGORY_SECTION,
  CATEGORY_LABELS_RU,
  CATEGORY_ACTIONS_RU,
  collectCandidates,
  classifyCandidate,
  ownerDecisionAssessment,
  ownerDecisionBlocker,
  policyConflictAutoResolved,
  verifiedOwnerSessionIds,
  triageReviewQueue,
};
