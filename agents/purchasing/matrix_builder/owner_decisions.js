const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWriteJsonFile,
  readJsonFileWithRecovery,
  rotateBackup,
} = require('../../../shared/storage/safe_json_store');
const {
  buildOwnerDecisionMigrationPlan,
  isRowIdHashKey,
  ownerDecisionKeyCandidates,
} = require('../services/owner_decision_identity');

const OWNER_DECISIONS = Object.freeze([
  'KEEP_CORE',
  'KEEP_OPTIONAL',
  'APPROVE_EXIT',
  'REJECT_EXIT',
  'KEEP_ZERO_STOCK',
  'REQUIRE_STOCK',
  'ACCEPT_POLICY',
  'OVERRIDE_POLICY',
  'BUY',
  'SKIP',
  'DEFER',
]);

const OWNER_DECISION_STATUSES = Object.freeze(['active', 'inactive']);
const OWNER_ROLE_OVERRIDES = Object.freeze(['CORE', 'OPTIONAL', 'EXIT']);
const RUN_SCOPED_DECISIONS = Object.freeze(['BUY', 'SKIP', 'DEFER']);
const PERMANENT_DECISIONS = Object.freeze([
  'KEEP_CORE',
  'KEEP_OPTIONAL',
  'APPROVE_EXIT',
  'REJECT_EXIT',
  'KEEP_ZERO_STOCK',
  'REQUIRE_STOCK',
  'ACCEPT_POLICY',
  'OVERRIDE_POLICY',
]);
const DEFAULT_RUN_DECISION_TTL_DAYS = 30;
const POLICY_FIELDS = Object.freeze([
  'priority',
  'minimum_shelf_stock',
  'target_stock',
  'maximum_stock',
  'safety_stock',
  'allow_zero_stock',
]);

class OwnerDecisionError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OwnerDecisionError';
    this.code = code;
  }
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new OwnerDecisionError(`${field} должен быть непустой строкой.`, 'INVALID_OWNER_DECISION');
  }
  return value.trim();
}

function optionalString(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new OwnerDecisionError(
      `${field} должен быть строкой.`,
      'INVALID_OWNER_DECISION'
    );
  }
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function normalizeSku(value) {
  return nonEmptyString(String(value ?? ''), 'sku').toUpperCase();
}

function isoTimestamp(value, field = 'decided_at') {
  const normalized = nonEmptyString(value, field);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    throw new OwnerDecisionError(`${field} должен содержать ISO timestamp.`, 'INVALID_OWNER_DECISION');
  }
  return parsed.toISOString();
}

function optionalScope(value) {
  if (value === null || value === undefined) return null;
  if (value !== 'permanent' && value !== 'run') {
    throw new OwnerDecisionError(
      "scope должен быть 'permanent' или 'run'.",
      'INVALID_OWNER_DECISION'
    );
  }
  return value;
}

function optionalExpiresAt(value) {
  if (value === null || value === undefined) return null;
  return isoTimestamp(value, 'expires_at');
}

function optionalIsoDate(value, field = 'original_decision_review_date') {
  if (value === null || value === undefined) return null;
  const normalized = nonEmptyString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new OwnerDecisionError(`${field} должен иметь формат YYYY-MM-DD.`, 'INVALID_OWNER_DECISION');
  }
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new OwnerDecisionError(`${field} содержит некорректную дату.`, 'INVALID_OWNER_DECISION');
  }
  return normalized;
}

