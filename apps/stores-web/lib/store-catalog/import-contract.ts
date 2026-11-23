import {
  parseCatalogStore,
  validateCatalogSnapshot,
  type CatalogSnapshot,
  type CatalogStore,
} from './core';

// Warehouse references were observed in posted 1C sales data for separate shops;
// organization and retail price type must still be independently verified.
export const EXPECTED_1C_WAREHOUSES = {
  amper: 'f63946c3-04a3-11e7-80e5-d8cb8ae95d97',
  ventil: 'f63946c0-04a3-11e7-80e5-d8cb8ae95d97',
  'metiz-market': '831495d8-04de-11ee-b86a-7c8bca00854e',
} as const satisfies Record<CatalogStore, string>;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
const MAX_ITEMS = 50000;

type AnyRecord = Record<string, unknown>;

function record(value: unknown, name: string): AnyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid ' + name);
  }
  return value as AnyRecord;
}
function valueString(value: unknown, field: string, limit = 400): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new Error('Invalid ' + field);
  }
  return value.trim();
}
function optionalString(value: unknown, field: string, limit: number): string | undefined {
  return value == null ? undefined : valueString(value, field, limit);
}
function guid(value: unknown, field: string): string {
  const id = valueString(value, field, 36).toLowerCase();
  if (!GUID.test(id) || id === ZERO_GUID) throw new Error('Invalid ' + field);
  return id;
}
function verifiedTime(value: unknown, field: string, now: number): string {
  const t = valueString(value, field, 40);
  const ms = Date.parse(t);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(t) || !Number.isFinite(ms) ||
      ms > now + 300000 || now - ms > 30 * 86400000) {
    throw new Error('Invalid or outdated ' + field);
  }
  return t;
}
function money(value: unknown, field: string): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ||
      value > 100000000 || Math.abs(Math.round(value * 100) - value * 100) > 1e-6) {
    throw new Error('Invalid ' + field);
  }
  return value;
}
function quantity(value: unknown, field: string): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      value > 100000000) throw new Error('Invalid ' + field);
  return value;
}

export type CatalogImportResult = {
  snapshot: CatalogSnapshot;
  provenance: {
    store: CatalogStore;
    warehouseRef: string;
    organizationRef: string;
    retailPriceTypeRef: string;
    exportedAt: string;
    mappingReviewedAt: string;
    sourceMethod: '1c-current-free-stock-and-effective-retail-prices';
  };
};

/**
 * Strict adapter for a separately verified 1C export, not raw OData movements.
 *
 * The mapping is a separate reviewed document, intentionally not bundled in
 * source control. No current-price or free-stock inference from sale receipts.
 * This function does not access 1C, persist data or publish production.
 */
