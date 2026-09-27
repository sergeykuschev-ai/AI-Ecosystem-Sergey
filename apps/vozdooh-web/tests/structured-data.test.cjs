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
