/* eslint-disable @typescript-eslint/no-require-imports -- Deterministic URL policy regression. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { catalogIndexPolicy, catalogPaginationPolicy } = require('../src/seo/catalogPolicy.ts')
const products = [{ id: 'fixture', isActive: true, trade: { sku: 'fixture', name: 'Synthetic diffuser', brand: 'CULTI MILANO', category: 'Диффузоры', stock: 1 }, editorial: { slug: 'fixture', images: ['/fixture.webp'] } }]
test('public catalog, equivalent stocked brand facets and browsing utilities have distinct policy', () => {
  const before = process.env.SEARCH_INDEXING_ENABLED
  try {
    for (const enabled of ['true', 'false']) {
      process.env.SEARCH_INDEXING_ENABLED = enabled
      const publicPolicy = { index: enabled === 'true', follow: enabled === 'true' }
      for (const params of [{}, { unknown: 'anything' }, { utm_source: 'fixture' }, { brand: '' }, { debugCatalog: '0' }]) {
        const p = catalogIndexPolicy(params, products); assert.equal(p.canonical, '/catalog'); assert.deepEqual(p.robots, publicPolicy)
      }
      const brand = catalogIndexPolicy({ brand: 'CULTI MILANO', utm_source: 'fixture' }, products)
      assert.equal(brand.canonical, '/brands/culti-milano'); assert.deepEqual(brand.robots, publicPolicy)
      for (const params of [{ q: '' }, { q: '  CULTI  ' }, { q: ['CULTI', 'ignored'] }, { brand: 'missing' }, { brand: 'CULTI MILANO', category: 'Диффузоры' }, { category: 'missing' }]) {
        const p = catalogIndexPolicy(params, products);assert.deepEqual(p.robots, { index: false, follow: true }); assert.ok(p.canonical.startsWith('/catalog?'))
      }
      assert.equal(catalogIndexPolicy({ q: '  CULTI  ' }, products).canonical, '/catalog?q=CULTI')
      assert.equal(catalogIndexPolicy({ brand: 'missing' }, products).invalidFilters, true)
      assert.equal(catalogIndexPolicy({ brand: 'CULTI MILANO' }, []).invalidFilters, true)
      assert.equal(catalogIndexPolicy({ brand: 'CULTI MILANO' }, [{ ...products[0], trade: { ...products[0].trade, stock: 0 } }]).invalidFilters, true)
      assert.deepEqual(catalogIndexPolicy({ debugCatalog: '1', q: 'CULTI' }, products), { canonical: '/catalog', robots: { index: false, follow: true }, invalidFilters: false })
    }
  } finally { if (before === undefined) delete process.env.SEARCH_INDEXING_ENABLED; else process.env.SEARCH_INDEXING_ENABLED = before }
})
test('only the first complete listing exists; duplicate page one normalizes and unsupported pages fail', () => {
  assert.equal(catalogPaginationPolicy([]), 'pass')
  assert.equal(catalogPaginationPolicy(['1']), 'normalize')
  for (const pages of [[''], ['0'], ['2'], ['-1'], ['1.5'], ['01'], ['abc'], ['99999999999999999999'], ['1', '2']]) assert.equal(catalogPaginationPolicy(pages), 'missing')
})
test('catalog proxy returns actual 404 or a preserving 308 and is scoped away from commerce', () => {
  const { NextRequest } = require('next/server')
  const { proxy, config } = require('../proxy.ts')
  assert.equal(config.matcher, '/catalog')
  const missing = proxy(new NextRequest('https://example.test/catalog?page=2'))
  assert.equal(missing.status, 404)
  assert.match(missing.headers.get('X-Robots-Tag'), /noindex/)
  const redirect = proxy(new NextRequest('https://example.test/catalog?page=1&q=CULTI&brand=CULTI+MILANO'))
  assert.equal(redirect.status, 308)
  assert.equal(redirect.headers.get('location'), 'https://example.test/catalog?q=CULTI&brand=CULTI+MILANO')
  assert.equal(proxy(new NextRequest('https://example.test/catalog?q=CULTI')).status, 200)
})