function addDaysToIsoTimestamp(isoTimestamp, days) {
  const date = new Date(isoTimestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function defaultScopeForDecision(ownerDecision) {
  if (RUN_SCOPED_DECISIONS.includes(ownerDecision)) return 'run';
  return 'permanent';
}

function effectiveScope(decision) {
  if (decision.scope === 'permanent' || decision.scope === 'run') return decision.scope;
  return defaultScopeForDecision(decision.owner_decision);
}

function effectiveExpiresAt(decision) {
  if (decision.expires_at) return decision.expires_at;
  if (effectiveScope(decision) === 'permanent') return null;
  if (decision.decided_at) {
    return addDaysToIsoTimestamp(decision.decided_at, DEFAULT_RUN_DECISION_TTL_DAYS);
  }
  return null;
}

function isDecisionExpired(decision, nowIso) {
  if (effectiveScope(decision) === 'permanent') return false;
  const expiresAt = effectiveExpiresAt(decision);
  if (!expiresAt) return false;
  return expiresAt <= nowIso;
}

function optionalPolicyOverride(value, decision) {
  if (value === null || value === undefined) {
    if (decision === 'OVERRIDE_POLICY') {
      throw new OwnerDecisionError(
        'OVERRIDE_POLICY требует owner_policy_override.',
        'INVALID_OWNER_DECISION'
      );
    }
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new OwnerDecisionError(
      'owner_policy_override должен быть объектом.',
      'INVALID_OWNER_DECISION'
    );
  }
  const result = {};
  for (const [field, fieldValue] of Object.entries(value)) {
    if (!POLICY_FIELDS.includes(field)) {
      throw new OwnerDecisionError(
        `Неизвестное поле owner_policy_override: ${field}.`,
        'INVALID_OWNER_DECISION'
      );
    }
    if (field === 'priority') {
      if (!['critical', 'important', 'standard', 'review'].includes(fieldValue)) {
        throw new OwnerDecisionError(
          'owner_policy_override.priority содержит неизвестное значение.',
          'INVALID_OWNER_DECISION'
        );
      }
    } else if (field === 'allow_zero_stock') {
      if (typeof fieldValue !== 'boolean') {
        throw new OwnerDecisionError(
          'owner_policy_override.allow_zero_stock должен быть boolean.',
          'INVALID_OWNER_DECISION'
        );
      }
    } else if (
      typeof fieldValue !== 'number' ||
      !Number.isFinite(fieldValue) ||
      fieldValue < 0
    ) {
      throw new OwnerDecisionError(
        `owner_policy_override.${field} должен быть неотрицательным числом.`,
        'INVALID_OWNER_DECISION'
      );
    }
    result[field] = fieldValue;
  }
  if (Object.keys(result).length === 0) {
    throw new OwnerDecisionError(
      'owner_policy_override не должен быть пустым.',
      'INVALID_OWNER_DECISION'
    );
  }
  const minimum = result.minimum_shelf_stock;
  const target = result.target_stock;
  const maximum = result.maximum_stock;
  if (
    (minimum !== undefined && target !== undefined && minimum > target) ||
    (target !== undefined && maximum !== undefined && target > maximum)
  ) {
    throw new OwnerDecisionError(
      'owner_policy_override должен соблюдать minimum <= target <= maximum.',
      'INVALID_OWNER_DECISION'
    );
  }
  return result;
}

function optionalOrderQuantity(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new OwnerDecisionError(
      'owner_order_quantity должен быть целым числом от 0 до 10000.',
      'INVALID_OWNER_DECISION'
    );
  }
  return value;
}

function validateOwnerDecision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OwnerDecisionError('Запись owner decision должна быть объектом.', 'INVALID_OWNER_DECISION');
  }
  const ownerDecision = nonEmptyString(value.owner_decision, 'owner_decision').toUpperCase();
  if (!OWNER_DECISIONS.includes(ownerDecision)) {
    throw new OwnerDecisionError(
      `Неизвестное owner_decision: ${ownerDecision}.`,
      'UNKNOWN_OWNER_DECISION'
    );
  }
  const roleOverride = value.owner_role_override === null ||
    value.owner_role_override === undefined
    ? null
    : nonEmptyString(value.owner_role_override, 'owner_role_override').toUpperCase();
  if (roleOverride && !OWNER_ROLE_OVERRIDES.includes(roleOverride)) {
    throw new OwnerDecisionError(
      `Неизвестное owner_role_override: ${roleOverride}.`,
      'INVALID_OWNER_DECISION'
    );
  }
  const status = nonEmptyString(value.status, 'status').toLowerCase();
  if (!OWNER_DECISION_STATUSES.includes(status)) {
    throw new OwnerDecisionError(`Неизвестный status: ${status}.`, 'INVALID_OWNER_DECISION');
  }
  return {
    sku: normalizeSku(value.sku),
    owner_decision: ownerDecision,
    owner_role_override: roleOverride,
    owner_policy_override: optionalPolicyOverride(
      value.owner_policy_override,
      ownerDecision
    ),
    owner_order_quantity: optionalOrderQuantity(
      value.owner_order_quantity
    ),
    run_id: optionalString(value.run_id, 'run_id'),
    reason_code: optionalString(value.reason_code, 'reason_code')
      ?.toUpperCase() || null,
    comment: optionalString(value.comment, 'comment'),
    reason: nonEmptyString(value.reason, 'reason'),
    decided_at: isoTimestamp(value.decided_at),
    decided_by: nonEmptyString(value.decided_by, 'decided_by'),
    status,
    source_version: nonEmptyString(value.source_version, 'source_version'),
    idempotency_key: optionalString(value.idempotency_key, 'idempotency_key'),
    scope: optionalScope(value.scope),
    expires_at: optionalExpiresAt(value.expires_at),
    original_decision: optionalString(value.original_decision, 'original_decision'),
    original_decision_review_date: optionalIsoDate(
      value.original_decision_review_date,
      'original_decision_review_date'
    ),
  };
}

function validateOwnerDecisionStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OwnerDecisionError('Файл owner decisions должен быть объектом.', 'INVALID_OWNER_DECISION_FILE');
  }
  if (!Array.isArray(value.decisions)) {
    throw new OwnerDecisionError('decisions должен быть массивом.', 'INVALID_OWNER_DECISION_FILE');
  }
  if (value.version !== 1) {
    throw new OwnerDecisionError(
      'Owner decisions поддерживает только version=1.',
      'INVALID_OWNER_DECISION_FILE'
    );
  }
  return {
    version: 1,
    store: nonEmptyString(value.store || 'Миска', 'store'),
    updated_at: value.updated_at === null || value.updated_at === undefined
      ? null
      : isoTimestamp(value.updated_at, 'updated_at'),
    decisions: value.decisions.map(validateOwnerDecision),
  };
}

function emptyOwnerDecisionStore() {
  return { version: 1, store: 'Миска', updated_at: null, decisions: [] };
}

function loadOwnerDecisions(filePath, options = {}) {
  if (!filePath) {
    return { store: emptyOwnerDecisionStore(), sourcePath: null, missing: true };
  }
  const resolvedPath = path.resolve(filePath);
  let recovery = null;
  let parsed;
  try {
    const readResult = readJsonFileWithRecovery(resolvedPath, {
      fsModule: options.fsModule || fs,
    });
    parsed = readResult.data;
    if (readResult.diagnostic) {
      recovery = readResult.diagnostic;
    }
  } catch (error) {
    if (error.code === 'SAFE_JSON_NOT_FOUND' && options.allowMissing !== false) {
      return {
        store: emptyOwnerDecisionStore(),
        sourcePath: resolvedPath,
        missing: true,
      };
    }
    if (error instanceof OwnerDecisionError) throw error;
    throw new OwnerDecisionError(
      `Не удалось загрузить owner decisions «${resolvedPath}»: ${error.message}.`,
      'OWNER_DECISION_FILE_ERROR',
      error
    );
  }
  try {
    return {
      store: validateOwnerDecisionStore(parsed),
      sourcePath: resolvedPath,
      missing: false,
      recovery,
    };
  } catch (error) {
    if (error instanceof OwnerDecisionError) throw error;
    throw new OwnerDecisionError(
      `Owner decisions содержит некорректный JSON: ${error.message}.`,
      'OWNER_DECISION_FILE_ERROR',
      error
    );
  }
}

