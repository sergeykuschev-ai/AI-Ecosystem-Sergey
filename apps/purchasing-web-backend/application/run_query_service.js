const {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} = require('../config');
const {
  ownerDecisionSummary,
} = require('./owner_decision_service');
const {
  optimizePurchasingBudget,
} = require(
  '../../../agents/purchasing/budget_optimizer/budget_optimizer'
);
const {
  buildFinalOrderState,
  classifyItem,
} = require('../../../agents/purchasing/services/final_order');

const ALLOWED_SORTS = Object.freeze([
  'source_row',
  'name',
  'approved_quantity',
  'line_value',
  'recommended_quantity',
  'recommended_line_value',
  'free_stock',
  'sales_28_days',
  'owner_priority',
]);
const ALLOWED_ORDERS = Object.freeze(['asc', 'desc']);
const OWNER_REVIEW_SECTIONS = Object.freeze([
  'top_priority',
  'owner_action_required',
  'core_review',
  'exit_approval',
  'large_inventory_review',
  'approved_conflicts',
  'placeholder_differences',
  'requires_confirmation',
  'commercial_review',
  'test_awaiting_introduction',
  'owner_decision_sheet',
]);

class RunQueryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RunQueryError';
    this.code = code;
  }
}

function integerQuery(value, fallback, name, maximum = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    (maximum !== null && parsed > maximum)
  ) {
    throw new RunQueryError(
      'INVALID_QUERY',
      `Параметр ${name} имеет недопустимое значение.`
    );
  }
  return parsed;
}

function booleanQuery(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new RunQueryError(
    'INVALID_QUERY',
    `Параметр ${name} должен быть true или false.`
  );
}

function normalizedSearch(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 100) {
    throw new RunQueryError(
      'INVALID_QUERY',
      'Параметр q должен быть строкой длиной не более 100 символов.'
    );
  }
  return value.trim().toLowerCase().replace(/ё/g, 'е');
}

function enumQuery(value, allowed, name) {
  if (value === undefined || value === null || value === '') return null;
  if (!allowed.includes(value)) {
    throw new RunQueryError(
      'INVALID_QUERY',
      `Параметр ${name} имеет недопустимое значение.`
    );
  }
  return value;
}

function primarySortValue(item, sort) {
  if (sort === 'source_row') return item.source_row;
  if (sort === 'name') return item.name?.toLowerCase() ?? null;
  if (sort === 'approved_quantity') {
    return item.quantities?.approved_quantity ?? null;
  }
  if (sort === 'line_value') {
    return item.amounts?.approved_line_value ?? null;
  }
  if (sort === 'recommended_quantity') {
    return item.quantities?.approved_quantity ??
      item.quantities?.provisional_quantity ??
      item.quantities?.calculated_quantity ??
      null;
  }
  if (sort === 'recommended_line_value') {
    return item.amounts?.approved_line_value ??
      item.amounts?.provisional_line_value ??
      null;
  }
  if (sort === 'free_stock') return item.stock?.free_stock ?? null;
  if (sort === 'sales_28_days') {
    return item.sales?.last_28_days ?? null;
  }
  return item.matrix?.owner_review_priority ?? null;
}

function compareNullable(left, right, order) {
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  const comparison = typeof left === 'string'
    ? left.localeCompare(String(right), 'ru')
    : left - right;
  return order === 'desc' ? -comparison : comparison;
}

function compareItems(left, right, sort = 'source_row', order = 'asc') {
  const primary = compareNullable(
    primarySortValue(left, sort),
    primarySortValue(right, sort),
    order
  );
  if (primary !== 0) return primary;
  return String(left.row_id).localeCompare(String(right.row_id));
}

function pagination(items, page, pageSize) {
  const totalItems = items.length;
  const totalPages = totalItems === 0
    ? 0
    : Math.ceil(totalItems / pageSize);
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: {
      page,
      page_size: pageSize,
      total_items: totalItems,
      total_pages: totalPages,
    },
  };
}

