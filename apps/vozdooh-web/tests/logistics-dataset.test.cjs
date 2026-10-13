/* eslint-disable @typescript-eslint/no-require-imports -- Node regression test. */
const test=require('node:test'),assert=require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const {parcelForOrder,LogisticsDataError}=require('../src/commerce/logisticsDataset.ts')
const shipping={weightG:100,lengthMm:50,widthMm:40,heightMm:30}
test('single verified unit uses exact product-only measurements',()=>assert.deepEqual(parcelForOrder({lines:[{sku:'a',quantity:1}]},new Map([['a',shipping]])),shipping))
test('multi-item order is blocked until packaging dimensions exist',()=>assert.throws(()=>parcelForOrder({lines:[{sku:'a',quantity:2}]},new Map([['a',shipping]])),e=>e instanceof LogisticsDataError&&e.code==='PACKING_VERIFIED_CARTON_MISSING'))
test('unverified sku blocks parcel',()=>assert.throws(()=>parcelForOrder({lines:[{sku:'a',quantity:1}]},new Map()),e=>e instanceof LogisticsDataError&&e.code==='LOGISTICS_SKU_NOT_VERIFIED'))

test('four evidence-review candidates stay excluded from paid delivery calculation',()=>{
  const fs=require('node:fs'),path=require('node:path')
  const review=JSON.parse(fs.readFileSync(path.join(__dirname,'../research/reviews/four-priority-logistics-20261013.json'),'utf8'))
  const dataset=JSON.parse(fs.readFileSync(path.join(__dirname,'../research/data/logistics-dataset-real.json'),'utf8'))
  const verified=new Map(dataset.records.filter(x=>x.status==='VERIFIED').map(x=>[x.sku,x.shipping]))
  assert.equal(review.records.length,4)
  for(const row of review.records){
    assert.match(row.reviewOutcome,/^BLOCKED_/)
    assert.equal(verified.has(row.sku),false,`${row.sku} unexpectedly marked verified`)
    assert.throws(()=>parcelForOrder({lines:[{sku:row.sku,quantity:1}]},verified),e=>e instanceof LogisticsDataError&&e.code==='LOGISTICS_SKU_NOT_VERIFIED')
  }
})
