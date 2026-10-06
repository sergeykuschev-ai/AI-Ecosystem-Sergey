/* eslint-disable @typescript-eslint/no-require-imports -- Node regression test. */
const test=require('node:test'),assert=require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const {parcelForOrder,LogisticsDataError}=require('../src/commerce/logisticsDataset.ts')
const shipping={weightG:100,lengthMm:50,widthMm:40,heightMm:30}
test('single verified unit uses exact product-only measurements',()=>assert.deepEqual(parcelForOrder({lines:[{sku:'a',quantity:1}]},new Map([['a',shipping]])),shipping))
test('multi-item order is blocked until packaging dimensions exist',()=>assert.throws(()=>parcelForOrder({lines:[{sku:'a',quantity:2}]},new Map([['a',shipping]])),e=>e instanceof LogisticsDataError&&e.code==='LOGISTICS_MULTI_ITEM_UNSUPPORTED'))
test('unverified sku blocks parcel',()=>assert.throws(()=>parcelForOrder({lines:[{sku:'a',quantity:1}]},new Map()),e=>e instanceof LogisticsDataError&&e.code==='LOGISTICS_SKU_NOT_VERIFIED'))