function ensureCompleted(status) {
  if (status.status === 'failed') {
    throw new RunQueryError('RUN_FAILED', 'Run завершился ошибкой.');
  }
  if (status.status !== 'completed') {
    throw new RunQueryError('RUN_NOT_READY', 'Run ещё не завершён.');
  }
}

function itemMatches(item, filters) {
  if (filters.q) {
    const haystack = [
      item.sku || '',
      item.barcode || '',
      item.name || '',
      item.brand || '',
      item.supplier || '',
    ].join(' ')
      .toLowerCase()
      .replace(/ё/g, 'е');
    if (!haystack.includes(filters.q)) return false;
  }
  if (filters.decision && item.decision !== filters.decision) return false;
  if (
    filters.workflow_status &&
    item.workflow_status !== filters.workflow_status
  ) return false;
  if (
    filters.matrix_role &&
    item.matrix?.role !== filters.matrix_role
  ) return false;
  if (filters.confidence && item.confidence !== filters.confidence) {
    return false;
  }
  if (
    filters.owner_review !== null &&
    item.matrix?.owner_review_required !== filters.owner_review
  ) return false;
  if (
    filters.owner_action_class !== null &&
    item.matrix?.owner_action_class !== filters.owner_action_class
  ) return false;
  if (
    filters.policy_adjusted !== null &&
    item.assortment_policy?.adjusted !== filters.policy_adjusted
  ) return false;
  if (filters.positive_order !== null) {
    const positive = (item.quantities?.approved_quantity ?? 0) > 0 ||
      (item.quantities?.provisional_quantity ?? 0) > 0;
    if (positive !== filters.positive_order) return false;
  }
  if (
    filters.owner_decision === 'missing' &&
    item.owner_decision?.decision
  ) return false;
  if (
    filters.owner_decision === 'confirmed' &&
    classifyItem(item).kind !== 'included'
  ) return false;
  if (
    filters.owner_decision &&
    filters.owner_decision !== 'missing' &&
    filters.owner_decision !== 'confirmed' &&
    item.owner_decision?.decision !== filters.owner_decision
  ) return false;
  return true;
}

function reviewTriageIndex(registry, runId) {
  if (!registry || typeof registry.getReviewTriageArtifacts !== 'function') {
    return null;
  }
  let triage;
  try {
    triage = registry.getReviewTriageArtifacts(runId)?.triage || null;
  } catch {
    // Old runs or unavailable/corrupt triage keep legacy owner-review semantics.
    return null;
  }
  if (!triage || !Array.isArray(triage.items)) return null;
  const auditByRow = new Map();
  for (const entry of triage.items) {
    const rowId = typeof entry?.row_identity === 'string'
      ? entry.row_identity
      : null;
    if (!rowId || auditByRow.has(rowId)) continue;
    auditByRow.set(rowId, entry);
  }
  const currentSections = triage.current_manual_sections;
  const currentItems = currentSections && typeof currentSections === 'object'
    ? Object.values(currentSections).flatMap(section =>
      Array.isArray(section?.items) ? section.items : []
    )
    : triage.items;
  const byRow = new Map();
  for (const entry of currentItems) {
    const rowId = typeof entry?.row_identity === 'string'
      ? entry.row_identity
      : null;
    if (!rowId || byRow.has(rowId)) continue;
    byRow.set(rowId, entry);
  }
  const compaction = triage.owner_review_compaction || {};
  const exclusionByRow = new Map();
  for (const entry of Array.isArray(compaction.exclusions)
    ? compaction.exclusions
    : []) {
    const rowId = typeof entry?.row_identity === 'string'
      ? entry.row_identity
      : null;
    if (rowId && !exclusionByRow.has(rowId)) exclusionByRow.set(rowId, entry);
  }
  const blockedByRow = new Map();
  for (const entry of Array.isArray(compaction.blocked)
    ? compaction.blocked
    : []) {
    const rowId = typeof entry?.row_identity === 'string'
      ? entry.row_identity
      : null;
    if (rowId && !blockedByRow.has(rowId)) blockedByRow.set(rowId, entry);
  }
  return { byRow, auditByRow, exclusionByRow, blockedByRow, triage };
}

