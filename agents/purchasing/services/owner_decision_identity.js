'use strict';

/**
 * Canonical owner-decision identity.
 *
 * A decision must stay attached to the same real-world SKU even when:
 * - the imported Excel file is re-exported (different file hash),
 * - row order changes,
 * - stock or sales figures change,
 * - new SKUs are added to the assortment.
 *
 * The canonical key is therefore built only from stable, business-level
 * fields: supplier identity + normalized supplier SKU.  When no article is
 * available we fall back to supplier + normalized brand + name.  Row numbers,
 * file hashes, or any other export-dependent tokens are never part of the
 * identity.
 */

class OwnerDecisionIdentityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerDecisionIdentityError';
    this.code = code;
  }
}

function optionalString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function normalizedIdentifier(value) {
  const normalized = optionalString(value);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizedText(value) {
  const normalized = optionalString(value);
  return normalized
    ? normalized.toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
    : null;
}

function normalizeSupplier(value) {
  const normalized = optionalString(value);
  return normalized ? normalized.toUpperCase().replace(/\s+/g, ' ') : 'UNKNOWN';
}

function supplierKeyPart(supplier) {
  return `SUPPLIER:${normalizeSupplier(supplier)}`;
}

function supplierSkuKey(supplier, sku) {
  const normalizedSku = normalizedIdentifier(sku);
  if (!normalizedSku) return null;
  return `${supplierKeyPart(supplier)}:SKU:${normalizedSku}`;
}

function supplierBarcodeKey(supplier, barcode) {
  const normalizedBarcode = normalizedIdentifier(barcode);
  if (!normalizedBarcode) return null;
  return `${supplierKeyPart(supplier)}:BARCODE:${normalizedBarcode}`;
}

function normalizedFallbackName(value) {
  const normalized = optionalString(value);
  return normalized ? normalized.toUpperCase().replace(/\s+/g, ' ') : null;
}

function supplierFallbackKey(supplier, brand, name) {
  const normalizedName = normalizedFallbackName(name);
  if (!normalizedName) return null;
  return `${supplierKeyPart(supplier)}:FALLBACK:${normalizeSupplier(brand)}|${normalizedName}`;
}

/**
 * Return all possible identity candidates for an item, ordered from most
 * preferred to least preferred.
 *
 * Supplier-aware canonical keys come first.  Plain SKU/barcode strings are
 * kept at the end so that legacy decisions (stored before supplier-aware
 * keys were introduced) continue to apply when no newer, more specific key
 * matches.
 */
function ownerDecisionKeyCandidates(item) {
  const supplier = item?.supplier;
  const candidates = [];

  const skuKey = supplierSkuKey(supplier, item?.sku);
  if (skuKey) {
    candidates.push(skuKey);
    candidates.push(normalizedIdentifier(item.sku));
  }

  const barcodeKey = supplierBarcodeKey(supplier, item?.barcode);
  if (barcodeKey) {
    candidates.push(barcodeKey);
    candidates.push(normalizedIdentifier(item.barcode));
  }

  const fallbackKey = supplierFallbackKey(supplier, item?.brand, item?.name);
  if (fallbackKey) {
    candidates.push(fallbackKey);
  }

  return candidates;
}

function ownerDecisionKeyContext(items) {
  const counts = new Map();
  for (const item of items || []) {
    for (const candidate of ownerDecisionKeyCandidates(item)) {
      counts.set(candidate, (counts.get(candidate) || 0) + 1);
    }
  }
  return counts;
}

function uniqueOwnerDecisionKey(item, context) {
  const counts = context || ownerDecisionKeyContext([item]);
  return ownerDecisionKeyCandidates(item).find(
    candidate => counts.get(candidate) === 1
  ) || null;
}

function buildOwnerDecisionStableItemKey(item, context) {
  const key = uniqueOwnerDecisionKey(item, context);
  if (!key) {
    throw new OwnerDecisionIdentityError(
      'AMBIGUOUS_ITEM_IDENTITY',
      'Невозможно построить безопасный канонический ключ решения владельца.'
    );
  }
  return key;
}

function isSupplierAwareKey(key) {
  return typeof key === 'string' && key.startsWith('SUPPLIER:');
}

function isPlainIdentifierKey(key) {
  return typeof key === 'string' && !key.includes(':') && key.trim() !== '';
}

function isRowIdHashKey(key) {
  return typeof key === 'string' && key.includes(':') && !isSupplierAwareKey(key);
}

function normalizeHistoryStableItemKey(key) {
  let normalized = normalizedIdentifier(key);
  if (!normalized) return null;
  if (normalized.startsWith('ROW:')) {
    normalized = normalized.slice(4);
  }
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Leave as-is if decoding fails.
  }
  normalized = normalized.toUpperCase();
  try {
    normalized = encodeURIComponent(normalized).replace(
      /%[0-9a-f]{2}/g,
      match => match.toUpperCase()
    );
  } catch {
    // Leave as-is if encoding fails.
  }
  return normalized;
}

