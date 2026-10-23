/* eslint-disable @typescript-eslint/no-require-imports -- Node route metadata regression tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.tsx'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  })
  module._compile(outputText, filename)
}

const source = require('../src/catalog/source.ts')
const product = {
  id: 'synthetic-seo-fixture', isActive: true,
  trade: { sku: 'synthetic-seo-fixture', name: 'Synthetic SEO fixture', brand: null, category: 'Диффузоры', volume: '100 мл', price: 100, stock: 1, barcode: null, characteristics: {} },
  editorial: { sku: 'synthetic-seo-fixture', slug: 'synthetic-seo-fixture', description: 'Synthetic metadata test fixture.', images: ['/brand/vozdooh-horizontal.webp'], recommendations: [] },
}

test('catalog and product internal debug views cannot inherit public indexing', async () => {
  const originalIndexing = process.env.SEARCH_INDEXING_ENABLED
  const originalRepository = source.getCatalogRepository
  const originalSource = source.catalogSource
  source.getCatalogRepository = async () => ({ list: async () => [product], getBySlug: async (slug) => slug === product.editorial.slug ? product : null })
  source.catalogSource = () => 'staged-1c'
  try {
    const Catalog = require('../app/catalog/page.tsx')
    const Product = require('../app/catalog/[slug]/page.tsx')
    const props = (params) => ({ params: Promise.resolve({ slug: product.editorial.slug }), searchParams: Promise.resolve(params) })
    for (const indexing of ['true', 'false']) {
      process.env.SEARCH_INDEXING_ENABLED = indexing
      const expectedPublic = { index: indexing === 'true', follow: indexing === 'true' }
      const cleanCatalog = await Catalog.generateMetadata(props({}))
      const cleanProduct = await Product.generateMetadata(props({}))
      assert.deepEqual(cleanCatalog.robots, expectedPublic)
      assert.deepEqual(cleanProduct.robots, expectedPublic)
      for (const query of [{ debugCatalog: '1' }, { debugCatalog: '1', q: 'synthetic' }, { debugCatalog: '1', brand: 'Synthetic' }]) {
        for (const [route, clean] of [[Catalog, cleanCatalog], [Product, cleanProduct]]) {
          const actual = await route.generateMetadata(props(query))
          assert.deepEqual(actual.robots, { index: false, follow: true }, JSON.stringify({ indexing, query }))
          assert.deepEqual(actual.alternates, clean.alternates)
          assert.equal(actual.title, clean.title)
          assert.equal(actual.description, clean.description)
          assert.deepEqual(actual.openGraph, clean.openGraph)
        }
      }
      for (const query of [{ debugCatalog: '0' }, { debugCatalog: '' }, { debugCatalog: ['1', '0'] }, { brand: 'Synthetic' }, { debugCatalog: 'true' }]) {
        assert.deepEqual((await Catalog.generateMetadata(props(query))).robots, query.brand ? { index: false, follow: true } : expectedPublic)
        assert.deepEqual((await Product.generateMetadata(props(query))).robots, expectedPublic)
      }
      for (const q of ['', 'synthetic', ['synthetic', 'ignored']]) {
        const search = await Catalog.generateMetadata(props({ q }))
        assert.deepEqual(search.robots, { index: false, follow: true })
        assert.deepEqual(search.alternates, { canonical: `/catalog?${new URLSearchParams({ q: Array.isArray(q) ? q[0] : q })}` })
      }
    }
    const originalStock = product.trade.stock
    product.trade.stock = 0
    const unavailable = await Product.generateMetadata(props({}))
    assert.deepEqual(unavailable.robots, { index: false, follow: false })
    product.trade.stock = originalStock
    const missing = await Product.generateMetadata({ params: Promise.resolve({ slug: 'missing' }), searchParams: Promise.resolve({ debugCatalog: '1' }) })
    assert.deepEqual(missing.robots, { index: false, follow: false })
  } finally {
    source.getCatalogRepository = originalRepository
    source.catalogSource = originalSource
    if (originalIndexing === undefined) delete process.env.SEARCH_INDEXING_ENABLED
    else process.env.SEARCH_INDEXING_ENABLED = originalIndexing
  }
})