function applyReviewTriage(items, triageIndex) {
  if (!triageIndex) return items;
  return (items || []).map(item => {
    const entry = triageIndex.byRow.get(item.row_id) || null;
    const auditEntry = triageIndex.auditByRow?.get(item.row_id) || null;
    const exclusion = triageIndex.exclusionByRow?.get(item.row_id) || null;
    const compactBlocked = triageIndex.blockedByRow?.get(item.row_id) || null;
    const auditStatus = entry?.owner_decision_status || null;
    const status = compactBlocked
      ? 'BLOCKED_BY_DATA'
      : exclusion
        ? 'DATA_ISSUE'
        : auditStatus;
    const requiresOwnerDecision =
      status === 'ACTIVE' && entry?.requires_owner_decision === true;
    const blockedByData = status === 'BLOCKED_BY_DATA';
    const section = exclusion
      ? 'data_problems'
      : entry?.section || null;
    const legacyRequired = item?.matrix?.owner_review_required === true;
    let actionClass = item?.matrix?.owner_action_class || null;
    if (requiresOwnerDecision) actionClass = 'OWNER_ACTION_REQUIRED';
    else if (blockedByData) actionClass = 'DATA_BLOCKED';
    else if (status === 'DATA_ISSUE' ||
      (entry && (section === 'data_problems' || section === 'matrix_gaps'))) {
      actionClass = 'DATA_ISSUE';
    } else if (legacyRequired || actionClass === 'OWNER_ACTION_REQUIRED') {
      actionClass = 'TRIAGE_RESOLVED';
    }
    return {
      ...item,
      matrix: {
        ...(item.matrix || {}),
        owner_review_legacy_required: legacyRequired,
        owner_review_required: requiresOwnerDecision,
        owner_action_class: actionClass,
        data_blocked: blockedByData,
      },
      review_triage: {
        available: true,
        requires_owner_decision: requiresOwnerDecision,
        owner_decision_status: status,
        audit_owner_decision_status: auditStatus,
        blocker: compactBlocked?.blocker || entry?.owner_decision_blocker || null,
        linkage_reason: exclusion?.linkage_reason || null,
        reason_code: entry?.reason_code || auditEntry?.reason_code || null,
        section,
        audit_section: auditEntry?.section || null,
        audit_requires_owner_decision:
          auditEntry?.requires_owner_decision === true,
      },
    };
  });
}

function ownerSectionItem(item) {
  return {
    row_id: item.row_id,
    source_row: item.source_row,
    sku: item.sku,
    name: item.name,
    supplier: item.supplier || null,
    category: item.category || null,
    matrix_role: item.matrix?.role || null,
    priority: item.matrix?.owner_review_priority || null,
    score: item.matrix?.owner_review_score ?? null,
    reasons: [...(item.matrix?.owner_review_reasons || [])],
    recommended_action: item.matrix?.recommended_action || null,
    first_rollout_test_awaiting: item.first_rollout_test_awaiting === true,
    rollout_status: item.rollout_status || null,
    review_after_days: item.review_after_days ?? null,
    test_review_date: item.test_review_date || null,
    owner_decision: item.owner_decision || null,
    quantities: {
      minmax_quantity: item.quantities?.minmax_quantity ??
        item.quantities?.calculated_quantity ??
        null,
      policy_quantity: item.quantities?.policy_quantity ??
        item.quantities?.calculated_quantity ??
        null,
      rollout_recommended_quantity: item.quantities?.rollout_recommended_quantity ??
        item.rollout_recommended_quantity ??
        null,
      final_quantity: item.quantities?.final_quantity ?? null,
    },
    assortment_policy: item.assortment_policy || {
      matched: false,
      adjusted: false,
      rule: 'NONE',
    },
  };
}

