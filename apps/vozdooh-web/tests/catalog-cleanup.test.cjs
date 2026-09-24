/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
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
const { renderToStaticMarkup } = require('react-dom/server')
const { stagedTrade, stagedEditorial, inferStagedCategory } = require('../src/catalog/stagedEditorial.ts')
const { mergeCatalog, createCatalogRepository } = require('../src/catalog/repository.ts')
const { productPresentation, storefrontProducts } = require('../src/catalog/presentation.ts')
const { reviewedDescription, reviewedTitle } = require('../src/catalog/reviewedContent.ts')
const { availableLandings, landingProducts, brandLandings, categoryLandings } = require('../src/catalog/landings.ts')
const evidence = require('../research/demand-evidence-2026-09.json')
// The checked-in research contains no prices or private source export.
const trades = evidence.products.map((p) => stagedTrade({ sku: p.sku, name: p.original_name, brand: p.brand, category: p.current_category, volume: p.volume, price: null, stock: p.stock, barcode: null, characteristics: {} }))
const products = mergeCatalog(trades, stagedEditorial(trades))
const bySku = (sku) => products.find((p) => p.trade.sku === sku)

test('format precedence distinguishes refills, accessory boxes and complete sets', () => {
  for (const [name, category] of [
    ['TEATRO Рефилл для диффузора ORO, 500 мл', 'Рефилы'],
    ['Рефил для заправки диффузора The 1000мл', 'Рефилы'],
    ['TEATRO Бокс №12 Черные бамбуковые палочки 36см для диффузора 500мл', 'Аксессуары'],
    ['TEATRO Диффузор с палочками XMAS 250 мл', 'Диффузоры'],
    ['TEATRO Подарочный набор (Диффузор + рефилл)', 'Подарочные наборы'],
    ['Сменный блок ароматизатора SILVERSTONE', 'Для автомобиля'],
  ]) assert.equal(inferStagedCategory(name), category, name)
  assert.equal(bySku('22fimr').trade.category, 'Водорастворимые ароматы')
  assert.equal(bySku('DV500RTFU').trade.category, 'Рефилы')
  for (const sku of ['BAST500NTFU', '08d97776-bb50-11ef-b425-ed110731e4f3', '63a36c45-bb50-11ef-b425-ed110731e4f3', '83763644-bb50-11ef-b425-ed110731e4f3']) {
    assert.equal(bySku(sku).trade.category, 'Аксессуары')
    assert.doesNotMatch(productPresentation(bySku(sku)).subtitle, /мл/)
  }
})

test('reviewed VINOVE and Lamborghini names are exact guarded bindings, not inferred translations', () => {
  for (const [sku, title] of [['N020445', 'Rome · Evolution Excellence'], ['N020438', 'Indianapolis · Leather Espresso'], ['N020434', 'Monza · Leather Ivory'], ['N020325', 'London · Jewelry'], ['0b044a39-8588-11ed-b530-7c8bca00854e', 'Rome · Leather Espresso'], ['65576', 'Automobili Lamborghini']]) {
    const p = bySku(sku)
    const before = structuredClone(p)
    assert.equal(productPresentation(p).title, title)
    assert.equal(productPresentation(p).russianTitle, null)
    assert.deepEqual(p, before)
    for (const change of [{ name: p.trade.name + ' changed' }, { brand: 'Other' }, { sku: 'other' }]) assert.equal(reviewedTitle({ ...p.trade, ...change }), null)
  }
})

test('24 AROMAgroup descriptions are guarded; unverified facts and formats remain explicit', () => {
  const reviewed = trades.filter((trade) => reviewedDescription(trade))
  assert.equal(reviewed.length, 24)
  for (const trade of reviewed) {
    assert.match(reviewedDescription(trade), /Совместимость картриджа уточняется по модели аппарата/)
    assert.equal(reviewedDescription({ ...trade, name: trade.name + ' changed' }), null)
    assert.equal(reviewedDescription({ ...trade, brand: 'Other' }), null)
  }
  for (const sku of ['132689', '4356', '9a227639-b1a0-11ed-a1a3-7c8bca00854e']) assert.equal(reviewedDescription(bySku(sku).trade), null)
  assert.match(bySku('32131').editorial.description, /Совместимость/)
  assert.doesNotMatch(bySku('CAPP-XMTFU').editorial.description, /250|рефилл|корица/)
  assert.doesNotMatch(bySku('N020486').editorial.description, /23|18|мм/)
  assert.equal(bySku('98049E').editorial.description, null)
  assert.match(bySku('344565').editorial.description, /Вариант аромата требует уточнения/)
  assert.doesNotMatch(bySku('344565').editorial.description, /Jet Lag|табак|шафран/i)
  assert.equal(bySku('BD500TFU').trade.category, 'Диффузоры')
  for (const sku of ['N020465', 'V63011']) assert.doesNotMatch(bySku(sku).editorial.description, /отзыв|рейтинг|Allegro|5\/5/i)
})

