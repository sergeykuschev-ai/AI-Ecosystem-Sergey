/* eslint-disable @typescript-eslint/no-require-imports -- Exact reviewed content binding regression. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { reviewedSiberianPineForest } = require('../src/catalog/siberianPineForest.ts')
const { stagedTrade, stagedEditorial } = require('../src/catalog/stagedEditorial.ts')
const { fragranceFactsFor } = require('../src/catalog/fragranceFacts.ts')
const { reviewedProductSearchDescription } = require('../src/catalog/productSeo.ts')
const { productStructuredData } = require('../src/catalog/structuredData.ts')
const { conciseProductMetadataDescription } = require('../src/seo/productMetadata.ts')
const raw = { sku: 'V61036', name: 'Vellutier / Свеча большая Сибирский сосновый лес 515гр / Siberian Pine Forest', brand: null, category: 'Товар', volume: null, price: 100, stock: 1, barcode: null, characteristics: {} }
const trade = stagedTrade(raw)
const fixture = () => ({ id: trade.sku, isActive: true, trade: structuredClone(trade), editorial: structuredClone(stagedEditorial([trade])[trade.sku]) })

test('only the exact V61036/515 g identity receives manufacturer-backed editorial, snippet and schema', () => {
  const product = fixture()
  const before = JSON.stringify(product.trade)
  const content = reviewedSiberianPineForest(product)
  assert.ok(content)
  assert.equal(product.editorial.description, content.description)
  for (const fact of ['сосна', 'полынь', 'мёд', 'кедр', 'амбра', 'в стекле', '515 г', 'высота 16 см', 'длина 11 см', 'ширина 11 см']) assert.ok(content.description.includes(fact), fact)
  assert.deepEqual(fragranceFactsFor(product).notes, ['сосна', 'травы', 'зелёные листья', 'полынь', 'мёд', 'кедр', 'древесные ноты', 'амбра'])
  const snippet = reviewedProductSearchDescription(product)
  assert.equal(snippet, content.metadataDescription)
  assert.ok(snippet.length <= 170)
  assert.equal(conciseProductMetadataDescription(product, snippet, { title: 'Siberian Pine Forest', subtitle: 'Свечи · 515 г' }), snippet)
  const schema = productStructuredData(product, '/catalog/official/V61036.jpg')['@graph'][0]
  assert.equal(schema.description, content.description)
  assert.equal(schema.sku, 'V61036')
  assert.equal(schema.offers.price, '100.00')
  assert.equal(schema.offers.availability, 'https://schema.org/InStock')
  assert.ok(schema.additionalProperty.some(p => p.name === 'Ноты' && p.value.includes('полынь')))
  assert.equal(JSON.stringify(product.trade), before)
})

test('wrong SKU, slug, brand, format, name and size cannot inherit reviewed candle facts', () => {
  const product = fixture()
  for (const patch of [{ sku: 'V62036' }, { sku: 'V63036' }, { brand: 'Other' }, { category: 'Рефилы' },
    { volume: null }, { volume: '225 г' }, { volume: '515 мл' }, { name: 'Siberian Pine Forest' },
    { name: raw.name + ' другой аромат' }]) {
    const changed = { ...product, trade: { ...product.trade, ...patch } }
    assert.equal(reviewedSiberianPineForest(changed), null)
    assert.equal(fragranceFactsFor(changed), null)
    assert.notEqual(reviewedProductSearchDescription(changed), reviewedSiberianPineForest(product).metadataDescription)
    assert.doesNotMatch(stagedEditorial([changed.trade])[changed.trade.sku].description ?? '', /высота 16 см|в сердце — мёд/)
  }
  const wrongSlug = { ...product, editorial: { ...product.editorial, slug: 'vellutier-siberian-pine-forest-225' } }
  assert.equal(reviewedSiberianPineForest(wrongSlug), null)
  assert.equal(fragranceFactsFor(wrongSlug), null)
  assert.notEqual(reviewedProductSearchDescription(wrongSlug), reviewedSiberianPineForest(product).metadataDescription)
})

test('actual server page and metadata render the reviewed text; an absent SKU cannot reuse its route', async () => {
  const { readFileSync } = require('node:fs')
  const ts = require('typescript')
  require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText, filename)
  const source = require('../src/catalog/source.ts')
  const { createCatalogRepository } = require('../src/catalog/repository.ts')
  const originalRepository = source.getCatalogRepository
  const originalSource = source.catalogSource
  const originalIndexing = process.env.SEARCH_INDEXING_ENABLED
  const product = fixture()
  source.getCatalogRepository = async () => createCatalogRepository([product])
  source.catalogSource = () => 'staged-1c'
  process.env.SEARCH_INDEXING_ENABLED = 'true'
  try {
    const page = require('../app/catalog/[slug]/page.tsx')
    const props = { params: Promise.resolve({ slug: product.editorial.slug }), searchParams: Promise.resolve({}) }
    const metadata = await page.generateMetadata(props)
    assert.equal(metadata.description, reviewedSiberianPineForest(product).metadataDescription)
    assert.equal(metadata.openGraph.description, metadata.description)
    assert.equal(metadata.alternates.canonical, '/catalog/vellutier-siberian-pine-forest-515')
    assert.deepEqual(metadata.robots, { index: true, follow: true })
    const { renderToStaticMarkup } = require('react-dom/server')
    const html = renderToStaticMarkup(await page.default(props))
    assert.equal((html.match(/<h1>/g) || []).length, 1)
    assert.ok(html.includes(product.editorial.description))
    assert.ok(html.includes('высота 16 см'))
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1])['@graph'][0]
    assert.equal(schema.description, product.editorial.description)
    assert.equal(schema.sku, 'V61036')
    source.getCatalogRepository = async () => createCatalogRepository([])
    assert.deepEqual((await page.generateMetadata(props)).robots, { index: false, follow: false })
    await assert.rejects(page.default(props), /NEXT_HTTP_ERROR_FALLBACK;404/)
  } finally {
    source.getCatalogRepository = originalRepository
    source.catalogSource = originalSource
    if (originalIndexing === undefined) delete process.env.SEARCH_INDEXING_ENABLED
    else process.env.SEARCH_INDEXING_ENABLED = originalIndexing
  }
})
