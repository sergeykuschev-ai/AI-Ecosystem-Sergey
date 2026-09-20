'use strict';

/**
 * Read-only presentation enrichment for the review-triage endpoint.
 *
 * The compaction contract (agents/purchasing/review_triage) deliberately
 * carries only decision-level data (signals, evidence, questions). The UI
 * additionally needs per-SKU working numbers (stock, Min/Target/Max, sales,
 * recommended quantities) so the owner can actually decide. Those numbers
 * are resolved HERE, on the backend, from the FULL run artifacts
 * (items.json, manual-review.json, canonical matrix) — never from the
 * paginated /items endpoint the frontend uses for the table.
 *
 * Resolution rules (mirroring the audited upstream sources; NULL stays
 * NULL and is never coerced to zero):
 *   free_stock:            items.json stock.free_stock
 *                          → manual-review evidence.free_stock
 *   min/target/max:        canonical matrix (exact supplier_sku)
 *                          → items.json assortment_policy.*
 *                          → manual-review suggested_*
 *   sales:                 items.json sales.last_28_days
 *                          → manual-review evidence.average_weekly_sales
 *   recommended_qty:       items.json quantities.rollout_recommended_quantity
 *                          → manual-review rollout_recommended_quantity
 *   supplier_recommended_qty: manual-review evidence.supplier_recommended_qty
 *                             (single upstream source)
 *   provenance:            canonical rule_changed_by
 *
 * Everything is lookup-only: no quantities, thresholds, Min/Max or canonical
 * values are recalculated here.
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function display(value) {
  return value === null || value === undefined || value === '' ? null : value;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function indexBy(list, keyFn) {
  const map = new Map();
  for (const entry of asArray(list)) {
    const key = keyFn(entry);
    if (key && !map.has(key)) map.set(key, entry);
  }
  return map;
}

function buildLookup({ webItems, manualReviewItems, canonicalMatrix }) {
  return {
    webByRowId: indexBy(webItems, item => display(item?.row_id)),
    manualByRowId: indexBy(manualReviewItems, item => display(item?.rowIdentity)),
    canonicalByArticle: indexBy(
      Array.isArray(canonicalMatrix) ? canonicalMatrix : asArray(canonicalMatrix?.items),
      item => display(item?.supplier_sku)
    ),
  };
}

/**
 * Resolves the presentation numbers for one position. Unknown values stay
 * null; the frontend renders null as «нет данных».
 */
function resolvePosition(lookup, rowIdentity, article) {
  const web = lookup.webByRowId.get(rowIdentity) || null;
  const manual = lookup.manualByRowId.get(rowIdentity) || null;
  const canonical = (article && lookup.canonicalByArticle.get(article)) || null;
  const webStock = web?.stock && typeof web.stock === 'object' ? web.stock : {};
  const webPolicy = web?.assortment_policy && typeof web.assortment_policy === 'object'
    ? web.assortment_policy
    : {};
  const webQuantities = web?.quantities && typeof web.quantities === 'object'
    ? web.quantities
    : {};
  const webSales = web?.sales && typeof web.sales === 'object' ? web.sales : {};
  const manualEvidence = manual?.evidence && typeof manual.evidence === 'object'
    ? manual.evidence
    : {};

  return {
    row_identity: display(rowIdentity),
    article: display(article),
    sku_id: display(canonical?.sku_id),
    name: display(manual?.name) || display(web?.name),
    supplier: display(manual?.supplier) || display(web?.supplier),
    free_stock: firstDefined(webStock.free_stock, manualEvidence.free_stock),
    min_stock: firstDefined(
      canonical?.min_stock,
      webPolicy.min_stock,
      manual?.suggested_minimum_shelf_stock
    ),
    target_stock: firstDefined(
      canonical?.target_stock,
      webPolicy.target_stock,
      manual?.suggested_target_stock
    ),
    max_stock: firstDefined(
      canonical?.max_stock,
      webPolicy.max_stock,
      manual?.suggested_maximum_shelf_stock
    ),
    sales: firstDefined(webSales.last_28_days, manualEvidence.average_weekly_sales),
    recommended_qty: firstDefined(
      webQuantities.rollout_recommended_quantity,
      manual?.rollout_recommended_quantity
    ),
    supplier_recommended_qty: firstDefined(manualEvidence.supplier_recommended_qty),
    canonical_match: canonical !== null,
    provenance: display(canonical?.rule_changed_by),
  };
}

/**
 * Merges resolved presentation numbers into a compaction entry. Entry fields
 * win; resolved values only backfill entry nulls (e.g. sku_id from the
 * canonical matrix when the report had none). Nothing non-null is overwritten.
 */
function mergePosition(entry, resolved) {
  const out = { ...resolved, ...(entry || {}) };
  for (const key of Object.keys(resolved)) {
    if (out[key] === null || out[key] === undefined) {
      out[key] = resolved[key] ?? null;
    }
  }
  if (resolved.canonical_match === true) out.canonical_match = true;
  return out;
}

/**
 * Returns a NEW compaction object with presentation fields added:
 *   - every package gets a `members` array (resolved positions, sorted by
 *     article to stay order-independent);
 *   - every individual and every blocked entry gets the resolved position
 *     fields inline.
 * The input compaction is not mutated.
 */
function presentOwnerReviewCompaction(compaction, sources = {}) {
  if (!compaction || typeof compaction !== 'object') return compaction;
  const lookup = buildLookup({
    webItems: sources.webItems,
    manualReviewItems: sources.manualReviewItems,
    canonicalMatrix: sources.canonicalMatrix,
  });

  const packages = asArray(compaction.packages).map(pkg => {
    const articles = asArray(pkg.articles);
    const rowIdentities = asArray(pkg.row_identities);
    const skuIds = asArray(pkg.sku_ids);
    const members = articles
      .map((article, index) => mergePosition(
        // The compactor omits absent IDs. A sparse list is not positional;
        // fall back to the article lookup instead of assigning a neighbor's ID.
        { sku_id: skuIds.length === articles.length ? display(skuIds[index]) : null },
        resolvePosition(lookup, rowIdentities[index] || null, article)
      ))
      .sort((a, b) => (a.article || '').localeCompare(b.article || '', 'ru'));
    return { ...pkg, members };
  });

  const individuals = asArray(compaction.individuals).map(individual =>
    mergePosition(individual, resolvePosition(
      lookup,
      individual?.row_identity,
      individual?.article
    ))
  );

  const blocked = asArray(compaction.blocked).map(entry =>
    mergePosition(entry, resolvePosition(lookup, entry?.row_identity, entry?.article))
  );

  return { ...compaction, packages, individuals, blocked };
}

module.exports = {
  buildLookup,
  resolvePosition,
  mergePosition,
  presentOwnerReviewCompaction,
};