export function prepareVerifiedStoreImport(
  rawExport: unknown,
  rawApprovedMapping: unknown,
  now = Date.now(),
): CatalogImportResult {
  const mapping = record(rawApprovedMapping, 'approved mapping');
  const exportRow = record(rawExport, 'export');

  const name = valueString(mapping.store, 'mapping store', 40);
  const store = parseCatalogStore(name);
  if (!store) throw new Error('Unknown or excluded store');
  if (mapping.schemaVersion !== 1 ||
      mapping.approvalState !== 'verified-by-owner' ||
      mapping.currency !== 'RUB') throw new Error('Mapping approval missing');
  const warehouseRef = guid(mapping.warehouseRef, 'warehouse mapping');
  if (warehouseRef !== EXPECTED_1C_WAREHOUSES[store]) {
    throw new Error('Warehouse does not match verified 1C sales mapping');
  }
  const organizationRef = guid(mapping.organizationRef, 'organization mapping');
  const retailPriceTypeRef = guid(mapping.retailPriceTypeRef, 'retail price type mapping');
  const reviewedAt = verifiedTime(mapping.reviewedAt, 'mapping review time', now);
  valueString(mapping.reviewEvidence, 'review evidence', 600);
  if (now - Date.parse(reviewedAt) > 30 * 86400000) {
    throw new Error('Mapping review is expired');
  }
  if (exportRow.schemaVersion !== 1 ||
      exportRow.source !== '1c-ut-verified-store-export' ||
      exportRow.store !== store ||
      exportRow.currency !== 'RUB' ||
      exportRow.warehouseRef !== warehouseRef ||
      exportRow.organizationRef !== organizationRef ||
      exportRow.retailPriceTypeRef !== retailPriceTypeRef) {
    throw new Error('Source/mapping mismatch or cross-store input');
  }
  if (exportRow.completeness !== 'all-active-sellable-items' ||
      exportRow.stockMethod !== '1c-free-to-sell-current-balance' ||
      exportRow.priceMethod !== '1c-effective-retail-price-with-vat' ||
      exportRow.registerState !== 'reconciled') {
    throw new Error('Export lacks verified effective price and current free-stock semantics');
  }

  const exportedAt = verifiedTime(exportRow.exportedAt, 'export time', now);
  const pricesAsOf = verifiedTime(exportRow.pricesAsOf, 'price observation time', now);
  const stockAsOf = verifiedTime(exportRow.stockAsOf, 'stock observation time', now);
  if (now - Date.parse(exportedAt) > 24 * 3600000 ||
      now - Date.parse(stockAsOf) > 24 * 3600000 ||
      now - Date.parse(pricesAsOf) > 72 * 3600000 ||
      Date.parse(pricesAsOf) > Date.parse(exportedAt) + 300000 ||
      Date.parse(stockAsOf) > Date.parse(exportedAt) + 300000) {
    throw new Error('Export contains stale or inconsistent observations');
  }

  if (!Array.isArray(exportRow.products) ||
      exportRow.products.length < 1 || exportRow.products.length > MAX_ITEMS) {
    throw new Error('Invalid or empty 1C product listing');
  }

  const seen = new Set<string>();
  const products = exportRow.products.map((item, i) => {
    const p = record(item, '1C product #' + i);
    const ref = guid(p.refKey, 'product ref');
    if (seen.has(ref)) throw new Error('Duplicate 1C product ref');
    seen.add(ref);

    if (p.isFolder !== false || p.deletionMark !== false ||
        p.sellable !== true) throw new Error('Unsellable, deleted or folder entry in 1C export');
    if (p.warehouseRef !== warehouseRef ||
        p.organizationRef !== organizationRef ||
        p.retailPriceTypeRef !== retailPriceTypeRef) {
      throw new Error('Cross-store product mapping');
    }
    const priceRub = money(p.priceRub, 'product price');
    const stockQuantity = quantity(p.freeStockQuantity, 'product free stock');
    if (priceRub === undefined || stockQuantity === undefined) {
      throw new Error('Incomplete verified retail price/free stock');
    }
    return {
      id: ref,
      name: valueString(p.name, 'product name', 400),
      category: valueString(p.category, 'category', 200),
      sku: optionalString(p.sku, 'sku', 120),
      barcode: optionalString(p.barcode, 'barcode', 120),
      unit: optionalString(p.unit, 'unit', 60),
      description: optionalString(p.description, 'description', 10000),
      priceRub,
      priceVerifiedAt: pricesAsOf,
      stockQuantity,
      stockVerifiedAt: stockAsOf,
    };
  });

  const snapshot = validateCatalogSnapshot({
    schemaVersion: 1,
    source: '1c-verified',
    store,
    published: true,
    exportedAt,
    // Import validation is later than the raw source export and never in the future.
    verifiedAt: new Date(now).toISOString(),
    products,
  }, store, now);

  return {
    snapshot,
    provenance: {
      store, warehouseRef, organizationRef, retailPriceTypeRef,
      exportedAt, mappingReviewedAt: reviewedAt,
      sourceMethod: '1c-current-free-stock-and-effective-retail-prices',
    },
  };
}
