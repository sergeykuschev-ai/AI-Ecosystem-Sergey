/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { noteCollections } = require('../src/catalog/collections.ts')
const { noteEvidence } = require('../src/catalog/verifiedNotes.ts')
const fixture = (sku, slug, name, overrides = {}) => ({
  id: sku, isActive: true,
  trade: { sku, name, brand: 'Vellutier', category: 'Свечи', volume: '90 г', price: 100, stock: 1, barcode: null, characteristics: {}, ...overrides },
  editorial: { slug, images: ['/brand/vozdooh-horizontal.webp'], description: null, scentFamily: null, mood: null, room: null, recommendations: [] },
})
const library = fixture('V63017', 'vellutier-vintage-library-90', 'Vellutier Vintage Library 90гр')
const oud = fixture('V63011', 'vellutier-oudwood-journey-90', 'Vellutier Oudwood Journey 90гр')

test('absent note routes return noindex metadata and 404, never appear in sitemap', async () => {
  const ts = require('typescript')
  require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText, filename)
  const source = require('../src/catalog/source.ts')
  const original = source.getCatalogRepository
  const originalIndexing = process.env.SEARCH_INDEXING_ENABLED
  source.getCatalogRepository = async () => ({ list: async () => [library, oud] })
  try {
    const route = require('../app/collections/[slug]/page.tsx')
    const sitemap = require('../app/sitemap.ts').default
    const urls = (await sitemap()).map(item => new URL(item.url).pathname)
    for (const collection of noteCollections) {
      const props = { params: Promise.resolve({ slug: collection.slug }) }
      const metadata = await route.generateMetadata(props)
      assert.deepEqual(metadata.robots, { index: false, follow: false })
      assert.equal(metadata.alternates, undefined)
      assert.ok(!urls.includes('/collections/' + collection.slug))
      await assert.rejects(route.default(props), /NEXT_HTTP_ERROR_FALLBACK;404/)
    }
    const { renderToStaticMarkup } = require('react-dom/server')
    const culti = noteEvidence.filter(e => e.brand === 'CULTI MILANO').map(e => fixture(e.sku, e.slug, e.aliases[0], {
      brand: e.brand, category: e.category, volume: e.volume + ' мл',
    }))
    source.getCatalogRepository = async () => ({ list: async () => culti })
    process.env.SEARCH_INDEXING_ENABLED = 'true'
    const enabledUrls = (await sitemap()).map(item => new URL(item.url).pathname)
    for (const slug of ['notes-bergamot', 'notes-sandalwood']) {
      const props = { params: Promise.resolve({ slug }) }
      const metadata = await route.generateMetadata(props)
      assert.equal(metadata.alternates.canonical, '/collections/' + slug)
      assert.deepEqual(metadata.robots, { index: true, follow: true })
      assert.ok(enabledUrls.includes('/collections/' + slug))
      const html = renderToStaticMarkup(await route.default(props))
      assert.equal((html.match(/<h1>/g) || []).length, 1)
      assert.ok(html.includes(noteCollections.find(c => c.slug === slug).name))
      assert.match(html, /CollectionPage/)
      assert.match(html, /ItemList/)
      for (const product of culti) assert.ok(html.includes('/catalog/' + product.editorial.slug))
      assert.ok(!html.includes('/collections/notes-vanilla'))
    }
    const metas = await Promise.all(['notes-bergamot', 'notes-sandalwood'].map(slug => route.generateMetadata({ params: Promise.resolve({ slug }) })))
    assert.notEqual(metas[0].title, metas[1].title)
    assert.notEqual(metas[0].description, metas[1].description)
    const { SeasonalGifts } = require('../components/SeasonalGifts.tsx')
    assert.equal(renderToStaticMarkup(SeasonalGifts({ products: [] })), '')
    const gift = fixture('CAND-XM180', 'teatro-xmas-candle-180', 'TEATRO XMAS', { brand: 'TEATRO Fragranze Uniche' })
    const html = renderToStaticMarkup(SeasonalGifts({ products: [gift] }))
    assert.match(html, /Подарки к зимним праздникам/)
    assert.match(html, /\/catalog\/teatro-xmas-candle-180/)
    assert.ok(!html.includes('<h1'))
  } finally {
    source.getCatalogRepository = original
    if (originalIndexing === undefined) delete process.env.SEARCH_INDEXING_ENABLED
    else process.env.SEARCH_INDEXING_ENABLED = originalIndexing
  }
})
