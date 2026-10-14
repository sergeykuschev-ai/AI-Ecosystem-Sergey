/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const test = require('node:test')
const assert = require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const { isPubliclyPurchasable } = require('../src/catalog/presentation.ts')

const make = (sku, overrides = {}) => ({
  id: sku, isActive: true,
  trade: { sku, name: `Test ${sku}`, brand: 'CULTI MILANO', category: 'Диффузоры', volume: '250 мл', stock: 1, price: 11200, barcode: null, characteristics: {}, ...(overrides.trade ?? {}) },
  editorial: { sku, slug: sku, images: ['/brand/vozdooh-horizontal.webp'], description: 'Synthetic fixture only', recommendations: [], ...(overrides.editorial ?? {}) },
  ...Object.fromEntries(Object.entries(overrides).filter(([k]) => !['trade','editorial'].includes(k))),
})

test('public product eligibility requires actual available stock, price, image and activity', () => {
  assert.equal(isPubliclyPurchasable(make('sellable')), true)
  for (const invalid of [
    { trade: { stock: 0 } }, { trade: { stock: null } },
    { trade: { price: 0 } }, { trade: { price: null } },
    { editorial: { images: [] } }, { editorial: { slug: '' } },
    { isActive: false },
  ]) assert.equal(isPubliclyPurchasable(make('invalid', invalid)), false)
})

test('sitemap includes only purchasable products with valid existing images', async () => {
  const source = require('../src/catalog/source.ts')
  const original = source.getCatalogRepository
  source.getCatalogRepository = async () => ({ list: async () => [
    make('available-product'),
    make('sold-out', { trade: { stock: 0 } }),
    make('not-priced', { trade: { price: null } }),
    make('missing-photo', { editorial: { images: ['/catalog/nonexistent-file-12345.webp'] } }),
    make('inactive', { isActive: false }),
  ] })
  try {
    const sitemap = await require('../app/sitemap.ts').default()
    const urls = sitemap.map(({ url }) => new URL(url).pathname)
    assert.ok(urls.includes('/catalog/available-product'))
    for (const slug of ['sold-out','not-priced','missing-photo','inactive']) assert.ok(!urls.includes(`/catalog/${slug}`), slug)
  } finally { source.getCatalogRepository = original }
})