function isValidProductName(value) {
  const normalized = optionalString(value);
  return normalized ? normalized.length >= 3 : false;
}

function addToIdentityGroup(groups, key, value) {
  if (!groups.has(key)) groups.set(key, new Set());
  groups.get(key).add(value);
}

function buildHistoryIdentityContext(entries) {
  const skuGroups = new Map();
  const barcodeGroups = new Map();
  const nameGroups = new Map();
  for (const entry of entries || []) {
    const supplier = normalizeSupplier(entry?.supplier);
    const rowId = normalizeHistoryStableItemKey(entry?.stableItemKey);
    const sku = normalizedIdentifier(entry?.sku);
    const barcode = normalizedIdentifier(entry?.barcode);
    const name = normalizedFallbackName(entry?.productName);
    if (supplier && sku) {
      addToIdentityGroup(skuGroups, `${supplier}|${sku}`, rowId);
    }
    if (supplier && barcode) {
      addToIdentityGroup(barcodeGroups, `${supplier}|${barcode}`, rowId);
    }
    if (supplier && name && isValidProductName(entry?.productName)) {
      addToIdentityGroup(nameGroups, `${supplier}|${name}`, rowId);
    }
  }
  return { skuGroups, barcodeGroups, nameGroups };
}

function isUniqueIdentity(context, supplier, value, type) {
  const groups = type === 'sku'
    ? context.skuGroups
    : type === 'barcode'
      ? context.barcodeGroups
      : context.nameGroups;
  const group = groups.get(`${supplier}|${value}`);
  return group ? group.size === 1 : false;
}

function decisionsAreEquivalent(left, right) {
  if (left?.owner_decision !== right?.owner_decision) return false;
  if (left?.status !== right?.status) return false;
  if (left?.owner_decision === 'BUY') {
    return left?.owner_order_quantity === right?.owner_order_quantity;
  }
  return true;
}

function partitionByEquivalence(decisions) {
  const classes = [];
  for (const decision of decisions) {
    let placed = false;
    for (const cls of classes) {
      if (decisionsAreEquivalent(cls[0], decision)) {
        cls.push(decision);
        placed = true;
        break;
      }
    }
    if (!placed) classes.push([decision]);
  }
  return classes;
}

function buildMigratedDecision(decision, newKey, matchMethod) {
  return {
    ...decision,
    sku: newKey,
    migration_metadata: {
      old_key: decision.sku,
      migrated_at: new Date().toISOString(),
      match_method: matchMethod,
    },
  };
}

