export const CATALOG_STORES = {
  amper: { name: 'Ампер', home: '/amper/' },
  ventil: { name: 'Вентиль', home: '/ventil/' },
  'metiz-market': { name: 'Метиз Маркет', home: '/metiz-market/' },
} as const;
export type CatalogStore = keyof typeof CATALOG_STORES;
export type CatalogProduct = {
  id: string; name: string; category: string; sku?: string; barcode?: string;
  unit?: string; description?: string; priceRub?: number; priceVerifiedAt?: string;
  stockQuantity?: number; stockVerifiedAt?: string;
};
export type CatalogSnapshot = {
  schemaVersion: 1; store: CatalogStore; source: '1c-verified'; published: true;
  exportedAt: string; verifiedAt: string; products: CatalogProduct[];
};
const FIVE_MIN = 5 * 60 * 1000;
function record(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('Not an object');
  return x as Record<string, unknown>;
}
function text(x: unknown, name: string, max = 500): string {
  if (typeof x !== 'string' || !x.trim() || x.length > max) throw new Error('Invalid ' + name);
  return x.trim();
}
function optionalText(x: unknown, name: string, max = 500): string | undefined {
  if (x === undefined || x === null) return undefined;
  return text(x, name, max);
}
function time(x: unknown, name: string, now: number): string {
  const value = text(x, name, 40);
  const date = Date.parse(value);
  if (!Number.isFinite(date) || date > now + FIVE_MIN || !/(Z|[+-]\d\d:\d\d)$/.test(value)) throw new Error('Invalid ' + name);
  return value;
}
function optionalTime(x: unknown, name: string, now: number): string | undefined {
  return x === undefined || x === null ? undefined : time(x, name, now);
}
function quantity(x: unknown, name: string): number | undefined {
  if (x === undefined || x === null) return undefined;
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) throw new Error('Invalid ' + name);
  return x;
}
export function parseCatalogStore(value: string): CatalogStore | null {
  return Object.hasOwn(CATALOG_STORES, value) ? value as CatalogStore : null;
}
export function validateCatalogSnapshot(raw: unknown, store: CatalogStore, now = Date.now()): CatalogSnapshot {
  const source = record(raw);
  if (source.schemaVersion !== 1 || source.source !== '1c-verified' || source.store !== store || source.published !== true) {
    throw new Error('Unverified, cross-store, or unpublished snapshot');
  }
  const exportedAt = time(source.exportedAt, 'exportedAt', now);
  const verifiedAt = time(source.verifiedAt, 'verifiedAt', now);
  if (Date.parse(verifiedAt) < Date.parse(exportedAt)) throw new Error('Verification predates export');
  if (!Array.isArray(source.products) || source.products.length > 50000) throw new Error('Invalid products');
  const seen = new Set<string>();
  const products = source.products.map((value, index): CatalogProduct => {
    const row = record(value);
    const id = text(row.id, 'product ID', 120);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || seen.has(id)) throw new Error('Invalid or duplicate ID at ' + index);
    seen.add(id);
    const priceRub = quantity(row.priceRub, 'price');
    const stockQuantity = quantity(row.stockQuantity, 'stock');
    const priceVerifiedAt = optionalTime(row.priceVerifiedAt, 'price verification', now);
    const stockVerifiedAt = optionalTime(row.stockVerifiedAt, 'stock verification', now);
    if (priceRub !== undefined && !priceVerifiedAt) throw new Error('Price verification missing');
    if (stockQuantity !== undefined && !stockVerifiedAt) throw new Error('Stock verification missing');
    return {
      id, name: text(row.name, 'name', 400), category: text(row.category, 'category', 200),
      sku: optionalText(row.sku, 'sku', 120), barcode: optionalText(row.barcode, 'barcode', 120),
      unit: optionalText(row.unit, 'unit', 60), description: optionalText(row.description, 'description', 10000),
      priceRub, priceVerifiedAt, stockQuantity, stockVerifiedAt,
    };
  });
  return { schemaVersion: 1, source: '1c-verified', store, published: true, exportedAt, verifiedAt, products };
}
export function fresh(timestamp: string | undefined, hours: number, now = Date.now()): boolean {
  if (!timestamp) return false;
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -FIVE_MIN && age <= hours * 3600000;
}
export function catalogIndexable(catalog: CatalogSnapshot | null, now = Date.now()): boolean {
  return Boolean(catalog && catalog.products.length && fresh(catalog.verifiedAt, 48, now));
}
export function displayPrice(p: CatalogProduct, now = Date.now()): number | null {
  return p.priceRub !== undefined && p.priceRub > 0 && fresh(p.priceVerifiedAt, 72, now) ? p.priceRub : null;
}
export function displayStock(p: CatalogProduct, now = Date.now()): number | null {
  return p.stockQuantity !== undefined && fresh(p.stockVerifiedAt, 24, now) ? p.stockQuantity : null;
}
export function searchProducts(rows: CatalogProduct[], q: string, category: string): CatalogProduct[] {
  const needle = q.normalize('NFKC').toLocaleLowerCase('ru').trim().slice(0, 100);
  return rows.filter(p => (!category || p.category === category) && (!needle || [p.name, p.sku, p.barcode, p.category]
    .filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase('ru').includes(needle)));
}
export function paginate(rows: CatalogProduct[], rawPage: number) {
  const pages = Math.max(1, Math.ceil(rows.length / 48));
  const page = Number.isSafeInteger(rawPage) ? Math.max(1, Math.min(pages, rawPage)) : 1;
  return { page, pages, rows: rows.slice((page - 1) * 48, page * 48) };
}
