/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const ts = require('typescript')
require.extensions['.tsx'] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  })
  module._compile(outputText, filename)
}
const { renderToStaticMarkup } = require('react-dom/server')
const { availableCollections, commercialCollections, commercialCollectionsForProduct } = require('../src/catalog/collections.ts')
const { contextualCatalogLinks } = require('../src/catalog/contextualLinks.ts')
const fixture = (id, name, volume, overrides = {}) => ({
  id, isActive: true,
  trade: { sku: id, name, brand: 'CULTI MILANO', category: 'Диффузоры', volume, price: 100, stock: 1, barcode: null, characteristics: {}, ...overrides },
  editorial: { slug: 'fixture-' + id, description: 'Synthetic fixture', images: ['/brand/vozdooh-horizontal.webp'], scentFamily: null, mood: null, room: null, recommendations: [] },
})
const products = [
  fixture('d1', 'Decor Classic A', '250 мл'),
  fixture('d2', 'Décor Limited B', '500 мл'),
  fixture('d3', 'Decor Classic C', '250ml'),
  fixture('s1', 'Stile Classic D', '500 мл'),
  fixture('s2', 'Stile Classic E', '250 мл'),
  fixture('s3', 'Stile Limited F', '500 мл'),
  fixture('r1', 'Decor Classic refill', '250 мл', { category: 'Рефилы' }),
  fixture('a1', 'Decor Classic other', '250 мл', { brand: 'Other' }),
  fixture('bad-stock', 'Stile Classic unavailable', '500 мл', { stock: 0 }),
  fixture('bad-price', 'Decor Classic no price', '250 мл', { price: null }),
  fixture('unknown-volume', 'Stile Classic no volume', null),
  { ...fixture('inactive', 'Decor Classic inactive', '250 мл'), isActive: false },
  { ...fixture('bad-image', 'Decor Classic no image', '250 мл'), editorial: { slug: 'fixture-bad-image', images: [], recommendations: [] } },
]
const slugs = commercialCollections.map(c => c.slug)
const members = (items, slug) => availableCollections(items).find(c => c.slug === slug)?.products.map(p => p.trade.sku).sort()
test('commercial collections are exact, guarded by stock, price, format, volume and verified brand-line name', () => {
  assert.deepEqual(members(products, 'diffusers-250-ml'), ['a1', 'd1', 'd3', 's2'])
  assert.deepEqual(members(products, 'diffusers-500-ml'), ['d2', 's1', 's3'])
  assert.deepEqual(members(products, 'culti-decor'), ['d1', 'd2', 'd3'])
  assert.deepEqual(members(products, 'culti-stile'), ['s1', 's2', 's3', 'unknown-volume'])
  assert.deepEqual(members([...products, products[0]], 'culti-decor'), ['d1', 'd2', 'd3'])
  assert.equal(members([products[0], products[1]], 'culti-decor'), undefined)
  assert.equal(members([products[0], products[0], products[0]], 'diffusers-250-ml'), undefined)
  assert.deepEqual(commercialCollectionsForProduct(products[0], products).map(c => c.slug), ['diffusers-250-ml', 'culti-decor'])
  assert.deepEqual(commercialCollectionsForProduct(products[0], [products[0]]), [])
  const links = contextualCatalogLinks(products, '/categories/diffusers').sections.map(x => x.href)
  for (const slug of slugs) assert.ok(links.includes('/collections/' + slug), slug)
  assert.ok(!contextualCatalogLinks(products, '/collections/culti-decor').sections.some(x => x.href === '/collections/culti-decor'))
})
test('Unicode token boundaries reject lookalike line prefixes without dropping genuine accented Decor', () => {
  for (const name of ['Decorа Classic C', 'Decor2 Classic C', 'Decor_Classic C', 'Decoré Classic C']) {
    const replaced = products.map(p => p.trade.sku === 'd3' ? { ...p, trade: { ...p.trade, name } } : p)
    assert.equal(members(replaced, 'culti-decor'), undefined, name)
  }
  const replaced = products.map(p => p.trade.sku === 's1' || p.trade.sku === 's2' ? { ...p, trade: { ...p.trade, name: 'Stileа Classic' } } : p)
  assert.equal(members(replaced, 'culti-stile'), undefined)
})
test('commercial contextual links use global eligibility and page relevance', () => {
  const page = products.filter(p => ['d1', 'd2', 'd3'].includes(p.trade.sku))
  const links = contextualCatalogLinks(page, '/collections/culti-decor', products).sections.map(x => x.href)
  assert.ok(links.includes('/collections/diffusers-500-ml'))
  assert.ok(!links.includes('/collections/culti-stile'))
  assert.ok(!links.includes('/collections/culti-decor'))
  assert.ok(!contextualCatalogLinks(page, '/collections/culti-decor', page).sections.some(x => x.href === '/collections/diffusers-500-ml'))
})
test('new routes render server-side with matching canonical, schema, robots and sitemap; absent destinations are excluded', async () => {
  const source = require('../src/catalog/source.ts')
  const original = source.getCatalogRepository
  const indexing = process.env.SEARCH_INDEXING_ENABLED
  source.getCatalogRepository = async () => ({ list: async () => products })
  try {
    process.env.SEARCH_INDEXING_ENABLED = 'false'
    const route = require('../app/collections/[slug]/page.tsx')
    const sitemap = require('../app/sitemap.ts').default
    const urls = (await sitemap()).map(e => new URL(e.url).pathname)
    for (const slug of slugs) {
      const props = { params: Promise.resolve({ slug }) }
      const c = commercialCollections.find(x => x.slug === slug)
      const meta = await route.generateMetadata(props)
      assert.equal(meta.alternates.canonical, '/collections/' + slug)
      assert.equal(meta.description, c.description)
      assert.deepEqual(meta.robots, { index: false, follow: false })
      assert.ok(urls.includes('/collections/' + slug))
      const html = renderToStaticMarkup(await route.default(props))
      assert.equal((html.match(/<h1>/g) || []).length, 1)
      assert.ok(html.includes(c.name))
      assert.match(html, /CollectionPage/)
      assert.match(html, /ItemList/)
      for (const sku of members(products, slug)) assert.ok(html.includes('/catalog/fixture-' + sku), sku)
    }
    const decor = renderToStaticMarkup(await route.default({ params: Promise.resolve({ slug: 'culti-decor' }) }))
    assert.ok(decor.includes('href="/collections/diffusers-500-ml"'))
    const mixed = [products[0], products[1], products[2], fixture('other500a', 'Other A', '500 мл', { brand: 'Other' }), fixture('other500b', 'Other B', '500 мл', { brand: 'Other' })]
    source.getCatalogRepository = async () => ({ list: async () => mixed })
    const brand = require('../app/brands/[slug]/page.tsx')
    const brandHtml = renderToStaticMarkup(await brand.default({ params: Promise.resolve({ slug: 'culti-milano' }) }))
    assert.ok(brandHtml.includes('href="/collections/diffusers-500-ml"'))
    assert.equal(new Set(urls).size, urls.length)
    source.getCatalogRepository = async () => ({ list: async () => [products[0]] })
    const reduced = (await sitemap()).map(e => new URL(e.url).pathname)
    for (const slug of slugs) assert.ok(!reduced.includes('/collections/' + slug))
    const missing = await route.generateMetadata({ params: Promise.resolve({ slug: 'culti-decor' }) })
    assert.deepEqual(missing.robots, { index: false, follow: false })
  } finally {
    source.getCatalogRepository = original
    if (indexing === undefined) delete process.env.SEARCH_INDEXING_ENABLED
    else process.env.SEARCH_INDEXING_ENABLED = indexing
  }
})