function latestActiveDecisions(decisions, options = {}) {
  const nowIso = options.now || new Date().toISOString();
  const latest = new Map();
  decisions.forEach((decision, index) => {
    if (decision.status !== 'active') return;
    if (isDecisionExpired(decision, nowIso)) return;
    const previous = latest.get(decision.sku);
    if (
      !previous ||
      decision.decided_at > previous.decision.decided_at ||
      (decision.decided_at === previous.decision.decided_at && index > previous.index)
    ) latest.set(decision.sku, { decision, index });
  });
  return new Map(Array.from(latest, ([sku, entry]) => [sku, entry.decision]));
}

function latestDecisions(decisions) {
  const latest = new Map();
  decisions.forEach((decision, index) => {
    const previous = latest.get(decision.sku);
    if (
      !previous ||
      decision.decided_at > previous.decision.decided_at ||
      (decision.decided_at === previous.decision.decided_at && index > previous.index)
    ) latest.set(decision.sku, { decision, index });
  });
  return new Map(Array.from(latest, ([sku, entry]) => [sku, entry.decision]));
}

/**
 * Build a map of legacy SMARTZAPAS row-id hash keys to stable canonical keys.
 *
 * The returned map lets old hash-key decisions continue to apply after a new
 * Excel export: the hash key is kept as an alias that resolves to the same
 * supplier+SKU (or barcode / brand+name) decision key that the migration plan
 * derived from owner-decision-history.json.
 */
function buildLegacyRowIdAliases(store, history) {
  const plan = buildOwnerDecisionMigrationPlan(store, history);
  const aliases = new Map();
  for (const migration of plan.migrated) {
    aliases.set(migration.oldKey, {
      newKey: migration.newKey,
      matchMethod: migration.matchMethod,
    });
  }
  return { aliases, plan };
}

function itemSkuCandidates(item) {
  const candidates = ownerDecisionKeyCandidates({
    supplier: item?.supplier,
    sku: item?.article,
    barcode: item?.barcode,
    brand: item?.brand,
    name: item?.name,
  });
  // Legacy decisions keyed by internal product id are still honored.
  if (
    item.internal_product_id !== null &&
    item.internal_product_id !== undefined &&
    String(item.internal_product_id).trim() !== ''
  ) {
    candidates.push(String(item.internal_product_id).trim().toUpperCase());
  }
  return candidates;
}

function roleForDecision(decision, calculatedRole) {
  if (decision.owner_role_override) return decision.owner_role_override;
  if (decision.owner_decision === 'KEEP_CORE') return 'CORE';
  if (decision.owner_decision === 'KEEP_OPTIONAL') return 'OPTIONAL';
  if (decision.owner_decision === 'REJECT_EXIT' && calculatedRole === 'EXIT') {
    return 'OPTIONAL';
  }
  return calculatedRole;
}

function decisionConflicts(item, decision, effectiveRole) {
  if (decision.owner_decision === 'KEEP_CORE') return item.suggested_role === 'EXIT';
  if (decision.owner_decision === 'KEEP_OPTIONAL') {
    return item.suggested_role === 'EXIT';
  }
  if (decision.owner_decision === 'REJECT_EXIT') return false;
  if (decision.owner_decision === 'REQUIRE_STOCK') return item.suggested_role === 'EXIT';
  if (decision.owner_decision === 'APPROVE_EXIT') {
    return item.suggested_role !== 'EXIT';
  }
  if (
    decision.owner_decision === 'ACCEPT_POLICY' &&
    decision.source_version !== item.builder_version
  ) return item.approved_policy_conflict;
  if (decision.owner_decision === 'OVERRIDE_POLICY') {
    if (decision.source_version === item.builder_version) return false;
    return Object.entries(decision.owner_policy_override || {}).some(([field, value]) => {
      const itemField = {
        priority: 'suggested_priority',
        minimum_shelf_stock: 'suggested_minimum_shelf_stock',
        target_stock: 'suggested_target_stock',
        maximum_stock: 'suggested_maximum_stock',
        safety_stock: 'suggested_safety_stock',
        allow_zero_stock: 'suggested_allow_zero_stock',
      }[field];
      return item[itemField] !== value;
    });
  }
  return effectiveRole !== item.suggested_role && item.suggested_role === 'EXIT';
}