test('all twelve missing photos and five unknown brands stay unresolved; Aramara variants and TOP-25 survive', () => {
  const missing = evidence.products.filter((p) => !p.quality.image_file_exists)
  assert.equal(missing.length, 12)
  for (const p of missing) assert.deepEqual(bySku(p.sku).editorial.images, [])
  for (const sku of ['445445', '1113', '121211', 'N020486', '0189']) assert.equal(bySku(sku).trade.brand, null)
  const decor = bySku('802e8ae5-d19b-11ec-be83-7c8bca00854e')
  const stile = bySku('df29d344-d192-11ec-be83-7c8bca00854e')
  assert.notEqual(decor.editorial.slug, stile.editorial.slug)
  assert.notDeepEqual(decor.editorial.images, stile.editorial.images)
  assert.match(productPresentation(decor).title, /Decor/)
  assert.match(productPresentation(stile).title, /Stile/)
  assert.deepEqual(storefrontProducts(products).slice(0, 25).map((p) => p.trade.sku), evidence.top_skus)
})

test('discovery uses only positive-stock pictured products and preserves research ordering', () => {
  assert.equal(availableLandings(products, 'brand').length, 12)
  assert.equal(availableLandings(products, 'category').length, 10)
  assert.deepEqual(availableLandings([], 'brand'), [])
  for (const stock of [0, -1, null]) assert.deepEqual(landingProducts([{ ...bySku('N020445'), trade: { ...bySku('N020445').trade, stock } }], 'brand', 'VINOVE'), [])
  for (const list of [brandLandings, categoryLandings]) assert.equal(new Set(list.map((p) => p.slug)).size, list.length)
  for (const kind of ['brand', 'category']) for (const landing of availableLandings(products, kind)) {
    assert.ok(landing.products.every((p) => p.trade.stock > 0 && p.editorial.images.length > 0 && p.trade[kind] === landing.name))
    assert.deepEqual(landing.products, storefrontProducts(landing.products))
  }
})

test('rendered discovery, every landing, product backlinks and metadata retain customer boundaries', async () => {
  const source = require('../src/catalog/source.ts')
  const originalRepository = source.getCatalogRepository
  const originalSource = source.catalogSource
  try {
    source.getCatalogRepository = async () => createCatalogRepository(products)
    source.catalogSource = () => 'staged-1c'
    const Catalog = require('../app/catalog/page.tsx')
    const Product = require('../app/catalog/[slug]/page.tsx')
    const forbidden = /PREVIEW 1C|CORE|STRONG|NORMAL|SLOW|CLEARANCE|promotion_rank|₽|\bRUB\b|Добавить в корзину|фактического остатка 1С/i
    for (const kind of ['brand', 'category']) {
      const plural = kind === 'brand' ? 'brands' : 'categories'
      const Index = require(`../app/${plural}/page.tsx`)
      assert.doesNotMatch(renderToStaticMarkup(await Index.default()), forbidden)
      const Route = require(`../app/${plural}/[slug]/page.tsx`)
      for (const landing of availableLandings(products, kind)) {
        const props = { params: Promise.resolve({ slug: landing.slug }) }
        const html = renderToStaticMarkup(await Route.default(props))
        assert.doesNotMatch(html, forbidden)
        assert.equal((html.match(/<h1>/g) ?? []).length, 1)
        assert.ok(html.includes('/catalog?'))
        const meta = await Route.generateMetadata(props)
        assert.equal(meta.robots.index, false)
        assert.equal(meta.alternates.canonical, `/${plural}/${landing.slug}`)
        assert.ok(meta.description.length > 30)
      }
      await assert.rejects(Route.default({ params: Promise.resolve({ slug: 'unknown' }) }), /NEXT_HTTP_ERROR_FALLBACK;404/)
    }
    const params = { brand: 'TEATRO Fragranze Uniche', category: 'Рефилы', family: 'warm' }
    const html = renderToStaticMarkup(await Catalog.default({ searchParams: Promise.resolve(params) }))
    assert.doesNotMatch(html, forbidden)
    const product = bySku('DV500RTFU')
    const props = { params: Promise.resolve({ slug: product.editorial.slug }), searchParams: Promise.resolve(params) }
    const details = renderToStaticMarkup(await Product.default(props))
    assert.doesNotMatch(details, forbidden)
    const backlink = details.match(/class="productBack" href="([^"]+)"/)[1].replaceAll('&amp;', '&')
    const url = new URL(backlink, 'http://localhost')
    for (const [key, value] of Object.entries(params)) assert.equal(url.searchParams.get(key), value)
    assert.equal((await Product.generateMetadata(props)).alternates.canonical, `/catalog/${product.editorial.slug}`)
  } finally {
    source.getCatalogRepository = originalRepository
    source.catalogSource = originalSource
  }
})