function findBestHistoryMatch(historyEntries, identityContext) {
  // SKU and barcode are assumed stable per supplier; duplicates across
  // different rowIds usually mean the same product was decided in multiple
  // exports.  Only productName requires strict uniqueness.
  for (const entry of historyEntries) {
    const supplier = normalizeSupplier(entry?.supplier);
    const sku = normalizedIdentifier(entry?.sku);
    if (supplier && sku) {
      return {
        entry,
        matchMethod: 'supplier_sku',
        newKey: supplierSkuKey(supplier, sku),
      };
    }
  }

  for (const entry of historyEntries) {
    const supplier = normalizeSupplier(entry?.supplier);
    const barcode = normalizedIdentifier(entry?.barcode);
    if (supplier && barcode) {
      return {
        entry,
        matchMethod: 'supplier_barcode',
        newKey: supplierBarcodeKey(supplier, barcode),
      };
    }
  }

  for (const entry of historyEntries) {
    const supplier = normalizeSupplier(entry?.supplier);
    const name = normalizedFallbackName(entry?.productName);
    if (supplier && name && isValidProductName(entry?.productName)) {
      if (isUniqueIdentity(identityContext, supplier, name, 'name')) {
        return {
          entry,
          matchMethod: 'supplier_product_name',
          newKey: supplierFallbackKey(supplier, entry?.brand, entry?.productName),
        };
      }
      return {
        conflict: true,
        matchMethod: 'supplier_product_name',
        newKey: supplierFallbackKey(supplier, entry?.brand, entry?.productName),
        reason: 'supplier-product-name-not-unique-in-history',
      };
    }
  }

  return null;
}

function buildOwnerDecisionMigrationPlan(decisionsMemory, decisionHistory) {
  const decisions = decisionsMemory?.decisions || [];
  const entries = decisionHistory?.entries || [];

  const result = {
    migrated: [],
    unchanged: [],
    skipped: [],
    conflicts: [],
  };

  const identityContext = buildHistoryIdentityContext(entries);

  const historyByRowId = new Map();
  for (const entry of entries) {
    const key = normalizeHistoryStableItemKey(entry?.stableItemKey);
    if (!key) continue;
    if (!historyByRowId.has(key)) historyByRowId.set(key, []);
    historyByRowId.get(key).push(entry);
  }

  const existingBySku = new Map();
  for (const decision of decisions) {
    const key = normalizedIdentifier(decision?.sku);
    if (!key) continue;
    if (!existingBySku.has(key)) existingBySku.set(key, []);
    existingBySku.get(key).push(decision);
  }

  const targets = [];

  for (const decision of decisions) {
    const oldKey = decision?.sku;

    if (decision?.status !== 'active') {
      result.skipped.push({
        decision,
        oldKey,
        reason: 'inactive-decision',
      });
      continue;
    }

    if (isSupplierAwareKey(oldKey) || isPlainIdentifierKey(oldKey)) {
      result.unchanged.push({
        decision,
        oldKey,
        reason: 'already-supported-key-format',
      });
      continue;
    }

    if (!isRowIdHashKey(oldKey)) {
      result.skipped.push({
        decision,
        oldKey,
        reason: 'unrecognized-key-format',
      });
      continue;
    }

    const normalizedOldKey = normalizeHistoryStableItemKey(oldKey);
    const historyEntries = historyByRowId.get(normalizedOldKey) || [];
    if (historyEntries.length === 0) {
      result.skipped.push({
        decision,
        oldKey,
        reason: 'no-matching-history-entry',
      });
      continue;
    }

    const match = findBestHistoryMatch(historyEntries, identityContext);

    if (match && match.conflict) {
      targets.push({
        decision,
        oldKey,
        newKey: match.newKey,
        matchMethod: match.matchMethod,
        conflictReason: match.reason,
      });
      continue;
    }

    if (!match || !match.newKey) {
      result.skipped.push({
        decision,
        oldKey,
        reason: 'no-unique-usable-identity-in-history',
      });
      continue;
    }

    targets.push({
      decision,
      oldKey,
      newKey: match.newKey,
      matchMethod: match.matchMethod,
    });
  }

  const groups = new Map();
  for (const target of targets) {
    if (!groups.has(target.newKey)) {
      groups.set(target.newKey, { matchMethod: target.matchMethod, items: [] });
    }
    groups.get(target.newKey).items.push(target);
  }

  for (const [newKey, group] of groups) {
    const existing = existingBySku.get(newKey) || [];
    const allDecisions = [...existing, ...group.items.map(item => item.decision)];
    const equivalenceClasses = partitionByEquivalence(allDecisions);

    if (equivalenceClasses.length === 1) {
      if (existing.length > 0) {
        for (const item of group.items) {
          result.unchanged.push({
            decision: item.decision,
            oldKey: item.oldKey,
            newKey,
            matchMethod: group.matchMethod,
            reason: 'target-key-already-has-equivalent-decision',
          });
        }
      } else {
        const representative = equivalenceClasses[0][0];
        let migratedRepresentative = false;
        for (const item of group.items) {
          if (!migratedRepresentative && item.decision === representative) {
            result.migrated.push({
              oldDecision: item.decision,
              oldKey: item.oldKey,
              newKey,
              matchMethod: group.matchMethod,
              newDecision: buildMigratedDecision(item.decision, newKey, group.matchMethod),
            });
            migratedRepresentative = true;
          } else {
            result.unchanged.push({
              decision: item.decision,
              oldKey: item.oldKey,
              newKey,
              matchMethod: group.matchMethod,
              reason: 'source-group-equivalent-decision-deduplicated',
            });
          }
        }
      }
      continue;
    }

    // Mixed decisions for the same canonical key cannot be migrated safely.
    for (const item of group.items) {
      let reason;
      if (existing.length > 0 && group.items.length === 1) {
        reason = 'target-key-exists-with-different-decision';
      } else {
        reason = item.conflictReason || 'multiple-source-decisions-target-same-key';
      }

      const conflict = {
        decision: item.decision,
        oldKey: item.oldKey,
        newKey,
        matchMethod: group.matchMethod,
        reason,
      };

      if (reason === 'target-key-exists-with-different-decision') {
        conflict.existingDecision = existing[0];
      }

      result.conflicts.push(conflict);
    }
  }

  return result;
}