class RunQueryService {
  constructor(registry, options = {}) {
    if (!registry) throw new TypeError('Run registry обязателен.');
    this.registry = registry;
    this.ownerDecisionService = options.ownerDecisionService || null;
  }

  getRunStatus(runId) {
    return this.registry.getRunStatus(runId);
  }

  getRunSummary(runId) {
    ensureCompleted(this.getRunStatus(runId));
    const summary = this.registry.getRunSummary(runId);
    let firstOrderCandidates = [];
    try {
      const result = this.registry.getAgentResult(runId);
      const payload = Array.isArray(result) ? result[0]?.json : result?.json;
      firstOrderCandidates = Array.isArray(payload?.firstOrderCandidates)
        ? payload.firstOrderCandidates
        : [];
    } catch {
      firstOrderCandidates = [];
    }
    const firstOrderSummary = {
      count: firstOrderCandidates.length,
      total_quantity: firstOrderCandidates.reduce(
        (sum, item) => sum + (Number(item.recommendedQuantity) || 0), 0
      ),
      priced_count: firstOrderCandidates.filter(
        item => Number.isFinite(Number(item.unitPrice ?? item.price))
      ).length,
      blocked_missing_price: firstOrderCandidates.filter(
        item => item.requiresSupplierPrice === true &&
          !Number.isFinite(Number(item.unitPrice ?? item.price))
      ).length,
      items: firstOrderCandidates,
    };
    const triageIndex = reviewTriageIndex(this.registry, runId);
    const compaction = triageIndex?.triage?.owner_review_compaction || null;
    if (!compaction) return { ...summary, first_order_from_matrix: firstOrderSummary };
    const legacy = summary?.owner_review || {};
    const decorated = this.getDecoratedItems(runId);
    const activeSummary = ownerDecisionSummary(decorated);
    const dataBlocked = decorated.filter(item =>
      item?.matrix?.owner_action_class === 'DATA_BLOCKED'
    ).length;
    const dataIssues = decorated.filter(item =>
      item?.matrix?.owner_action_class === 'DATA_BLOCKED' ||
      item?.matrix?.owner_action_class === 'DATA_ISSUE'
    ).length;
    return {
      ...summary,
      first_order_from_matrix: firstOrderSummary,
      owner_review: {
        ...legacy,
        legacy_action_required: legacy.action_required ?? 0,
        action_required: activeSummary.needs_decision,
        decision_count: compaction.total_owner_decision_count ?? 0,
        data_blocked: dataBlocked,
        data_issues: dataIssues,
        triage_authoritative: true,
      },
    };
  }

  getDecoratedItems(runId) {
    const items = this.registry.getItems(runId);
    const decorated = this.ownerDecisionService
      ? this.ownerDecisionService.decorateItems(items)
      : items;
    return applyReviewTriage(
      decorated,
      reviewTriageIndex(this.registry, runId)
    );
  }

  getOwnerDecisionSummary(runId) {
    ensureCompleted(this.getRunStatus(runId));
    return ownerDecisionSummary(this.getDecoratedItems(runId));
  }

  optimizeBudget(runId, targetBudget) {
    ensureCompleted(this.getRunStatus(runId));
    const finalOrder = buildFinalOrderState({
      items: this.getDecoratedItems(runId),
    });
    return optimizePurchasingBudget({
      finalOrder,
      targetBudget,
    });
  }

