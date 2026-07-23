const {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} = require('../config');
const {
  ownerDecisionSummary,
} = require('./owner_decision_service');

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
    filters.owner_decision &&
    filters.owner_decision !== 'missing' &&
    item.owner_decision?.decision !== filters.owner_decision
  ) return false;
  return true;
}

function ownerSectionItem(item) {
  return {
    row_id: item.row_id,
    source_row: item.source_row,
    sku: item.sku,
    name: item.name,
    matrix_role: item.matrix?.role || null,
    priority: item.matrix?.owner_review_priority || null,
    score: item.matrix?.owner_review_score ?? null,
    reasons: [...(item.matrix?.owner_review_reasons || [])],
    recommended_action: item.matrix?.recommended_action || null,
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
    return this.registry.getRunSummary(runId);
  }

  getDecoratedItems(runId) {
    const items = this.registry.getItems(runId);
    return this.ownerDecisionService
      ? this.ownerDecisionService.decorateItems(items)
      : items;
  }

  getOwnerDecisionSummary(runId) {
    ensureCompleted(this.getRunStatus(runId));
    return ownerDecisionSummary(this.getDecoratedItems(runId));
  }

  saveOwnerDecision(runId, itemId, input) {
    ensureCompleted(this.getRunStatus(runId));
    if (!this.ownerDecisionService) {
      throw new RunQueryError(
        'OWNER_DECISION_STORAGE_ERROR',
        'Owner Decisions Memory недоступна.'
      );
    }
    const item = this.ownerDecisionService.saveDecision(
      runId,
      itemId,
      input
    );
    return {
      run_id: runId,
      item,
      owner_decisions: this.getOwnerDecisionSummary(runId),
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
      owner_decision: enumQuery(
        query.owner_decision,
        ['missing', 'BUY', 'SKIP', 'DEFER'],
        'owner_decision'
      ),
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
};
