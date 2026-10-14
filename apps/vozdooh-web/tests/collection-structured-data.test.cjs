/* eslint-disable @typescript-eslint/no-require-imports -- Node schema contract tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { landingStructuredData, serializeStructuredData } = require('../src/catalog/structuredData.ts')
const { availableCollections } = require('../src/catalog/collections.ts')
const fixture = stock => ({ id: `fixture-${stock}`, isActive: true, trade: { sku: `fixture-${stock}`, name: 'Synthetic diffuser', brand: null, category: 'Диффузоры', volume: '100 мл', stock, price: 100 }, editorial: { slug: `fixture-${stock}`, sku: `fixture-${stock}`, images: ['/fixtures/product.webp'], description: 'Synthetic fixture', recommendations: [] } })
test('collection graph mirrors selected visible stocked products and breadcrumb hierarchy', () => {
  const collection = availableCollections([fixture(0), fixture(2), fixture(1)]).find(x => x.slug === 'gift-diffusers')
  const graph = landingStructuredData({ kind: 'collection', ...collection, siteUrl: 'https://example.test/' })['@graph']
  const [page, items, breadcrumbs] = graph
  assert.equal(page['@type'], 'CollectionPage')
  assert.equal(page.url, 'https://example.test/collections/gift-diffusers')
  assert.deepEqual(page.mainEntity, { '@id': items['@id'] })
  assert.deepEqual(page.breadcrumb, { '@id': breadcrumbs['@id'] })
  assert.equal(items['@type'], 'ItemList')
  assert.deepEqual(items.itemListElement.map(x => x.url), collection.products.map(x => `https://example.test/catalog/${x.editorial.slug}`))
  assert.deepEqual(items.itemListElement.map(x => x.position), [1, 2])
  assert.equal(breadcrumbs['@type'], 'BreadcrumbList')
  assert.deepEqual(breadcrumbs.itemListElement.map(x => x.item), ['https://example.test/', 'https://example.test/collections', page.url])
  assert.doesNotMatch(JSON.stringify(graph), /aggregateRating|review|Offer|fixture-0/)
  const empty = landingStructuredData({ kind: 'collection', slug: 'empty', name: '</script>', description: 'Fixture', products: [], siteUrl: 'https://example.test' })
  assert.deepEqual(empty['@graph'][1].itemListElement, [])
  assert.doesNotMatch(serializeStructuredData(empty), /<\/script>/)
})
