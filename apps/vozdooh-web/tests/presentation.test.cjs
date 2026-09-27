/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { productPresentation, storefrontProducts, curatorSelection, isDebugCatalog, catalogImage } = require('../src/catalog/presentation.ts')
const { catalogHref } = require('../src/catalog/filterParams.ts')
const { applyCatalogFilters } = require('../src/catalog/filters.ts')
const product = (name, brand = 'TEATRO Fragranze Uniche') => ({
  id: name, trade: { name, brand, category: 'Диффузоры', volume: '250 мл' },
  editorial: { images: ['/catalog/official/test.jpg'], description: 'Verified description', scentFamily: 'woody' },
})
test('display titles remove only known formatting and preserve source facts', () => {
  const item = product('TEATRO Диффузор с палочками ROSE OUD / Роза & Уд Luxury collection, 250 мл')
  const before = structuredClone(item)
  assert.equal(productPresentation(item).title, 'ROSE OUD')
  assert.match(productPresentation(item).subtitle, /250 мл/)
  assert.deepEqual(item, before)
  for (const [name, brand, expected] of [
    ['Decor Classic диффузор Aramara 1000 мл', 'CULTI MILANO', 'Decor Classic Aramara'],
    ['Бербери картридж AG 150мл пласт.', 'AROMAgroup', 'Бербери'],
    ['Неизвестный аромат', null, 'Неизвестный аромат'],
    ['Аромадиффузор 250 мл Christian Tortu /TUBEROSE/ ТУБЕРОЗА', 'Christian Tortu', 'TUBEROSE'],
    ['TEATRO', 'TEATRO', 'TEATRO'],
    ['Hydro/концентрат для арома лампы Цветок мимозы 15 ml', 'Millefiori Milano', 'Цветок мимозы'],
  ]) assert.equal(productPresentation(product(name, brand)).title, expected)
})
test('default hides missing images; exact debug opt-in retains records and filter semantics', () => {
  const pictured = product('Pictured')
  const missing = product('Missing', 'Other')
  missing.editorial.images = []
  const products = [missing, pictured]
  assert.deepEqual(storefrontProducts(products), [pictured])
  assert.equal(storefrontProducts(products, true).length, 2)
  assert.equal(products.length, 2)
  for (const debugCatalog of [undefined, '0', 'true', ['1']]) assert.equal(isDebugCatalog({ debugCatalog }), false)
  assert.equal(isDebugCatalog({ debugCatalog: '1' }), true)
  for (const image of ['https://example.com/photo.jpg', '//example.com/photo.jpg', '/../../secret.jpg', '/image.svg', '']) {
    assert.equal(catalogImage({ ...pictured, editorial: { images: [image] } }), null)
  }
  const filters = { brand: 'Other', category: null, family: 'woody', mood: null, room: null }
  assert.equal(applyCatalogFilters(storefrontProducts(products), filters).length, 0)
  assert.equal(applyCatalogFilters(storefrontProducts(products, true), filters).length, 1)
  const url = new URL(catalogHref(filters, 'brand', null, true), 'http://localhost')
  assert.equal(url.searchParams.get('family'), 'woody')
  assert.equal(url.searchParams.get('brand'), null)
  assert.equal(url.searchParams.get('debugCatalog'), '1')
  assert.equal(catalogHref(filters, 'family', null).includes('debugCatalog'), false)
})
test('curator selection requires editorial metadata and is deterministic and brand-diverse', () => {
  const culti = product('Culti', 'CULTI MILANO')
  const teatro = product('Teatro')
  const other = product('Other', 'Other')
  other.editorial.description = null
  const products = [other, teatro, culti, product('Second Culti', 'CULTI MILANO')]
  assert.deepEqual(curatorSelection(products), [culti, teatro])
  assert.deepEqual(curatorSelection(products), curatorSelection(products))
  assert.equal(storefrontProducts(products).length, 4)
})

test('asset validation excludes nonexistent files without mutating editorial records', async () => {
  const { withValidImages } = require('../src/catalog/validImages.ts')
  const item = product('Missing file')
  const before = structuredClone(item)
  const checked = await withValidImages([item])
  assert.deepEqual(checked[0].editorial.images, [])
  assert.deepEqual(item, before)
})

// Render the real server pages with a synthetic repository, without a live server.
const ts = require('typescript')
const fs = require('node:fs')
require.extensions['.tsx'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  })
  module._compile(outputText, filename)
}

