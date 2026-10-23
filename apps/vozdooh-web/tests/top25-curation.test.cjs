/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { demandRank } = require('../src/catalog/demandPriority.ts')
const { merchandisingSignal } = require('../src/catalog/merchandising.ts')
const { editorialCollections, collectionProducts, collectionsForProduct, availableCollections } = require('../src/catalog/collections.ts')
const { withValidImages } = require('../src/catalog/validImages.ts')
const selection = editorialCollections.find(c => c.slug === 'vozdooh-selection')
const popular = editorialCollections.find(c => c.slug === 'popular')
// Read only SKU identities from the checked-in mappings; all product data is synthetic.
const mappingSource = ['demandPriority', 'merchandising'].map(name => fs.readFileSync(`src/catalog/${name}.ts`, 'utf8')).join('\n')
const skus = [...mappingSource.matchAll(/'([^']+)': \{ (?:rank|promotionRank): /g)].map(m => m[1]).sort((a,b) => demandRank(a)-demandRank(b))
const make = (sku, trade = {}, editorial = {}, active = true) => ({
  id: sku, isActive: active,
  trade: { sku, name: 'Synthetic', brand: 'Synthetic', category: 'Диффузоры', volume: '100 мл', stock: 1, price: 100, barcode: null, characteristics: {}, ...trade },
  editorial: { slug: `synthetic-${sku}`, images: ['/synthetic.webp'], description: null, scentFamily: null, mood: null, room: null, recommendations: [], ...editorial },
})

test('research selection has exactly the 25 mapped ranks and preserves their order', () => {
  assert.equal(skus.length, 25)
  assert.deepEqual(skus.map(demandRank), Array.from({length:25}, (_,i) => i+1))
  const products = skus.map(sku => make(sku)).reverse()
  assert.deepEqual(collectionProducts(products, selection).map(p => p.trade.sku), skus)
  assert.equal(products[0].trade.sku, skus[24])
  for (const p of products) assert.ok(collectionsForProduct(p).includes(selection))
})

test('selection rejects unavailable, unpriced, inactive, imageless, excluded and unrelated products', () => {
  const sku = skus[0]
  const invalid = [0,-1,null].map(stock => make(sku,{stock}))
  invalid.push(...[null,undefined,0,-1,NaN,Infinity].map(price => make(sku,{price})))
  invalid.push(make(sku,{}, {images:[]}), make(sku,{}, {images:['https://invalid/image.jpg']}), make(sku,{}, {}, false), make(sku,{}, {slug:''}), make('445445'), make('unrelated'))
  assert.deepEqual(collectionProducts(invalid, selection), [])
  assert.ok(invalid.every(p => !collectionsForProduct(p).includes(selection)))
  assert.ok(!availableCollections(invalid).some(c => c.slug === selection.slug))
})

test('asset validation precedes selection and removes nonexistent local images', async () => {
  const validated = await withValidImages([make(skus[0], {}, {images:['/synthetic-nonexistent-top25.webp']})])
  assert.deepEqual(collectionProducts(validated, selection), [])
  const page = fs.readFileSync('app/collections/[slug]/page.tsx','utf8')
  assert.match(page, /await withValidImages/)
  assert.match(page, /availableCollections\(products\)/)
})

test('car sachet and refill keep their categories; popular retains only existing verified signals', () => {
  const car = make(skus[5], {category:'Для автомобиля'})
  const refill = make(skus[12], {category:'Рефилы'})
  assert.equal(collectionProducts([car], selection)[0].trade.category, 'Для автомобиля')
  assert.equal(collectionProducts([refill], selection)[0].trade.category, 'Рефилы')
  const result = collectionProducts(skus.map(sku => make(sku)), popular)
  assert.equal(result.length,14)
  assert.ok(result.every(p => merchandisingSignal(p.trade.sku)))
  assert.deepEqual(popular.rule, {field:'demand',values:['verified']})
})

test('customer copy has no rank or fixed count and home link disappears with empty selection', () => {
  const copy = [selection.name, selection.eyebrow, selection.description, selection.note, selection.guideTitle, ...selection.guide].join(' ')
  assert.doesNotMatch(copy, /\d|TOP|rank|CORE|STRONG|бестселлер|хит продаж|\?\?/i)
  assert.match(copy, /Автомобильное саше/)
  assert.match(copy, /доступные при оформлении пункты Ozon/)
  const home = fs.readFileSync('app/page.tsx','utf8')
  assert.match(home, /const selection = availableCollections\(products\)/)
  assert.match(home, /\{selection && <Link className="textLink" href="\/collections\/vozdooh-selection"/)
})
