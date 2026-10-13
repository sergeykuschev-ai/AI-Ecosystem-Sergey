const { test } = require('node:test')
const assert = require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const {loadPreliminaryQuoteData,parcelForPreliminaryQuote}=require('../src/commerce/preliminaryQuoteLogistics.ts')
const {parcelForOrder,LogisticsDataError}=require('../src/commerce/logisticsDataset.ts')
const {readFileSync}=require('node:fs')
const {join}=require('node:path')
const sample=loadPreliminaryQuoteData()
const order=(sku,quantity=1)=>({lines:[{sku,quantity}]})
test('four owner-authorized product values are exact copies of the evidence numbers, never VERIFIED',()=>{
  const actual=sample.products.map(p=>[p.sku,p.productWeightG,p.productDimensionsMm,p.status])
  assert.deepEqual(actual,[
    ['089864',700,[140,130,300],'PROVISIONAL'],
    ['N019834',360,[99,99,82],'PROVISIONAL'],
    ['N019873',370,[99,99,82],'PROVISIONAL'],
    ['045850b2-9e1f-11ee-b408-d069cd63062f',114,[47,47,90],'PROVISIONAL'],
  ])
  const rows=JSON.parse(readFileSync(join(__dirname,'../research/data/logistics-dataset-real.json'),'utf8')).records
  for (const p of sample.products) assert.notEqual(rows.find(r=>r.sku===p.sku)?.status,'VERIFIED')
})
test('indicated quote wraps estimated article in conservatively sized reference carton',()=>{
  assert.deepEqual(parcelForPreliminaryQuote(order('089864'),sample),{
    provisional:true,parcel:{weightG:1180,lengthMm:406,widthMm:306,heightMm:206},
  })
  assert.deepEqual(parcelForPreliminaryQuote(order('N019834'),sample),{
    provisional:true,parcel:{weightG:660,lengthMm:308,widthMm:208,heightMm:158},
  })
  assert.deepEqual(parcelForPreliminaryQuote(order('N019873'),sample),{
    provisional:true,parcel:{weightG:670,lengthMm:308,widthMm:208,heightMm:158},
  })
  assert.deepEqual(parcelForPreliminaryQuote(order('045850b2-9e1f-11ee-b408-d069cd63062f'),sample),{
    provisional:true,parcel:{weightG:354,lengthMm:206,widthMm:156,heightMm:106},
  })
})
test('preliminary quote never enables order dispatch or multiple units',()=>{
  const candidate='089864'
  assert.throws(()=>parcelForOrder(order(candidate)),e=>e instanceof LogisticsDataError && e.code==='LOGISTICS_SKU_NOT_VERIFIED')
  assert.throws(()=>parcelForPreliminaryQuote(order(candidate,2),sample),e=>e instanceof LogisticsDataError && e.code==='LOGISTICS_SKU_NOT_VERIFIED')
  assert.throws(()=>parcelForPreliminaryQuote(order('other'),sample),e=>e instanceof LogisticsDataError && e.code==='LOGISTICS_SKU_NOT_VERIFIED')
})
test('an estimated parcel fails closed when no carton fits or data invalid',()=>{
  const miniature={...sample,cartons:sample.cartons.filter(x=>x.innerLengthMm<200)}
  assert.throws(()=>parcelForPreliminaryQuote(order('089864'),miniature),e=>e instanceof LogisticsDataError && e.code==='PRELIMINARY_QUOTE_NO_REFERENCE_BOX_FITS')
})