test('rendered catalog and product pages hide source noise and preserve debug/filter navigation', async () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  const source = require('../src/catalog/source.ts')
  const originalRepository = source.getCatalogRepository
  const originalSource = source.catalogSource
  const asset = fs.readdirSync('public/catalog/official').find((name) => /\.(jpg|webp|png)$/.test(name))
  assert.ok(asset)
  const pictured = product('TEATRO Диффузор с палочками ROSE OUD / Роза & Уд Luxury collection, 250 мл')
  pictured.trade = { ...pictured.trade, sku: 'ROU250TFU', characteristics: {}, price: null }
  pictured.editorial = { ...pictured.editorial, images: [`/catalog/official/${asset}`], slug: 'test-pictured', recommendations: [] }
  const missing = structuredClone(pictured)
  missing.id = 'missing'
  missing.trade.sku = 'TEST-MISSING'
  missing.editorial.slug = 'test-missing'
  missing.editorial.images = []
  try {
    source.catalogSource = () => 'staged-1c'
    source.getCatalogRepository = async () => ({ list: async () => [pictured, missing], getBySlug: async () => pictured })
    const Catalog = require('../app/catalog/page.tsx').default
    const Product = require('../app/catalog/[slug]/page.tsx').default
    const normal = renderToStaticMarkup(await Catalog({ searchParams: Promise.resolve({}) }))
    assert.doesNotMatch(normal, /PREVIEW 1C|Пока не в продаже|Фото ожидается|test-missing/)
    assert.match(normal, /Кураторский выбор/)
    assert.match(normal, /<details class="filterDisclosure">/)
    assert.match(normal, /name="brand"/)
    const debug = renderToStaticMarkup(await Catalog({ searchParams: Promise.resolve({ debugCatalog: '1', brand: pictured.trade.brand }) }))
    assert.match(debug, /test-missing\?debugCatalog=1/)
    assert.match(debug, /PREVIEW 1C/)
    assert.match(debug, /name="debugCatalog" value="1"/)
    assert.match(debug, /Убрать фильтр Бренд/)
    const details = renderToStaticMarkup(await Product({ params: Promise.resolve({ slug: 'test-pictured' }), searchParams: Promise.resolve({}) }))
    assert.doesNotMatch(details, /PREVIEW 1C|Пока не в продаже|Добавить в корзину/)
    assert.match(details, /Роза &amp; Уд Luxury collection, 250 мл/)
    assert.match(details, /<h1>ROSE OUD<\/h1><p class="productTranslation">Роза и уд<\/p>/)
    assert.match(normal, /class="productTranslation">Роза и уд/)
    assert.match(details, /Verified description/)
    assert.match(details, /Цена не указана/)
    assert.doesNotMatch(normal, /value="fresh"/)
    pictured.trade.price = 1234.5
    pictured.trade.stock = 2
    const purchasable = renderToStaticMarkup(await Product({ params: Promise.resolve({ slug: 'test-pictured' }), searchParams: Promise.resolve({}) }))
    assert.match(purchasable, /Добавить в корзину/)
    assert.match(purchasable, /В наличии по данным каталога/)
    assert.ok(purchasable.indexOf('productPurchase') < purchasable.indexOf('productDesc'))
    pictured.trade.stock = 0
    const unavailable = renderToStaticMarkup(await Product({ params: Promise.resolve({ slug: 'test-pictured' }), searchParams: Promise.resolve({}) }))
    assert.match(unavailable, /Нет в наличии/)
    assert.doesNotMatch(unavailable, /Добавить в корзину/)
    source.getCatalogRepository = async () => ({ list: async () => [pictured, missing], getBySlug: async () => missing })
    await assert.rejects(() => Product({ params: Promise.resolve({ slug: 'test-missing' }), searchParams: Promise.resolve({}) }), /NEXT_HTTP_ERROR_FALLBACK;404/)


  } finally {
    source.getCatalogRepository = originalRepository
    source.catalogSource = originalSource
  }
})

const { confirmedProductTranslations } = require('../src/catalog/productTranslations.ts')
test('all confirmed bindings preserve trade data and reject unreviewed matches', () => {
  assert.equal(confirmedProductTranslations.length, 7)
  for (const entry of confirmedProductTranslations) for (const binding of entry.products) {
    const item = product(binding.name, entry.brands[0])
    item.trade.sku = binding.sku
    const before = structuredClone(item)
    const display = productPresentation(item)
    assert.equal(display.title, entry.original)
    assert.equal(display.russianTitle, entry.russian)
    assert.match(display.subtitle, /250 мл/)
    assert.deepEqual(item, before)
    for (const changed of [
      { ...item.trade, sku: 'UNKNOWN' },
      { ...item.trade, name: item.trade.name + ' new' },
      { ...item.trade, brand: 'Other' },
    ]) assert.equal(productPresentation({ ...item, trade: changed }).russianTitle, null)
  }
  for (const name of ['BIANCO DIVINO', 'ERA', 'THÉ', 'MAREMINERALE', 'PATCHOULOVE', 'Unknown / Самовольный перевод']) {
    const display = productPresentation(product(name))
    assert.equal(display.russianTitle, null)
    assert.equal(display.title, name.split('/')[0].trim())
  }
})
test('real cards place confirmed translation below original and above type/volume', () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  const { ProductCard } = require('../components/ProductCard.tsx')
  for (const entry of confirmedProductTranslations) {
    const binding = entry.products[0]
    const item = product(binding.name, entry.brands[0])
    item.trade.sku = binding.sku
    item.editorial.slug = 'synthetic-product'
    const html = renderToStaticMarkup(ProductCard({ product: item }))
    assert.ok(html.includes(`<h3>${entry.original}</h3><p class="productTranslation">${entry.russian}</p><p>`))
    assert.match(html, /250 мл/)
    item.trade.sku = 'UNKNOWN'
    assert.doesNotMatch(renderToStaticMarkup(ProductCard({ product: item })), /class="productTranslation"/)
  }
})