function summarizeMigrationPlan(plan) {
  return {
    migrated: plan.migrated.length,
    unchanged: plan.unchanged.length,
    skipped: plan.skipped.length,
    conflicts: plan.conflicts.length,
    total: plan.migrated.length + plan.unchanged.length + plan.skipped.length + plan.conflicts.length,
  };
}

function applyOwnerDecisionMigrationPlan(plan, options = {}) {
  const dryRun = options.dryRun !== false;
  const summary = summarizeMigrationPlan(plan);

  if (dryRun) {
    return {
      dryRun: true,
      summary,
    };
  }

  const sourceDecisions = options.decisionsMemory?.decisions || [];
  const migrationByOldKey = new Map(
    plan.migrated.map(migration => [migration.oldKey, migration])
  );

  const newDecisions = sourceDecisions.map(decision => {
    const migration = migrationByOldKey.get(decision?.sku);
    return migration ? migration.newDecision : decision;
  });

  const newMemory = {
    ...(options.decisionsMemory || {}),
    updated_at: new Date().toISOString(),
    decisions: newDecisions,
  };

  if (options.filePath && options.fsModule) {
    options.fsModule.writeFileSync(
      options.filePath,
      `${JSON.stringify(newMemory, null, 2)}\n`,
      'utf8'
    );
  }

  return {
    dryRun: false,
    decisionsMemory: newMemory,
    summary,
  };
}

module.exports = {
  OwnerDecisionIdentityError,
  applyOwnerDecisionMigrationPlan,
  buildOwnerDecisionMigrationPlan,
  buildOwnerDecisionStableItemKey,
  isPlainIdentifierKey,
  isRowIdHashKey,
  isSupplierAwareKey,
  normalizeSupplier,
  normalizedIdentifier,
  normalizedText,
  ownerDecisionKeyCandidates,
  ownerDecisionKeyContext,
  supplierBarcodeKey,
  supplierFallbackKey,
  supplierSkuKey,
  uniqueOwnerDecisionKey,
};
