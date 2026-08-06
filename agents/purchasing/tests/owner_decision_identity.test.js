'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OwnerDecisionIdentityError,
  buildOwnerDecisionStableItemKey,
  isSupplierAwareKey,
  ownerDecisionKeyCandidates,
  ownerDecisionKeyContext,
  uniqueOwnerDecisionKey,
} = require('../services/owner_decision_identity');

function product(overrides = {}) {
  return {
    supplier: 'Основной поставщик',
    sku: 'ART-001',
    barcode: '460000000001',
    brand: 'Миска',
    name: 'Корм для кошек',
    ...overrides,
  };
}

test('canonical key is supplier identity plus normalized supplier SKU', () => {
  const item = product();
  const key = uniqueOwnerDecisionKey(item, ownerDecisionKeyContext([item]));

  assert.equal(key, 'SUPPLIER:ОСНОВНОЙ ПОСТАВЩИК:SKU:ART-001');
  assert.equal(isSupplierAwareKey(key), true);
});

test('same supplier and SKU keep the same key across different file hashes', () => {
  const context = ownerDecisionKeyContext([
    product({ fileHash: 'hash-a', rowNumber: 5 }),
  ]);

  assert.equal(
    uniqueOwnerDecisionKey(product({ fileHash: 'hash-b', rowNumber: 12 }), context),
    'SUPPLIER:ОСНОВНОЙ ПОСТАВЩИК:SKU:ART-001'
  );
});

test('same supplier and SKU keep the same key when row order changes', () => {
  const items = [
    product({ sku: 'ART-001', rowNumber: 1 }),
    product({ sku: 'ART-002', rowNumber: 2 }),
  ];
  const reversed = [...items].reverse();

  assert.equal(
    uniqueOwnerDecisionKey(items[0], ownerDecisionKeyContext(items)),
    uniqueOwnerDecisionKey(reversed[1], ownerDecisionKeyContext(reversed))
  );
});

test('same supplier and SKU keep the same key when stock or sales change', () => {
  const before = product({ stock: 10, sales28: 5 });
  const after = product({ stock: 3, sales28: 15 });
  const context = ownerDecisionKeyContext([before, after]);

  assert.equal(
    uniqueOwnerDecisionKey(before, context),
    uniqueOwnerDecisionKey(after, context)
  );
});

test('adding new SKUs does not change existing canonical keys', () => {
  const original = [
    product({ sku: 'ART-001' }),
    product({ sku: 'ART-002' }),
  ];
  const expanded = [
    ...original,
    product({ sku: 'ART-003' }),
  ];

  assert.equal(
    uniqueOwnerDecisionKey(original[0], ownerDecisionKeyContext(original)),
    uniqueOwnerDecisionKey(expanded[0], ownerDecisionKeyContext(expanded))
  );
  assert.equal(
    uniqueOwnerDecisionKey(original[1], ownerDecisionKeyContext(original)),
    uniqueOwnerDecisionKey(expanded[1], ownerDecisionKeyContext(expanded))
  );
});

test('identical SKU at different suppliers does not mix', () => {
  const first = product({ supplier: 'Поставщик А', sku: 'SHARED-001' });
  const second = product({ supplier: 'Поставщик Б', sku: 'SHARED-001' });
  const context = ownerDecisionKeyContext([first, second]);

  assert.equal(
    uniqueOwnerDecisionKey(first, context),
    'SUPPLIER:ПОСТАВЩИК А:SKU:SHARED-001'
  );
  assert.equal(
    uniqueOwnerDecisionKey(second, context),
    'SUPPLIER:ПОСТАВЩИК Б:SKU:SHARED-001'
  );
});

test('legacy plain SKU is still a candidate for backward compatibility', () => {
  const item = product();
  const candidates = ownerDecisionKeyCandidates(item);

  assert.ok(candidates.includes('ART-001'));
});

