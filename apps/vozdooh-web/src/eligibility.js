'use strict';

/**
 * Eligibility rules for the Task 8 logistics dataset.
 *
 * The eligible source set is re-derived from the staged 1C snapshot on every
 * build and is never hard-coded: only customer-eligible SKUs with positive
 * stock count. Excluded rows are reported with an explicit reason so the
 * derivation stays auditable.
 */

/**
 * @typedef {object} SnapshotRow
 * @property {string} sku Stock-keeping unit identifier. Required, non-empty.
 * @property {string} name Product name as exported from 1C. Required, non-empty.
 * @property {number} stock_qty Current stock quantity. Required, finite number.
 * @property {boolean} customer_eligible true when the SKU may be sold to customers.
 * @property {string} [brand] Brand name, when present in the export.
 */

/**
 * @typedef {object} EligibleSku
 * @property {string} sku
 * @property {string} name
 * @property {string} [brand]
 */

/**
 * @typedef {object} ExcludedRow
 * @property {number} index Row index in the snapshot array.
 * @property {string} [sku]
 * @property {string} reason One of NOT_CUSTOMER_ELIGIBLE | OUT_OF_STOCK | INVALID_ROW.
 * @property {string} [detail]
 */

/**
 * @typedef {object} EligibilityResult
 * @property {EligibleSku[]} eligible
 * @property {ExcludedRow[]} excluded
 * @property {number} total_rows
 */

const EXCLUSION_REASONS = Object.freeze({
  NOT_CUSTOMER_ELIGIBLE: 'NOT_CUSTOMER_ELIGIBLE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  INVALID_ROW: 'INVALID_ROW',
});

/**
 * Validate one raw snapshot row and return either a typed row or an exclusion.
 * @param {unknown} raw
 * @param {number} index
 * @returns {{ row: SnapshotRow } | { exclusion: ExcludedRow }}
 */
function parseRow(raw, index) {
  if (typeof raw !== 'object' || raw === null) {
    return {
      exclusion: { index, reason: EXCLUSION_REASONS.INVALID_ROW, detail: 'row is not an object' },
    };
  }
  const record = /** @type {Record<string, unknown>} */ (raw);
  const sku = record.sku;
  const name = record.name;
  const stockQty = record.stock_qty;
  const customerEligible = record.customer_eligible;
  const brand = record.brand;

  if (typeof sku !== 'string' || sku.trim() === '') {
    return {
      exclusion: { index, reason: EXCLUSION_REASONS.INVALID_ROW, detail: 'missing or empty sku' },
    };
  }
  if (typeof name !== 'string' || name.trim() === '') {
    return {
      exclusion: { index, sku: sku.trim(), reason: EXCLUSION_REASONS.INVALID_ROW, detail: 'missing or empty name' },
    };
  }
  if (typeof stockQty !== 'number' || !Number.isFinite(stockQty)) {
    return {
      exclusion: {
        index,
        sku: sku.trim(),
        reason: EXCLUSION_REASONS.INVALID_ROW,
        detail: 'stock_qty must be a finite number',
      },
    };
  }
  if (typeof customerEligible !== 'boolean') {
    return {
      exclusion: {
        index,
        sku: sku.trim(),
        reason: EXCLUSION_REASONS.INVALID_ROW,
        detail: 'customer_eligible must be a boolean',
      },
    };
  }

  /** @type {SnapshotRow} */
  const row = {
    sku: sku.trim(),
    name: name.trim(),
    stock_qty: stockQty,
    customer_eligible: customerEligible,
  };
  if (typeof brand === 'string' && brand.trim() !== '') {
    row.brand = brand.trim();
  }
  return { row };
}

/**
 * Derive the customer-eligible positive-stock SKU set from a 1C snapshot.
 * @param {unknown} snapshotRows Raw parsed snapshot rows.
 * @returns {EligibilityResult}
 */
function deriveEligibility(snapshotRows) {
  if (!Array.isArray(snapshotRows)) {
    throw new Error('1C snapshot must be an array of rows');
  }

  /** @type {EligibleSku[]} */
  const eligible = [];
  /** @type {ExcludedRow[]} */
  const excluded = [];

  snapshotRows.forEach((raw, index) => {
    const parsed = parseRow(raw, index);
    if ('exclusion' in parsed) {
      excluded.push(parsed.exclusion);
      return;
    }
    const row = parsed.row;
    if (!row.customer_eligible) {
      excluded.push({ index, sku: row.sku, reason: EXCLUSION_REASONS.NOT_CUSTOMER_ELIGIBLE });
      return;
    }
    if (row.stock_qty <= 0) {
      excluded.push({ index, sku: row.sku, reason: EXCLUSION_REASONS.OUT_OF_STOCK });
      return;
    }
    /** @type {EligibleSku} */
    const entry = { sku: row.sku, name: row.name };
    if (row.brand !== undefined) {
      entry.brand = row.brand;
    }
    eligible.push(entry);
  });

  eligible.sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));

  return { eligible, excluded, total_rows: snapshotRows.length };
}

module.exports = {
  deriveEligibility,
  EXCLUSION_REASONS,
};
