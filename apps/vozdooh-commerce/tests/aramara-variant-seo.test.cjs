/* Synthetic trade records based on the reviewed evidence in issue #271. */
const test = require('node:test')
const assert = require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const { productPageHeading, productPresentation } = require('../src/catalog/presentation.ts')
const { productStructuredData } = require('../src/catalog/structuredData.ts')

const variants = [
  ['1000', 'bf33a951-016c-11ed-b2a4-7c8bca00854e', 'Decor Classic диффузор Aramara 1000 мл'],
  ['250', '802e8ae5-d19b-11ec-be83-7c8bca00854e', 'Decor Classic диффузор Aramara 250мл'],
]
function fixture([size, sku, name]) {
  const slug = `culti-decor-aramara-${size}`
  return {
    id: slug, isActive: true,
    trade: { sku, name, volume: `${size} мл`, brand: 'CULTI MILANO', category: 'Диффузоры',
      price: 1234, stock: 2, barcode: null, characteristics: {} },
    editorial: { sku, slug, images: ['/catalog/synthetic.webp'], description: '', recommendations: [] },
  }
}
function schema(item) {
  return productStructuredData(item, item.editorial.images[0], 'https://catalog.example.invalid')['@graph'][0]
}

for (const variant of variants) {
  const [size] = variant
  test(`${size} ml reviewed Aramara has a distinct H1 and Product name without trade mutations`, () => {
    const item = fixture(variant)
    const before = structuredClone(item)
    const heading = `Decor Classic Aramara ${size} мл`
    assert.equal(productPageHeading(item), heading)
    const data = schema(item)
    assert.equal(data.name, heading)
    assert.equal(data.sku, item.trade.sku)
    assert.equal(data.url, `https://catalog.example.invalid/catalog/${item.editorial.slug}`)
    assert.equal(data.offers.price, '1234.00')
    assert.equal(data.offers.priceCurrency, 'RUB')
    assert.equal(data.offers.availability, 'https://schema.org/InStock')
    item.trade.stock = 0
    assert.equal(schema(item).name, heading)
    assert.equal(schema(item).offers.availability, 'https://schema.org/OutOfStock')
    item.trade.stock = before.trade.stock
    assert.deepEqual(item, before)
  })

  for (const [label, patch] of [
    ['missing volume', { volume: null }],
    ['conflicting volume', { volume: '999 мл' }],
    ['missing name', { name: '' }],
    ['conflicting name', { name: 'Decor Classic диффузор Aramara 999 мл' }],
    ['different fragrance', { name: `Decor Classic диффузор Mareminerale ${size} мл` }],
    ['different SKU', { sku: 'synthetic-other-sku' }],
  ]) {
    test(`${size} ml ${label} preserves the existing presentation`, () => {
      const item = fixture(variant)
      Object.assign(item.trade, patch)
      const expected = productPresentation(item).title
      assert.equal(productPageHeading(item), expected)
      assert.equal(schema(item).name, expected)
    })
  }

  test(`${size} ml trade evidence does not change an unreviewed path`, () => {
    const item = fixture(variant)
    item.editorial.slug = 'culti-decor-aramara-other'
    assert.equal(productPageHeading(item), productPresentation(item).title)
    assert.equal(schema(item).name, productPresentation(item).title)
  })
}