test('legacy plain barcode is still a candidate for backward compatibility', () => {
  const item = product({ sku: null });
  const candidates = ownerDecisionKeyCandidates(item);

  assert.ok(candidates.includes('460000000001'));
});

test('SKU without article falls back to supplier + brand + name', () => {
  const item = product({ sku: null, barcode: null });
  const context = ownerDecisionKeyContext([item]);

  assert.equal(
    uniqueOwnerDecisionKey(item, context),
    'SUPPLIER:ОСНОВНОЙ ПОСТАВЩИК:FALLBACK:МИСКА|КОРМ ДЛЯ КОШЕК'
  );
});

test('fallback key never contains row number or file hash', () => {
  const item = product({
    sku: null,
    barcode: null,
    rowNumber: 42,
    fileHash: 'deadbeef',
  });
  const key = uniqueOwnerDecisionKey(item, ownerDecisionKeyContext([item]));

  assert.equal(key.includes('42'), false);
  assert.equal(key.includes('deadbeef'), false);
  assert.equal(key.includes('hash'), false);
});

test('duplicate SKU within the same supplier falls back to barcode', () => {
  const items = [
    product({ sku: 'DUPE-001', barcode: '460000000001' }),
    product({ sku: 'DUPE-001', barcode: '460000000002' }),
  ];
  const context = ownerDecisionKeyContext(items);

  assert.equal(
    uniqueOwnerDecisionKey(items[0], context),
    'SUPPLIER:ОСНОВНОЙ ПОСТАВЩИК:BARCODE:460000000001'
  );
  assert.equal(
    uniqueOwnerDecisionKey(items[1], context),
    'SUPPLIER:ОСНОВНОЙ ПОСТАВЩИК:BARCODE:460000000002'
  );
});

test('duplicate SKU and barcode within the same supplier falls back to brand + name', () => {
  const items = [
    product({ sku: 'DUPE-001', barcode: '460000000001', name: 'Красный' }),
    product({ sku: 'DUPE-001', barcode: '460000000001', name: 'Синий' }),
  ];
  const context = ownerDecisionKeyContext(items);

  assert.equal(
    uniqueOwnerDecisionKey(items[0], context),
    'SUPPLIER:ОСНОВНОЙ ПОСТАВЩИК:FALLBACK:МИСКА|КРАСНЫЙ'
  );
  assert.equal(
    uniqueOwnerDecisionKey(items[1], context),
    'SUPPLIER:ОСНОВНОЙ ПОСТАВЩИК:FALLBACK:МИСКА|СИНИЙ'
  );
});

test('completely ambiguous items have no unique key', () => {
  const items = [
    product({ sku: null, barcode: null, name: 'Товар' }),
    product({ sku: null, barcode: null, name: 'Товар' }),
  ];
  const context = ownerDecisionKeyContext(items);

  assert.equal(uniqueOwnerDecisionKey(items[0], context), null);
  assert.equal(uniqueOwnerDecisionKey(items[1], context), null);
});

test('buildOwnerDecisionStableItemKey throws for ambiguous items', () => {
  const items = [
    product({ sku: null, barcode: null, name: 'Товар' }),
    product({ sku: null, barcode: null, name: 'Товар' }),
  ];

  assert.throws(
    () => buildOwnerDecisionStableItemKey(items[0], ownerDecisionKeyContext(items)),
    error =>
      error instanceof OwnerDecisionIdentityError &&
      error.code === 'AMBIGUOUS_ITEM_IDENTITY'
  );
});

test('supplier normalization collapses whitespace and ignores case', () => {
  const item = product({ supplier: '  ОСНОВНОЙ   ПОСТАВЩИК  ' });
  const key = uniqueOwnerDecisionKey(item, ownerDecisionKeyContext([item]));

  assert.equal(key, 'SUPPLIER:ОСНОВНОЙ ПОСТАВЩИК:SKU:ART-001');
});
