/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { applyCatalogSearch, catalogSearchQuery } = require('../src/catalog/search.ts')
const { applyCatalogFilters } = require('../src/catalog/filters.ts')
const { storefrontProducts } = require('../src/catalog/presentation.ts')
const { catalogHref } = require('../src/catalog/filterParams.ts')
const product = (sku, name, brand, category = 'Диффузоры', images = ['/catalog/test.jpg']) => ({
  id: sku, isActive: true, trade: { sku, name, brand, category, stock: 1 }, editorial: { images },
})
const products = [product('A-10', 'Белый   чай', 'CULTI MILANO'), product('B-20', 'Rose', 'TEATRO', 'Свечи')]
test('search normalizes whitespace, case and repeated query values', () => {
  assert.equal(catalogSearchQuery(['  БЕЛЫЙ\t чай  ', 'ignored']), 'БЕЛЫЙ чай')
  assert.equal(catalogSearchQuery(undefined), '')
  assert.deepEqual(applyCatalogSearch(products, ' белый ЧАЙ '), [products[0]])
  assert.deepEqual(applyCatalogSearch(products, 'culti  milano'), [products[0]])
  assert.deepEqual(applyCatalogSearch(products, 'a-10'), [products[0]])
  assert.deepEqual(applyCatalogSearch(products, ' \n '), products)
  assert.deepEqual(applyCatalogSearch(products, 'missing'), [])
  assert.deepEqual(applyCatalogSearch(products, '[.*'), [])
  assert.deepEqual(applyCatalogSearch([], 'Rose'), [])
  assert.deepEqual(applyCatalogSearch([product('x', 'No brand', null)], 'no brand').length, 1)
})
test('search intersects filters and cannot restore hidden storefront records', () => {
  const filters = { category: 'Свечи', brand: null, family: null, mood: null, room: null }
  assert.deepEqual(applyCatalogSearch(applyCatalogFilters(products, filters), 'culti'), [])
  assert.deepEqual(applyCatalogSearch(applyCatalogFilters(products, filters), 'teatro'), [products[1]])
  const hidden = [product('secret', 'Rose', 'TEATRO', 'Свечи', []), product('445445', 'Rose', 'TEATRO')]
  assert.deepEqual(applyCatalogSearch(storefrontProducts(hidden), 'Rose'), [])
  assert.deepEqual(applyCatalogSearch(storefrontProducts(hidden), '445445'), [])
  const href = new URL(catalogHref(filters, 'brand', 'TEATRO', false, 'Белый чай'), 'http://localhost')
  assert.equal(href.searchParams.get('q'), 'Белый чай')
  assert.equal(href.searchParams.get('category'), 'Свечи')
})
