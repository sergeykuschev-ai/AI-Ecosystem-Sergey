/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic regression fixtures. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { reviewedFragranceVariants } = require('../src/catalog/productVariants.ts')
const { reviewedCommercialTitle } = require('../src/seo/productMetadata.ts')
const make = (sku, slug, name = 'Aramara', trade = {}, editorial = {}) => ({
  id: sku, isActive: true,
  trade: { sku, name, brand: 'CULTI MILANO', category: 'Диффузоры', volume: '250 мл', stock: 1, price: 100, barcode: null, characteristics: {}, ...trade },
  editorial: { slug, images: ['/synthetic.webp'], description: null, scentFamily: null, mood: null, room: null, recommendations: [], ...editorial },
})
const current = () => make('802e8ae5-d19b-11ec-be83-7c8bca00854e', 'culti-decor-aramara-250')
const alternative = () => make('bf33a951-016c-11ed-b2a4-7c8bca00854e', 'culti-decor-aramara-1000', 'Aramara', {volume: '1000 мл'})

test('commercial title identifies the reviewed diffuser and preserves full variant identity', () => {
  const p = current()
  const before = JSON.stringify(p)
  const title = reviewedCommercialTitle(p, 'old', { title: 'Decor Classic Aramara', subtitle: 'Диффузоры · 250 мл' })
  assert.equal(title, 'Диффузор CULTI MILANO Decor Classic Aramara 250 мл — купить | VOZDOOH')
  assert.equal(JSON.stringify(p), before)
  for (const sku of ['bf33a951-016c-11ed-b2a4-7c8bca00854e', 'df29d344-d192-11ec-be83-7c8bca00854e', 'df29d346-d192-11ec-be83-7c8bca00854e']) {
    assert.match(reviewedCommercialTitle({...p, trade:{...p.trade, sku}}, 'old', {title:'Complete Variant', subtitle:'Диффузоры · 250 мл'}), /^Диффузор CULTI MILANO Complete Variant 250 мл/)
  }
})

test('commercial title scope excludes other products, brands, formats and demo data', () => {
  const p = current()
  for (const trade of [{sku:'unrelated'}, {brand:'Other'}, {category:'Рефилы'}, {category:'Для автомобиля'}]) {
    assert.equal(reviewedCommercialTitle({...p, trade:{...p.trade,...trade}}, 'unchanged', {title:'Name',subtitle:'Format'}), 'unchanged')
  }
  assert.equal(reviewedCommercialTitle({...p, trade:{...p.trade,volume:null}}, 'old', {title:'Full Name',subtitle:''}), 'Диффузор CULTI MILANO Full Name — купить | VOZDOOH')
})

test('alternatives match reviewed brand and fragrance, omit self, and retain rank without mutating inputs', () => {
  const a = alternative()
  const b = make('df29d344-d192-11ec-be83-7c8bca00854e','culti-stile-aramara-250')
  const products = [b, current(), a]
  const before = JSON.stringify(products)
  assert.deepEqual(reviewedFragranceVariants(products,current()).map(p=>p.trade.sku),[a.trade.sku,b.trade.sku])
  assert.equal(JSON.stringify(products),before)
  assert.deepEqual(reviewedFragranceVariants([],current()),[])
  assert.deepEqual(reviewedFragranceVariants([a],make('unknown','unknown')),[])
})

test('alternatives exclude unavailable, unpriced, inactive, unpictured and unrelated products', () => {
  const a = alternative()
  const invalid = [0,-1,null].map(stock=>({...a,trade:{...a.trade,stock}}))
  invalid.push(...[0,-1,null,NaN,Infinity].map(price=>({...a,trade:{...a.trade,price}})))
  invalid.push({...a,isActive:false}, {...a,editorial:{...a.editorial,images:[]}}, {...a,editorial:{...a.editorial,slug:''}}, {...a,trade:{...a.trade,brand:'Other'}}, make('df29d346-d192-11ec-be83-7c8bca00854e','culti-stile-tessuto-250','Tessuto'))
  assert.deepEqual(reviewedFragranceVariants(invalid,current()),[])
  assert.deepEqual(reviewedFragranceVariants([a],{...current(),trade:{...current().trade,stock:0}}),[])
})

test('diffuser and refill alternatives keep separate trade categories', () => {
  const d = make('655467','teatro-dolce-vaniglia-500','DOLCE VANIGLIA',{brand:'TEATRO Fragranze Uniche',volume:'500 мл'})
  const r = make('DV500RTFU','teatro-dolce-vaniglia-refill-500','DOLCE VANIGLIA',{brand:'TEATRO Fragranze Uniche',category:'Рефилы',volume:'500 мл'})
  assert.equal(reviewedFragranceVariants([d,r],d)[0].trade.category,'Рефилы')
})
