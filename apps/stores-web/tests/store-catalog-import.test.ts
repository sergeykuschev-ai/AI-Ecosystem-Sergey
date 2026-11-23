import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPECTED_1C_WAREHOUSES,
  prepareVerifiedStoreImport,
} from '../lib/store-catalog/import-contract';
import { displayPrice, displayStock, validateCatalogSnapshot } from '../lib/store-catalog/core';

const now = Date.parse('2026-11-23T08:00:00Z');
const orgRef = '12345678-1234-1234-1234-123456789012';
const priceRef = '87654321-1234-1234-1234-123456789012';
const productRef = 'abcdef12-3456-7890-1234-567890abcdef';
const mapping = {
  schemaVersion: 1, approvalState: 'verified-by-owner',
  store: 'amper', currency: 'RUB',
  warehouseRef: EXPECTED_1C_WAREHOUSES.amper,
  organizationRef: orgRef, retailPriceTypeRef: priceRef,
  reviewedAt: '2026-11-23T07:00:00Z',
  reviewEvidence: 'TEST FIXTURE ONLY: no real catalog mapping or authorization',
};
const row = {
  refKey: productRef, isFolder: false, deletionMark: false, sellable: true,
  warehouseRef: EXPECTED_1C_WAREHOUSES.amper,
  organizationRef: orgRef, retailPriceTypeRef: priceRef,
  name: 'ТЕСТ — кабель', category: 'Тестовая электрика', sku: 'T-1',
  priceRub: 25.99, freeStockQuantity: 3,
};
const source = {
  schemaVersion: 1, source: '1c-ut-verified-store-export',
  store: 'amper', currency: 'RUB',
  warehouseRef: EXPECTED_1C_WAREHOUSES.amper,
  organizationRef: orgRef, retailPriceTypeRef: priceRef,
  completeness: 'all-active-sellable-items',
  stockMethod: '1c-free-to-sell-current-balance',
  priceMethod: '1c-effective-retail-price-with-vat',
  registerState: 'reconciled',
  exportedAt: '2026-11-23T07:10:00Z',
  pricesAsOf: '2026-11-23T07:09:00Z',
  stockAsOf: '2026-11-23T07:09:00Z',
  products: [row],
};
const productCase = (patch: Record<string, unknown>) => ({
  ...source, products: [{ ...row, ...patch }],
});

test('converts explicit approved single-store current 1C export to a validated catalog', () => {
  const { snapshot, provenance } = prepareVerifiedStoreImport(source, mapping, now);
  assert.equal(snapshot.products.length, 1);
  assert.equal(snapshot.products[0].id, productRef);
  assert.equal(snapshot.store, 'amper');
  assert.equal(snapshot.products[0].priceRub, 25.99);
  assert.equal(displayPrice(snapshot.products[0], now), 25.99);
  assert.equal(displayStock(snapshot.products[0], now), 3);
  assert.equal(provenance.warehouseRef, EXPECTED_1C_WAREHOUSES.amper);
  assert.equal(validateCatalogSnapshot(snapshot, 'amper', now).products.length, 1);
});

test('refuses wrong store, Miska, warehouse, organization and price types', () => {
  assert.throws(() => prepareVerifiedStoreImport({ ...source, store: 'miska' }, mapping, now), /mismatch/);
  assert.throws(() => prepareVerifiedStoreImport(source, { ...mapping, store: 'miska' }, now), /excluded/);
  assert.throws(() => prepareVerifiedStoreImport(source, { ...mapping, warehouseRef: EXPECTED_1C_WAREHOUSES.ventil }, now), /Warehouse/);
  assert.throws(() => prepareVerifiedStoreImport({ ...source, organizationRef: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, mapping, now), /mismatch/);
  assert.throws(() => prepareVerifiedStoreImport(productCase({ warehouseRef: EXPECTED_1C_WAREHOUSES.ventil }), mapping, now), /Cross-store/);
  assert.throws(() => prepareVerifiedStoreImport(productCase({ retailPriceTypeRef: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }), mapping, now), /Cross-store/);
});

test('requires independently approved and recent warehouse/price mapping', () => {
  assert.throws(() => prepareVerifiedStoreImport(source, { ...mapping, approvalState: 'pending' }, now), /approval/);
  assert.throws(() => prepareVerifiedStoreImport(source, { ...mapping, retailPriceTypeRef: undefined }, now), /Invalid/);
  assert.throws(() => prepareVerifiedStoreImport(source, { ...mapping, organizationRef: undefined }, now), /Invalid/);
  assert.throws(() => prepareVerifiedStoreImport(source, { ...mapping, reviewEvidence: '' }, now), /Invalid/);
  assert.throws(() => prepareVerifiedStoreImport(source, { ...mapping, reviewedAt: '2026-09-01T07:00:00Z' }, now), /outdated/);
});

test('refuses raw movements, historical prices and guessed balances', () => {
  assert.throws(() => prepareVerifiedStoreImport({ ...source, stockMethod: '1c-movement-rows' }, mapping, now), /current free-stock/);
  assert.throws(() => prepareVerifiedStoreImport({ ...source, priceMethod: 'last-sale-price' }, mapping, now), /effective price/);
  assert.throws(() => prepareVerifiedStoreImport({ ...source, registerState: 'partial' }, mapping, now), /semantics/);
  assert.throws(() => prepareVerifiedStoreImport({ ...source, stockAsOf: '2026-11-20T08:00:00Z' }, mapping, now), /stale/);
  assert.throws(() => prepareVerifiedStoreImport({ ...source, currency: 'USD' }, mapping, now), /mismatch/);
});

test('rejects folder, deleted, non-sellable, duplicate and invalid product records', () => {
  assert.throws(() => prepareVerifiedStoreImport(productCase({ isFolder: true }), mapping, now), /Unsellable/);
  assert.throws(() => prepareVerifiedStoreImport(productCase({ deletionMark: true }), mapping, now), /Unsellable/);
  assert.throws(() => prepareVerifiedStoreImport(productCase({ sellable: false }), mapping, now), /Unsellable/);
  assert.throws(() => prepareVerifiedStoreImport({ ...source, products: [row, row] }, mapping, now), /Duplicate/);
  assert.throws(() => prepareVerifiedStoreImport(productCase({ priceRub: 0 }), mapping, now), /Invalid product price/);
  assert.throws(() => prepareVerifiedStoreImport(productCase({ priceRub: 15.159 }), mapping, now), /Invalid product price/);
  assert.throws(() => prepareVerifiedStoreImport(productCase({ freeStockQuantity: -1 }), mapping, now), /Invalid product free stock/);
  assert.throws(() => prepareVerifiedStoreImport(productCase({ refKey: '../miska' }), mapping, now), /Invalid product ref/);
  assert.throws(() => prepareVerifiedStoreImport({ ...source, products: [] }, mapping, now), /empty/);
});