function applyPolicyOverride(item, policyOverride) {
  if (!policyOverride) return;
  const fields = {
    priority: 'suggested_priority',
    minimum_shelf_stock: 'suggested_minimum_shelf_stock',
    target_stock: 'suggested_target_stock',
    maximum_stock: 'suggested_maximum_stock',
    safety_stock: 'suggested_safety_stock',
    allow_zero_stock: 'suggested_allow_zero_stock',
  };
  for (const [field, value] of Object.entries(policyOverride)) {
    item[fields[field]] = value;
    if (item.suggested_policy && field !== 'allow_zero_stock') {
      item.suggested_policy[field] = value;
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(policyOverride, 'maximum_stock') &&
    typeof item.evidence?.purchase_price === 'number'
  ) {
    item.maximum_stock_value = policyOverride.maximum_stock * item.evidence.purchase_price;
  }
  const minimum = item.suggested_minimum_shelf_stock;
  const target = item.suggested_target_stock;
  const maximum = item.suggested_maximum_stock;
  if (
    [minimum, target, maximum].every(value => typeof value === 'number') &&
    (minimum > target || target > maximum)
  ) {
    throw new OwnerDecisionError(
      'Результирующая owner policy должна соблюдать minimum <= target <= maximum.',
      'INVALID_OWNER_DECISION'
    );
  }
}

function applyDecisionToItem(sourceItem, decision, builderVersion) {
  const item = structuredClone(sourceItem);
  item.builder_version = builderVersion;
  item.calculated_role = sourceItem.suggested_role;
  item.calculated_policy = {
    ...(structuredClone(sourceItem.suggested_policy) || {}),
    allow_zero_stock: sourceItem.suggested_allow_zero_stock,
  };
  item.owner_decision_status = decision ? decision.status : 'none';
  item.owner_decision_applied = false;
  item.owner_decision_conflict = false;
  item.owner_decision_summary = decision
    ? `${decision.owner_decision}: ${decision.reason}`
    : null;
  item.owner_order_decision = decision &&
    ['BUY', 'SKIP', 'DEFER'].includes(decision.owner_decision)
    ? decision.owner_decision
    : null;
  item.owner_order_quantity = decision?.owner_order_quantity ?? null;
  item.owner_decision_suppress_review = false;
  item.owner_decision_force_review = false;
  item.owner_decision_excluded_from_review = false;
  if (!decision || decision.status !== 'active') return item;
  if (decision.owner_decision === 'DEFER') {
    item.owner_decision_force_review = true;
    return item;
  }

  const effectiveRole = roleForDecision(decision, sourceItem.suggested_role);
  const conflict = decisionConflicts(item, decision, effectiveRole);
  item.owner_decision_conflict = conflict;
  item.owner_decision_applied = !conflict;
  if (conflict) {
    item.owner_decision_force_review = true;
    item.reason_codes = Array.from(new Set([
      ...(item.reason_codes || []),
      'OWNER_DECISION_CONFLICT',
    ]));
    item.manual_review_reasons = Array.from(new Set([
      ...(item.manual_review_reasons || []),
      'OWNER_DECISION_CONFLICT',
    ]));
    item.review_queue_memberships = Array.from(new Set([
      ...(item.review_queue_memberships || []),
      'commercial_review',
    ]));
    return item;
  }

  item.suggested_role = effectiveRole;
  if (decision.owner_decision === 'KEEP_ZERO_STOCK') {
    item.suggested_allow_zero_stock = true;
  }
  if (decision.owner_decision === 'REQUIRE_STOCK') {
    item.suggested_allow_zero_stock = false;
  }
  if (decision.owner_decision === 'OVERRIDE_POLICY') {
    applyPolicyOverride(item, decision.owner_policy_override);
  }
  if (decision.owner_decision === 'ACCEPT_POLICY') {
    item.approved_policy_conflict = false;
    item.policy_conflict = false;
    item.review_queue_memberships = (item.review_queue_memberships || [])
      .filter(queue => queue !== 'policy_conflict');
    item.reason_codes = (item.reason_codes || [])
      .filter(reason => reason !== 'approved_policy_conflict');
    item.manual_review_reasons = (item.manual_review_reasons || [])
      .filter(reason => reason !== 'approved_policy_conflict');
  }
  if (decision.owner_decision === 'APPROVE_EXIT') {
    item.owner_exit_approved = true;
  }
  if (decision.owner_decision === 'REJECT_EXIT') {
    item.owner_exit_rejected = true;
    item.owner_decision_force_review = true;
    item.owner_decision_suppress_review = false;
    item.review_queue_memberships = Array.from(new Set([
      ...(item.review_queue_memberships || []).filter(queue => queue !== 'exit_review'),
      'commercial_review',
    ]));
    item.reason_codes = Array.from(new Set([
      ...(item.reason_codes || []),
      'OWNER_REJECTED_EXIT',
    ]));
    item.manual_review_reasons = Array.from(new Set([
      ...(item.manual_review_reasons || []),
      'OWNER_REJECTED_EXIT',
    ]));
  } else {
    item.owner_decision_suppress_review = true;
    item.owner_decision_excluded_from_review = true;
  }
  return item;
}

function applyOwnerDecisions(draft, storeInput, options = {}) {
  const store = validateOwnerDecisionStore(storeInput || emptyOwnerDecisionStore());
  const nowIso = options.now || new Date().toISOString();
  const latest = latestDecisions(store.decisions);
  const latestActive = latestActiveDecisions(store.decisions, { now: nowIso });

  const legacyIdentityDiagnostics = [];
  const ownerDecisionDiagnostics = [];
  let aliases = new Map();
  let migrationPlan = null;

  if (options.history) {
    const aliasResult = buildLegacyRowIdAliases(store, options.history);
    aliases = aliasResult.aliases;
    migrationPlan = aliasResult.plan;
    for (const [oldKey, { newKey, matchMethod }] of aliases) {
      legacyIdentityDiagnostics.push({
        code: 'OWNER_DECISION_MIGRATED',
        oldSku: oldKey,
        newSku: newKey,
        matchMethod,
        severity: 'info',
      });
    }
  }

  const sourceItems = draft.items || [];
  const identifierCounts = new Map();
  sourceItems.forEach(sourceItem => {
    new Set(itemSkuCandidates(sourceItem)).forEach(candidate => {
      identifierCounts.set(candidate, (identifierCounts.get(candidate) || 0) + 1);
    });
  });

  // Alias old hash keys to the stable canonical keys that history derived.
  // Each alias is counted once because a legacy row identity is unique.
  sourceItems.forEach(sourceItem => {
    const candidates = new Set(itemSkuCandidates(sourceItem));
    for (const [oldKey, { newKey }] of aliases) {
      if (candidates.has(newKey)) {
        identifierCounts.set(oldKey, (identifierCounts.get(oldKey) || 0) + 1);
      }
    }
  });

  const matchedActiveSkus = new Set();
  const items = sourceItems.map(sourceItem => {
    const baseCandidates = itemSkuCandidates(sourceItem);
    const candidates = [...baseCandidates];
    for (const [oldKey, { newKey }] of aliases) {
      if (baseCandidates.includes(newKey) && !candidates.includes(oldKey)) {
        candidates.push(oldKey);
      }
    }
    const activeSku = candidates.find(candidate =>
      identifierCounts.get(candidate) === 1 && latestActive.has(candidate)
    );
    const inactiveSku = activeSku
      ? null
      : candidates.find(candidate =>
        identifierCounts.get(candidate) === 1 &&
        latest.get(candidate)?.status === 'inactive'
      );
    const decision = activeSku
      ? latestActive.get(activeSku)
      : inactiveSku
        ? latest.get(inactiveSku)
        : null;
    if (activeSku) matchedActiveSkus.add(activeSku);
    return applyDecisionToItem(sourceItem, decision, draft.builder_version);
  });

  const count = predicate => items.filter(predicate).length;
  const roles = { ...(draft.summary?.roles || {}) };
  for (const role of Object.keys(roles)) {
    roles[role] = count(item => item.suggested_role === role);
  }
  const deferred = count(item =>
    item.owner_decision_status === 'active' &&
    item.owner_decision_summary?.startsWith('DEFER:')
  );

  const orphanedLegacyDecisions = [];
  const historicalExpiredLegacyDecisions = [];
  if (migrationPlan) {
    const resolvedOldKeys = new Set();
    sourceItems.forEach(sourceItem => {
      const candidates = new Set(itemSkuCandidates(sourceItem));
      for (const [oldKey, { newKey }] of aliases) {
        if (candidates.has(newKey)) resolvedOldKeys.add(oldKey);
      }
    });

    const migratedOrEquivalentOldKeys = new Set([
      ...migrationPlan.migrated.map(entry => entry.oldKey),
      ...migrationPlan.unchanged.filter(entry => entry.newKey).map(entry => entry.oldKey),
    ]);

    for (const decision of store.decisions) {
      if (decision.status !== 'active') continue;
      if (!isRowIdHashKey(decision.sku)) continue;
      if (migratedOrEquivalentOldKeys.has(decision.sku)) continue;
      if (resolvedOldKeys.has(decision.sku)) continue;

      const skipped = migrationPlan.skipped.find(entry => entry.oldKey === decision.sku);
      const conflict = migrationPlan.conflicts.find(entry => entry.oldKey === decision.sku);
      const reason = skipped?.reason || conflict?.reason || 'unrecognized-legacy-key';

      if (RUN_SCOPED_DECISIONS.includes(decision.owner_decision)) {
        historicalExpiredLegacyDecisions.push({
          sku: decision.sku,
          reason,
          decided_at: decision.decided_at,
          owner_decision: decision.owner_decision,
        });
        continue;
      }

      orphanedLegacyDecisions.push({
        sku: decision.sku,
        reason,
        decided_at: decision.decided_at,
        owner_decision: decision.owner_decision,
      });
      legacyIdentityDiagnostics.push({
        code: 'ORPHANED_OWNER_DECISION',
        sku: decision.sku,
        reason,
        severity: 'warning',
      });
    }
  }

  // Diagnostics for run-scoped decisions that have expired but still resolve
  // to a current item (not orphaned). These are intentionally surfaced so the
  // owner sees when a one-time BUY/SKIP/DEFER decision stopped being applied.
  const currentDraftSkuKeys = new Set();
  sourceItems.forEach(sourceItem => {
    itemSkuCandidates(sourceItem).forEach(candidate => currentDraftSkuKeys.add(candidate));
  });
  sourceItems.forEach(sourceItem => {
    const candidates = new Set(itemSkuCandidates(sourceItem));
    for (const [oldKey, { newKey }] of aliases) {
      if (candidates.has(newKey)) currentDraftSkuKeys.add(oldKey);
    }
  });
  for (const [sku, decision] of latest) {
    if (decision.status !== 'active') continue;
    if (!isDecisionExpired(decision, nowIso)) continue;
    if (!currentDraftSkuKeys.has(sku)) continue;
    ownerDecisionDiagnostics.push({
      code: 'RUN_SCOPED_DECISION_EXPIRED',
      sku,
      owner_decision: decision.owner_decision,
      decided_at: decision.decided_at,
      expires_at: effectiveExpiresAt(decision),
      severity: 'info',
    });
  }

  const result = {
    draft: {
      ...draft,
      items,
      summary: {
        ...(draft.summary || {}),
        roles,
        policy_conflicts: count(item => item.approved_policy_conflict),
        approved_policy_conflicts: count(item => item.approved_policy_conflict),
      },
    },
    summary: {
      records_loaded: store.decisions.length,
      active_skus_loaded: latestActive.size,
      matched_active_skus: matchedActiveSkus.size,
      applied: count(item => item.owner_decision_applied),
      conflicts: count(item => item.owner_decision_conflict),
      deferred,
      excluded_from_repeat_review: count(item => item.owner_decision_excluded_from_review),
      unmatched_active_skus: Array.from(latestActive.keys())
        .filter(sku => !matchedActiveSkus.has(sku)),
      excluded_skus: items
        .filter(item => item.owner_decision_excluded_from_review)
        .map(item => item.article || item.rowIdentity),
      orphaned_legacy_decisions: orphanedLegacyDecisions,
      historical_expired_legacy_decisions: historicalExpiredLegacyDecisions,
    },
    legacyIdentityDiagnostics,
    ownerDecisionDiagnostics,
    store,
  };
  return result;
}

const fileWriteLocks = new Map();

function appendOwnerDecision(filePath, decisionInput, options = {}) {
  if (!filePath) {
    throw new OwnerDecisionError(
      'Не указан путь к owner decisions.',
      'OWNER_DECISION_FILE_ERROR'
    );
  }
  const resolvedPath = path.resolve(filePath);

  if (fileWriteLocks.has(resolvedPath)) {
    throw new OwnerDecisionError(
      `Конфликтующая запись в owner decisions «${resolvedPath}» уже выполняется.`,
      'OWNER_DECISION_WRITE_CONFLICT'
    );
  }
  fileWriteLocks.set(resolvedPath, true);

  try {
    const loaded = loadOwnerDecisions(resolvedPath, {
      allowMissing: true,
      fsModule: options.fsModule || fs,
    });

    if (options.idempotencyKey) {
      const duplicate = [...loaded.store.decisions]
        .reverse()
        .find(entry => entry.idempotency_key === options.idempotencyKey);
      if (duplicate) {
        return {
          decision: duplicate,
          store: loaded.store,
          sourcePath: resolvedPath,
          duplicate: true,
        };
      }
    }

    const decidedAt = decisionInput.decided_at || new Date(
      options.currentDate || new Date()
    ).toISOString();
    const decision = validateOwnerDecision({
      ...decisionInput,
      idempotency_key: options.idempotencyKey,
      decided_at: decidedAt,
    });
    const store = {
      ...loaded.store,
      updated_at: decision.decided_at,
      decisions: [...loaded.store.decisions, decision],
    };
    const validated = validateOwnerDecisionStore(store);

    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    rotateBackup(resolvedPath, {
      fsModule: options.fsModule || fs,
      maxBackups: options.maxBackups ?? 5,
    });
    atomicWriteJsonFile(resolvedPath, validated, {
      fsModule: options.fsModule || fs,
      staleMaxAgeMs: options.staleMaxAgeMs ?? 5 * 60 * 1000,
    });

    return {
      decision,
      store: validated,
      sourcePath: resolvedPath,
      duplicate: false,
    };
  } catch (error) {
    if (error instanceof OwnerDecisionError) throw error;
    throw new OwnerDecisionError(
      `Не удалось сохранить owner decision: ${error.message}.`,
      'OWNER_DECISION_WRITE_ERROR',
      error
    );
  } finally {
    fileWriteLocks.delete(resolvedPath);
  }
}

module.exports = {
  OWNER_DECISIONS,
  OWNER_DECISION_STATUSES,
  RUN_SCOPED_DECISIONS,
  PERMANENT_DECISIONS,
  DEFAULT_RUN_DECISION_TTL_DAYS,
  OwnerDecisionError,
  normalizeSku,
  validateOwnerDecision,
  validateOwnerDecisionStore,
  emptyOwnerDecisionStore,
  loadOwnerDecisions,
  latestActiveDecisions,
  latestDecisions,
  buildLegacyRowIdAliases,
  applyOwnerDecisions,
  appendOwnerDecision,
  addDaysToIsoTimestamp,
  effectiveScope,
  effectiveExpiresAt,
  isDecisionExpired,
};
