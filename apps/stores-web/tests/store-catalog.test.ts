import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogIndexable, displayPrice, displayStock, paginate, parseCatalogStore, searchProducts, validateCatalogSnapshot } from '../lib/store-catalog/core';
const now = Date.parse('2026-11-23T08:00:00Z');
const fixture = { schemaVersion:1, source:'1c-verified', store:'amper', published:true,
  exportedAt:'2026-11-23T07:00:00Z', verifiedAt:'2026-11-23T07:05:00Z', products:[
  { id:'test-1', name:'Тестовый провод', category:'Кабель', sku:'T-1', priceRub:15.5, priceVerifiedAt:'2026-11-23T07:05:00Z', stockQuantity:2.5, stockVerifiedAt:'2026-11-23T07:05:00Z' },
  { id:'test-2', name:'Тестовая лампа', category:'Свет', sku:'T-2' }
]};
test('store isolation, full-text lookup, and category filtering', () => {
  const data=validateCatalogSnapshot(fixture,'amper',now);
  assert.equal(data.products.length,2);
  assert.equal(catalogIndexable(data,now),true);
  assert.deepEqual(searchProducts(data.products,'t-1',''),[data.products[0]]);
  assert.deepEqual(searchProducts(data.products,'лампа','Свет'),[data.products[1]]);
  assert.deepEqual(searchProducts(data.products,'лампа','Кабель'),[]);
  assert.equal(parseCatalogStore('miska'),null);
  assert.throws(() => validateCatalogSnapshot(fixture,'ventil',now), /cross-store/);
});
test('stale prices/stock are never displayed', () => {
  const data=validateCatalogSnapshot(fixture,'amper',now);
  assert.equal(displayPrice(data.products[0],now),15.5);
  assert.equal(displayStock(data.products[0],now),2.5);
  assert.equal(displayPrice(data.products[1],now),null);
  assert.equal(displayStock(data.products[1],now),null);
  const later=now+96*3600000;
  assert.equal(displayPrice(data.products[0],later),null);
  assert.equal(displayStock(data.products[0],later),null);
  assert.equal(catalogIndexable(data,later),false);
});
test('invalid and unverified snapshots are rejected',() => {
  assert.throws(() => validateCatalogSnapshot({...fixture, published:false},'amper',now), /unpublished/);
  assert.throws(() => validateCatalogSnapshot({...fixture, source:'manual'},'amper',now), /Unverified/);
  assert.throws(() => validateCatalogSnapshot({...fixture, products:[fixture.products[0],fixture.products[0]]},'amper',now), /duplicate/);
  assert.throws(() => validateCatalogSnapshot({...fixture, products:[{...fixture.products[0],stockQuantity:-1}]},'amper',now), /Invalid stock/);
  assert.throws(() => validateCatalogSnapshot({...fixture, products:[{...fixture.products[0],priceVerifiedAt:undefined}]},'amper',now), /verification missing/);
  assert.throws(() => validateCatalogSnapshot({...fixture, products:[{...fixture.products[0],id:'../wrong'}]},'amper',now), /Invalid or duplicate/);
});
test('pagination caps list to 48 products',() => {
  const rows=Array.from({length:100},(_,i)=>({id:String(i),name:'Тест',category:'Тест'}));
  assert.equal(paginate(rows,1).rows.length,48);
  assert.equal(paginate(rows,3).rows.length,4);
  assert.equal(paginate(rows,300).page,3);
});
