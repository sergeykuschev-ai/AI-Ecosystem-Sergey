/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const { productStructuredData, serializeStructuredData } = require('../src/catalog/structuredData.ts')

function product(overrides = {}) {
  return {
    id: 'sku-1',
    isActive: true,
    trade: {
      sku: 'SKU-1',
      name: 'CULTI MILANO Decor Classic Aramara 250 мл',
      brand: 'CULTI MILANO',
      category: 'Диффузоры',
      volume: '250 мл',
      price: 11200,
      stock: 2,
      barcode: '8050534795813',
      characteristics: {},
      ...overrides.trade,
    },
    editorial: {
      slug: 'culti-decor-aramara-250',
      images: ['/catalog/official/example.jpg'],
      description: 'Цитрусово-древесная композиция.',
      scentFamily: 'citrus',
      mood: 'airy',
      room: 'living',
      recommendations: [],
      ...overrides.editorial,
    },
  }
}

test('Product JSON-LD uses only verified trade/editorial facts and no review claims', () => {
  const data = productStructuredData(product(), '/catalog/official/example.jpg', 'https://vozdooh27.ru/')
  assert.equal(data['@context'], 'https://schema.org')
  const schemaProduct = data['@graph'][0]
  const breadcrumbs = data['@graph'][1]
  assert.equal(schemaProduct['@type'], 'Product')
  assert.equal(schemaProduct.url, 'https://vozdooh27.ru/catalog/culti-decor-aramara-250')
  assert.equal(schemaProduct.image[0], 'https://vozdooh27.ru/catalog/official/example.jpg')
  assert.equal(schemaProduct.brand.name, 'CULTI MILANO')
  assert.equal(schemaProduct.gtin13, '8050534795813')
  assert.equal(schemaProduct.offers.price, '11200.00')
  assert.equal(schemaProduct.offers.priceCurrency, 'RUB')
  assert.equal(schemaProduct.offers.availability, 'https://schema.org/InStock')
  assert.equal(schemaProduct.aggregateRating, undefined)
  assert.equal(schemaProduct.review, undefined)
  assert.equal(schemaProduct.offers.priceValidUntil, undefined)
  assert.equal(breadcrumbs.itemListElement[1].item, 'https://vozdooh27.ru/catalog')
})

test('Product JSON-LD omits unsupported barcode and offer facts', () => {
  const data = productStructuredData(product({ trade: { barcode: 'ABC', price: null, stock: null } }), '/catalog/x.jpg')
  const schemaProduct = data['@graph'][0]
  assert.equal(schemaProduct.gtin13, undefined)
  assert.equal(schemaProduct.offers, undefined)
})

test('structured data serialization cannot close its script element', () => {
  const json = serializeStructuredData({ description: '</script><script>alert(1)</script>' })
  assert.doesNotMatch(json, /</)
  assert.match(json, /\\u003c\/script>/)
  assert.deepEqual(JSON.parse(json), { description: '</script><script>alert(1)</script>' })
})

test('brand/category CollectionPage JSON-LD contains only exact page and product facts', () => {
  const { landingStructuredData } = require('../src/catalog/structuredData.ts')
  const brand = landingStructuredData({
    kind: 'brand', slug: 'culti-milano', name: 'CULTI MILANO',
    description: 'CULTI MILANO в VOZDOOH.', products: [product()], siteUrl: 'https://vozdooh27.ru/',
  })
  const [page, list, breadcrumbs] = brand['@graph']
  assert.equal(page['@type'], 'CollectionPage')
  assert.equal(page.url, 'https://vozdooh27.ru/brands/culti-milano')
  assert.deepEqual(page.about, { '@type': 'Brand', name: 'CULTI MILANO' })
  assert.equal(list.itemListElement.length, 1)
  assert.equal(list.itemListElement[0].url, 'https://vozdooh27.ru/catalog/culti-decor-aramara-250')
  assert.equal(breadcrumbs.itemListElement[1].item, 'https://vozdooh27.ru/brands')

  const category = landingStructuredData({
    kind: 'category', slug: 'diffusers', name: 'Диффузоры', description: 'Диффузоры.', products: [product()],
  })
  assert.equal(category['@graph'][0].about, undefined)
  assert.match(category['@graph'][0].url, /\/categories\/diffusers$/)
})
