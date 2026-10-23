/* eslint-disable @typescript-eslint/no-require-imports -- Node deterministic navigation tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { contextualCatalogLinks } = require('../src/catalog/contextualLinks.ts')
const product = (stock, brand = 'CULTI MILANO', category = 'Диффузоры') => ({ id: `${brand}-${stock}`, isActive: true, trade: { sku: `${brand}-${stock}`, name: 'Synthetic navigation fixture', brand, category, volume: '100 мл', price: 100, stock, barcode: null, characteristics: {} }, editorial: { sku: `${brand}-${stock}`, slug: `fixture-${stock}`, images: ['/fixtures/product.webp'], description: 'Synthetic fixture', recommendations: [] } })
test('contextual links expose only stocked pictured destinations and actual product URLs', () => {
  const links = contextualCatalogLinks([product(1), product(0, 'TEATRO Fragranze Uniche'), product(-1)], '/')
  assert.deepEqual(links.sections.map(x => x.href), ['/brands/culti-milano', '/categories/diffusers', '/collections/gift-diffusers', '/collections/home-fragrance'])
  assert.deepEqual(links.examples.map(x => x.href), ['/catalog/fixture-1'])
  assert.match(links.examples[0].label, /CULTI MILANO.*100 мл/)
  assert.ok(!contextualCatalogLinks([product(1)], '/categories/diffusers').sections.some(x => x.href === '/categories/diffusers'))
  const unavailable = [product(0), { ...product(1), isActive: false }, { ...product(2), editorial: { ...product(2).editorial, images: [] } }]
  assert.deepEqual(contextualCatalogLinks(unavailable, '/'), { sections: [], examples: [] })
  assert.deepEqual(contextualCatalogLinks([], '/'), { sections: [], examples: [] })
})