test('filter options use supplied catalog data and reviewed vocabulary without changing order', () => {
  const { availableFilterOptions } = require('../src/catalog/filters.ts')
  const items = [product('First'), product('Second')]
  items[1].editorial.scentFamily = 'unreviewed'
  const before = structuredClone(items)
  assert.deepEqual(availableFilterOptions(items, 'family', { woody: 'Древесный', fresh: 'Свежий' }), [{ value: 'woody', label: 'Древесный' }])
  assert.deepEqual(availableFilterOptions([], 'family', { woody: 'Древесный' }), [])
  assert.deepEqual(items, before)
  const filters = { brand: 'TEATRO Fragranze Uniche', category: null, family: 'woody', mood: null, room: null }
  const parsed = require('../src/catalog/filterParams.ts').parseCatalogFilters(Object.fromEntries(new URL(catalogHref(filters, 'category', 'Диффузоры'), 'http://local').searchParams), { 'Диффузоры': 'Диффузоры' }, { 'TEATRO Fragranze Uniche': 'TEATRO' })
  assert.deepEqual(parsed, { ...filters, category: 'Диффузоры' })
  assert.deepEqual(applyCatalogFilters(items, { ...filters, family: null }), items)
})

test('cleanup preserves whole words and accessory object phrases', () => {
  for (const color of ['Черные', 'Натуральные']) for (const [count, length, volume] of [[10, 30, 250], [12, 36, 500]]) {
    const text = `Бокс №${count} ${color} бамбуковые палочки ${length}см для диффузора ${volume}мл`
    const item = product(`TEATRO ${text}`)
    item.trade.category = 'Аксессуары'
    assert.equal(productPresentation(item).title, text)
    assert.equal(productPresentation(item).subtitle, 'Аксессуары')
  }
  for (const [name, brand, expected] of [
    ['Керамическая ваза для аромапопурри Christian Tortu', 'Christian Tortu', 'Керамическая ваза для аромапопурри'],
    ['Чехол для диффузора', null, 'Чехол для диффузора'],
    ['Супердиффузор и аромадиффузорный', null, 'Супердиффузор и аромадиффузорный'],
    ['Диффузор,  TEST  250 мл.', null, 'TEST'],
  ]) assert.equal(productPresentation(product(name, brand)).title, expected)
})

test('brand navigation is exact, stocked, pictured, ordered and never supplements editorial links', () => {
  const { sameBrandProducts } = require('../src/catalog/presentation.ts')
  const make = (sku, brand = 'Exact') => ({ ...product(sku, brand), id: sku, isActive: true,
    trade: { ...product(sku, brand).trade, sku, stock: 1 }, editorial: { ...product(sku).editorial, slug: sku, recommendations: [] } })
  const current = make('current')
  const items = ['z', 'c', 'a', 'b'].map((sku) => make(sku))
  const noImage = make('no-image'); noImage.editorial.images = []
  const noStock = make('no-stock'); noStock.trade.stock = 0
  const inactive = make('inactive'); inactive.isActive = false
  const input = [current, ...items, noImage, noStock, inactive, make('different', 'exact')]
  const before = structuredClone(input)
  assert.deepEqual(sameBrandProducts(input, current).map((p) => p.id), ['a', 'b', 'c'])
  assert.deepEqual(input, before)
  current.editorial.recommendations = ['unavailable-target']
  assert.deepEqual(sameBrandProducts(input, current), [])
  current.editorial.recommendations = []; current.trade.brand = null
  assert.deepEqual(sameBrandProducts(input, current), [])
  assert.deepEqual(sameBrandProducts([], make('only')), [])
})

test('cards show exact positive RUB prices and suppress missing/nonpositive/demo prices', () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  const { ProductCard } = require('../components/ProductCard.tsx')
  const item = product('Synthetic'); item.editorial.slug = 'synthetic'
  for (const price of [1, 1234.56, 1000000]) {
    item.trade.price = price
    const html = renderToStaticMarkup(ProductCard({ product: item }))
    assert.ok(html.includes(new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(price)))
    assert.match(html, /productCardPrice/)
    assert.doesNotMatch(renderToStaticMarkup(ProductCard({ product: item, demo: true })), /productCardPrice/)
  }
  for (const price of [null, 0, -1]) {
    item.trade.price = price
    assert.doesNotMatch(renderToStaticMarkup(ProductCard({ product: item })), /productCardPrice/)
  }
})

test('quality audit flags mechanical anomalies without altering text', () => {
  const { titleAnomalies } = require('../scripts/catalog-quality.cjs')
  for (const text of ['Бокс для а', 'Ваза для', 'Текст,', 'Два  пробела']) assert.ok(titleAnomalies(text).length)
  for (const text of ['Ваза для аромапопурри', 'Диффузоры · 250 мл', 'В пустыне']) assert.deepEqual(titleAnomalies(text), [])
})
