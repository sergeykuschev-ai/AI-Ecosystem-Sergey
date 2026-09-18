'use strict';

const {
  loadOwnerDecisions,
  latestActiveDecisions,
  effectiveExpiresAt,
} = require('../matrix_builder/owner_decisions');
const {
  normalizedText,
  supplierSkuKey,
} = require('./owner_decision_identity');
const { canonicalSupplierName } = require('./demand_engine');

const ACTIVE_ORDER_DECISIONS = new Set(['BUY', 'SKIP', 'DEFER']);

function normalizeArticle(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
}

function exactOrderSku(product) {
  const article = normalizeArticle(product?.article);
  if (article) return { sku: article, source: 'article' };
  const canonicalSupplierSku = normalizeArticle(
    product?.assortmentPolicy?.matched === true
      ? product?.assortmentPolicy?.canonical?.supplier_sku
      : null
  );
  return canonicalSupplierSku
    ? { sku: canonicalSupplierSku, source: 'canonical_supplier_sku' }
    : null;
}

function exactIdentity(product) {
  const resolved = exactOrderSku(product);
  if (!resolved) return null;
  return `${canonicalSupplierName(product?.supplier)}|${resolved.sku}`;
}

function exactNameIdentity(product) {
  const name = normalizedText(product?.name);
  if (!name) return null;
  return `${canonicalSupplierName(product?.supplier)}|${name}`;
}

function fallbackDecisionNameIdentity(key) {
  if (typeof key !== 'string') return null;
  const marker = ':FALLBACK:';
  const markerIndex = key.indexOf(marker);
  if (markerIndex < 0) return null;
  const supplierPart = key.slice(0, markerIndex);
  if (!supplierPart.startsWith('SUPPLIER:')) return null;
  const fallbackPart = key.slice(markerIndex + marker.length);
  const pipeIndex = fallbackPart.indexOf('|');
  if (pipeIndex < 0) return null;
  const name = normalizedText(fallbackPart.slice(pipeIndex + 1));
  if (!name) return null;
  const supplier = supplierPart.slice('SUPPLIER:'.length);
  return `${canonicalSupplierName(supplier)}|${name}`;
}

function supplierAwareDecisionParts(key) {
  if (typeof key !== 'string' || !key.startsWith('SUPPLIER:')) return null;
  const match = key.match(/^SUPPLIER:(.*?):(SKU|BARCODE|FALLBACK):(.*)$/);
  if (!match) return null;
  return {
    supplier: match[1],
    type: match[2],
    value: match[3],
  };
}

function canonicalSkuDecisionIdentity(key) {
  const parts = supplierAwareDecisionParts(key);
  if (!parts || parts.type !== 'SKU') return null;
  const sku = normalizeArticle(parts.value);
  return sku ? `${canonicalSupplierName(parts.supplier)}|${sku}` : null;
}

function newerDecision(left, right) {
  if (!left) return right;
  return String(right.ownerDecision.decided_at || '') > String(left.ownerDecision.decided_at || '')
    ? right
    : left;
}

function validActiveOrderDecision(ownerDecision) {
  if (!ownerDecision || !ACTIVE_ORDER_DECISIONS.has(ownerDecision.owner_decision)) return false;
  if (ownerDecision.owner_decision === 'BUY') {
    return Number.isInteger(ownerDecision.owner_order_quantity) && ownerDecision.owner_order_quantity > 0;
  }
  return true;
}

function resolvedOwnerDecision(key, ownerDecision, identitySource) {
  return {
    key,
    ownerDecision: ownerDecision.owner_decision,
    quantity: ownerDecision.owner_order_quantity,
    decidedAt: ownerDecision.decided_at,
    expiresAt: effectiveExpiresAt(ownerDecision),
    decidedBy: ownerDecision.decided_by,
    reasonCode: ownerDecision.reason_code,
    identitySource,
  };
}

