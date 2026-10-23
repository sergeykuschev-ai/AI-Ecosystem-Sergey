/* VOZDOOH reviewed 1C variants, synthetic fixtures only. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
require('../scripts/register-typescript.cjs')
const { productPageHeading } = require('../src/catalog/presentation.ts')
const { productStructuredData } = require('../src/catalog/structuredData.ts')

function product(slug, size, overrides = {}) {
  return {
    id: slug, isActive: true,
    trade: {
      sku: slug === 'aromagroup-cleaning-fluid-110' ? '9a227639-b1a0-11ed-a1a3-7c8bca00854e' : '4356',
      name: 'Жидкость для промывки картридж AG ' + size.replace(' ', '') + ' пласт.',
      brand: 'AROMAgroup', category: 'Ароматизация помещений',
      volume: size, price: 3100, stock: 3, barcode: null,
      characteristics: {}, ...overrides.trade,
    },
    editorial: {
      sku: slug, slug, images: ['/catalog/official/example.webp'],
      description: '', recommendations: [], ...overrides.editorial,
    },
  }
}

test('110 and 150 ml cleaning fluids have distinct verified H1 and Product JSON-LD names', () => {
  const a = product('aromagroup-cleaning-fluid-110', '110 мл')
  const b = product('aromagroup-cleaning-fluid-150', '150 мл')
  assert.equal(productPageHeading(a), 'Жидкость для промывки 110 мл')
  assert.equal(productPageHeading(b), 'Жидкость для промывки 150 мл')
  const sa = productStructuredData(a, '/catalog/official/example.webp')['@graph'][0]
  const sb = productStructuredData(b, '/catalog/official/example.webp')['@graph'][0]
  assert.equal(sa.name, 'Жидкость для промывки 110 мл')
  assert.equal(sb.name, 'Жидкость для промывки 150 мл')
  assert.notEqual(sa.name, sb.name)
  assert.equal(sa.offers.price, '3100.00')
  assert.equal(sb.offers.price, '3100.00')
  assert.equal(sa.offers.availability, 'https://schema.org/InStock')
  assert.equal(sb.offers.availability, 'https://schema.org/InStock')
  assert.equal(sa.sku, a.trade.sku)
  assert.equal(sb.sku, b.trade.sku)
})

test('missing or inconsistent 1C data never fabricates volume from slug', () => {
  assert.equal(productPageHeading(product('aromagroup-cleaning-fluid-110', '110 мл', { trade: { volume: null } })), 'Жидкость для промывки')
  assert.equal(productPageHeading(product('aromagroup-cleaning-fluid-110', '110 мл', { trade: { volume: '999 мл' } })), 'Жидкость для промывки')
  assert.equal(productPageHeading(product('aromagroup-cleaning-fluid-150', '150 мл', { trade: { name: 'Жидкость для промывки картридж AG' } })), 'Жидкость для промывки')
})

for (const [size, otherSize] of [[110, 150], [150, 110]]) {
  const slug = `aromagroup-cleaning-fluid-${size}`
  const siteUrl = 'https://catalog.example.invalid'

  test(`${size} ml: a conflicting source name cannot authorize the variant heading`, () => {
    const item = product(slug, `${size} мл`, {
      trade: { name: `Жидкость для промывки картридж AG ${otherSize}мл пласт.` },
    })
    const schema = productStructuredData(item, item.editorial.images[0], siteUrl)['@graph'][0]
    assert.equal(productPageHeading(item), 'Жидкость для промывки')
    assert.equal(schema.name, 'Жидкость для промывки')
  })

  test(`${size} ml: a matching source name cannot override a conflicting volume`, () => {
    const item = product(slug, `${size} мл`, { trade: { volume: `${otherSize} мл` } })
    const schema = productStructuredData(item, item.editorial.images[0], siteUrl)['@graph'][0]
    assert.equal(productPageHeading(item), 'Жидкость для промывки')
    assert.equal(schema.name, 'Жидкость для промывки')
  })

  test(`${size} ml: zero stock preserves variant identity in an out-of-stock Product offer`, () => {
    const item = product(slug, `${size} мл`, { trade: { stock: 0 } })
    const schema = productStructuredData(item, item.editorial.images[0], siteUrl)['@graph'][0]
    const url = `${siteUrl}/catalog/${slug}`
    assert.equal(productPageHeading(item), `Жидкость для промывки ${size} мл`)
    assert.equal(schema['@type'], 'Product')
    assert.equal(schema.name, `Жидкость для промывки ${size} мл`)
    assert.equal(schema.sku, item.trade.sku)
    assert.equal(schema.url, url)
    assert.equal(schema['@id'], `${url}#product`)
    assert.equal(schema.offers['@type'], 'Offer')
    assert.equal(schema.offers.url, url)
    assert.equal(schema.offers.availability, 'https://schema.org/OutOfStock')
    assert.equal(schema.offers.price, '3100.00')
    assert.equal(schema.offers.priceCurrency, 'RUB')
  })
}

test('other slugs do not change even with an available volume', () => {
  assert.equal(productPageHeading(product('aromagroup-other-110', '110 мл')), 'Жидкость для промывки')
})

test('H1 and Product JSON-LD use the same reviewed helper', () => {
  const page = fs.readFileSync(path.join(__dirname, '../app/catalog/[slug]/page.tsx'), 'utf8')
  const schema = fs.readFileSync(path.join(__dirname, '../src/catalog/structuredData.ts'), 'utf8')
  assert.match(page, /<h1>\{productPageHeading\(product\)\}<\/h1>/)
  assert.match(schema, /const heading = productPageHeading\(product\)/)
})