  saveOwnerDecision(runId, itemId, input) {
    ensureCompleted(this.getRunStatus(runId));
    if (!this.ownerDecisionService) {
      throw new RunQueryError(
        'OWNER_DECISION_STORAGE_ERROR',
        'Owner Decisions Memory недоступна.'
      );
    }
    const saved = this.ownerDecisionService.saveDecision(
      runId,
      itemId,
      input
    );
    return {
      run_id: runId,
      item: saved.item,
      owner_decisions: this.getOwnerDecisionSummary(runId),
      decisionHistory: saved.decisionHistory,
    };
  }

  listItems(runId, query = {}) {
    ensureCompleted(this.getRunStatus(runId));
    const page = integerQuery(query.page, 1, 'page');
    const pageSize = integerQuery(
      query.page_size,
      DEFAULT_PAGE_SIZE,
      'page_size',
      MAX_PAGE_SIZE
    );
    const filters = {
      q: normalizedSearch(query.q),
      decision: query.decision || null,
      workflow_status: query.workflow_status || null,
      matrix_role: query.matrix_role || null,
      confidence: query.confidence || null,
      owner_review: booleanQuery(query.owner_review, 'owner_review'),
      positive_order: booleanQuery(
        query.positive_order,
        'positive_order'
      ),
      policy_adjusted: booleanQuery(
        query.policy_adjusted,
        'policy_adjusted'
      ),
      owner_decision: enumQuery(
        query.owner_decision,
        ['missing', 'BUY', 'SKIP', 'DEFER', 'confirmed'],
        'owner_decision'
      ),
      owner_action_class: query.owner_action_class || null,
    };
    const sort = enumQuery(
      query.sort || 'source_row',
      ALLOWED_SORTS,
      'sort'
    );
    const order = enumQuery(
      query.order || 'asc',
      ALLOWED_ORDERS,
      'order'
    );
    const allItems = this.getDecoratedItems(runId);
    const filtered = allItems
      .filter(item => itemMatches(item, filters))
      .sort((left, right) => compareItems(left, right, sort, order));
    const result = pagination(filtered, page, pageSize);
    return {
      run_id: runId,
      items: result.items,
      pagination: result.pagination,
      filters: {
        ...filters,
        sort,
        order,
      },
      owner_decisions: ownerDecisionSummary(allItems),
    };
  }

  getOwnerReview(runId, query = {}) {
    ensureCompleted(this.getRunStatus(runId));
    const ownerReview = this.registry.getOwnerReview(runId);
    if (!query.section) return ownerReview;
    const section = enumQuery(
      query.section,
      OWNER_REVIEW_SECTIONS,
      'section'
    );
    const sectionKey = section === 'top_priority'
      ? 'owner_action_required'
      : section;
    const page = integerQuery(query.page, 1, 'page');
    const pageSize = integerQuery(
      query.page_size,
      DEFAULT_PAGE_SIZE,
      'page_size',
      MAX_PAGE_SIZE
    );
    const matching = this.getDecoratedItems(runId)
      .filter(item =>
        item.matrix?.owner_review_sections?.includes(sectionKey)
      )
      .sort((left, right) => compareItems(
        left,
        right,
        'owner_priority',
        'asc'
      ))
      .map(ownerSectionItem);
    const result = pagination(matching, page, pageSize);
    return {
      ...ownerReview,
      section,
      section_items: result.items,
      pagination: result.pagination,
    };
  }

  listArtifacts(runId) {
    ensureCompleted(this.getRunStatus(runId));
    return this.registry.listArtifacts(runId).map(artifact => ({
      ...artifact,
      download_url:
        `/api/v1/runs/${runId}/artifacts/${artifact.name}`,
    }));
  }
}

module.exports = {
  ALLOWED_ORDERS,
  ALLOWED_SORTS,
  OWNER_REVIEW_SECTIONS,
  RunQueryError,
  RunQueryService,
  booleanQuery,
  compareItems,
  ensureCompleted,
  integerQuery,
  itemMatches,
  normalizedSearch,
  ownerSectionItem,
  pagination,
  reviewTriageIndex,
  applyReviewTriage,
};