function resolveActiveOwnerOrderDecisions(products = [], options = {}) {
  if (!options.ownerDecisionsPath) {
    return { byRowIdentity: new Map(), summary: { loaded: 0, applied: 0 } };
  }
  const loaded = loadOwnerDecisions(options.ownerDecisionsPath, { allowMissing: true });
  const latest = latestActiveDecisions(loaded.store.decisions, { now: options.now });
  const exactByCanonical = new Map();
  for (const [key, ownerDecision] of latest.entries()) {
    if (!validActiveOrderDecision(ownerDecision)) continue;
    const identity = canonicalSkuDecisionIdentity(key);
    if (!identity) continue;
    const candidate = { key, ownerDecision };
    exactByCanonical.set(identity, newerDecision(exactByCanonical.get(identity), candidate));
  }
  const counts = new Map();
  const nameCounts = new Map();
  for (const product of products) {
    const identity = exactIdentity(product);
    if (identity) counts.set(identity, (counts.get(identity) || 0) + 1);
    const nameIdentity = exactNameIdentity(product);
    if (nameIdentity) nameCounts.set(nameIdentity, (nameCounts.get(nameIdentity) || 0) + 1);
  }

  const fallbackByName = new Map();
  const fallbackConflicts = new Set();
  for (const [key, ownerDecision] of latest.entries()) {
    if (!validActiveOrderDecision(ownerDecision)) continue;
    const nameIdentity = fallbackDecisionNameIdentity(key);
    if (!nameIdentity) continue;
    if (fallbackByName.has(nameIdentity)) {
      const existing = fallbackByName.get(nameIdentity);
      const equivalent = existing.ownerDecision.owner_decision === ownerDecision.owner_decision &&
        existing.ownerDecision.owner_order_quantity === ownerDecision.owner_order_quantity;
      if (!equivalent) {
        fallbackConflicts.add(nameIdentity);
        fallbackByName.delete(nameIdentity);
        continue;
      }
      fallbackByName.set(nameIdentity, newerDecision(existing, { key, ownerDecision }));
      continue;
    }
    if (!fallbackConflicts.has(nameIdentity)) {
      fallbackByName.set(nameIdentity, { key, ownerDecision });
    }
  }

  const byRowIdentity = new Map();
  for (const product of products) {
    const identity = exactIdentity(product);
    if (identity && counts.get(identity) === 1) {
      const resolvedSku = exactOrderSku(product);
      const canonicalMatch = exactByCanonical.get(identity) || null;
      const legacyKey = resolvedSku ? supplierSkuKey(product.supplier, resolvedSku.sku) : null;
      const key = canonicalMatch?.key || legacyKey;
      const ownerDecision = canonicalMatch?.ownerDecision || (legacyKey ? latest.get(legacyKey) : null);
      if (validActiveOrderDecision(ownerDecision)) {
        byRowIdentity.set(
          product.rowIdentity,
          resolvedOwnerDecision(key, ownerDecision, resolvedSku.source)
        );
        continue;
      }
    }

    const nameIdentity = exactNameIdentity(product);
    const exact = exactIdentity(product);
    if (exact && counts.get(exact) !== 1) continue;
    if (!nameIdentity || nameCounts.get(nameIdentity) !== 1 || fallbackConflicts.has(nameIdentity)) continue;
    const fallback = fallbackByName.get(nameIdentity);
    if (!fallback) continue;
    byRowIdentity.set(
      product.rowIdentity,
      resolvedOwnerDecision(fallback.key, fallback.ownerDecision, 'supplier_product_name')
    );
  }
  return {
    byRowIdentity,
    summary: {
      loaded: latest.size,
      applied: byRowIdentity.size,
    },
  };
}

function applyActiveOwnerOrderDecision(product, decision, resolved) {
  if (!resolved) return { product, decision };
  const marker = { ...resolved, applied: true };
  const nextProduct = { ...product, activeOwnerOrderDecision: marker };
  const reason = `active_owner_order_decision:${resolved.ownerDecision}`;
  if (resolved.ownerDecision === 'BUY') {
    return {
      product: nextProduct,
      decision: {
        ...decision,
        decision: 'must_buy',
        approvedOrderQuantity: resolved.quantity,
        decisionBasis: 'active_owner_order_decision',
        reasons: [reason, ...decision.reasons.filter(value => value !== reason)],
      },
    };
  }
  if (resolved.ownerDecision === 'DEFER') {
    return {
      product: nextProduct,
      decision: {
        ...decision,
        decision: 'postpone',
        approvedOrderQuantity: 0,
        decisionBasis: 'active_owner_order_decision',
        reasons: [reason, ...decision.reasons.filter(value => value !== reason)],
      },
    };
  }
  return {
    product: nextProduct,
    decision: {
      ...decision,
      decision: 'do_not_buy',
      approvedOrderQuantity: 0,
      decisionBasis: 'active_owner_order_decision',
      reasons: [reason, ...decision.reasons.filter(value => value !== reason)],
    },
  };
}

module.exports = {
  ACTIVE_ORDER_DECISIONS,
  resolveActiveOwnerOrderDecisions,
  applyActiveOwnerOrderDecision,
};
