/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { demandRank, isExternallyConfirmedPopular, POPULARITY_NOTE } = require('../src/catalog/demandPriority.ts')
const { storefrontProducts } = require('../src/catalog/presentation.ts')

// Render real components with a synthetic repository, without a live server.
const ts = require('typescript')
require.extensions['.tsx'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  })
  module._compile(outputText, filename)
}

const research = JSON.parse(fs.readFileSync('research/demand-evidence-2026-09.json', 'utf8'))

const product = (sku, brand, overrides = {}) => ({
  id: sku,
  trade: { sku, name: sku, brand, category: 'Диффузоры', volume: '250 мл', price: null, characteristics: {} },
  editorial: { slug: `slug-${sku}`, images: ['/catalog/official/test.jpg'], description: 'Verified description', scentFamily: 'woody', mood: null, room: null, recommendations: [], ...overrides },
})

test('internal priority mapping covers exactly the researched TOP-25 with unchanged ranks', () => {
  const ranked = research.products.filter((p) => p.promotion_rank != null).sort((a, b) => a.promotion_rank - b.promotion_rank)
  assert.equal(ranked.length, 25)
  for (const entry of ranked) assert.equal(demandRank(entry.sku), entry.promotion_rank, entry.sku)
  // No extra SKU carries a rank: coverage is exactly the researched ranked set.
  const mapped = research.products.filter((p) => demandRank(p.sku) !== null)
  assert.equal(mapped.length, 25)
  // Every ranked SKU is current positive stock, so priority never promotes unavailable items.
  for (const entry of ranked) assert.ok(entry.stock > 0, entry.sku)
})

test('refuted Bloomingdale’s Thé signal never yields priority or popularity treatment', () => {
  for (const sku of ['46091', '465636', '802e8b01-d19b-11ec-be83-7c8bca00854e']) {
    assert.equal(demandRank(sku), null, sku)
    assert.equal(isExternallyConfirmedPopular(sku), false, sku)
    const entry = research.products.find((p) => p.sku === sku)
    assert.equal(entry.tier, 'NORMAL', sku)
    assert.equal(entry.bestseller_label_eligible, false, sku)
  }
})

test('popularity cue stays limited to the four externally confirmed CORE fragrances', () => {
  const eligible = research.products.filter((p) => p.bestseller_label_eligible).map((p) => p.sku).sort()
  assert.deepEqual(eligible, [
    '802e8ae5-d19b-11ec-be83-7c8bca00854e',
    'bf33a951-016c-11ed-b2a4-7c8bca00854e',
    'df29d344-d192-11ec-be83-7c8bca00854e',
    'df29d346-d192-11ec-be83-7c8bca00854e',
  ].sort())
  for (const sku of eligible) assert.equal(isExternallyConfirmedPopular(sku), true, sku)
  // Aramara/Tessuto lead the queue through verified evidence, STRONG follows.
  assert.ok(demandRank('802e8ae5-d19b-11ec-be83-7c8bca00854e') < demandRank('N020458'))
  assert.ok(demandRank('df29d346-d192-11ec-be83-7c8bca00854e') < demandRank('DANHNIR250DEC'))
  assert.equal(demandRank('BD500TFU'), 12)
  assert.match(POPULARITY_NOTE, /не рейтинг продаж VOZDOOH/)
})

test('default ordering prefers verified priorities, stays deterministic and price-blind', () => {
  const rankedA = product('802e8ae5-d19b-11ec-be83-7c8bca00854e', 'CULTI MILANO', { price: null })
  const rankedB = product('DV250TFU', 'TEATRO Fragranze Uniche', { price: 500000 })
  const unrankedA = product('ZZZ-A', 'CULTI MILANO', { price: 1 })
  const unrankedB = product('ZZZ-B', 'CULTI MILANO', { price: 999999 })
  const list = [unrankedB, rankedB, unrankedA, rankedA]
  const expected = ['802e8ae5-d19b-11ec-be83-7c8bca00854e', 'DV250TFU', 'ZZZ-A', 'ZZZ-B']
  assert.deepEqual(storefrontProducts(list).map((p) => p.trade.sku), expected)
  assert.deepEqual(storefrontProducts(list).map((p) => p.trade.sku), expected)
  // Ranked products keep research order even when the input order flips.
  assert.deepEqual(storefrontProducts([rankedA, rankedB]).map((p) => p.trade.sku), ['802e8ae5-d19b-11ec-be83-7c8bca00854e', 'DV250TFU'])
})

test('price stays unpublished: merchandising and cards never render trade.price', () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  const { ProductCard } = require('../components/ProductCard.tsx')
  const priced = product('LO250TFU', 'TEATRO Fragranze Uniche')
  priced.trade = {
    sku: 'LO250TFU',
    name: 'TEATRO Диффузор с палочками LOVE Luxury collection, 250 мл',
    brand: 'TEATRO Fragranze Uniche',
    category: 'Диффузоры',
    volume: '250 мл',
    price: 123456,
    characteristics: {},
  }
  const cheap = structuredClone(priced)
  cheap.trade.price = 1
  const expensive = renderToStaticMarkup(ProductCard({ product: priced }))
  const inexpensive = renderToStaticMarkup(ProductCard({ product: cheap }))
  assert.equal(expensive, inexpensive)
  assert.doesNotMatch(expensive, /123456|500000|₽|руб/i)
})

test('popularity badge appears only on externally confirmed cards, never for Thé', () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  const { ProductCard } = require('../components/ProductCard.tsx')
  const core = product('802e8ae5-d19b-11ec-be83-7c8bca00854e', 'CULTI MILANO')
  core.trade.name = 'Decor Classic диффузор Aramara 250мл'
  assert.match(renderToStaticMarkup(ProductCard({ product: core })), /Популярный аромат/)
  const strong = product('N020458', 'Lothantique')
  assert.doesNotMatch(renderToStaticMarkup(ProductCard({ product: strong })), /Популярный аромат/)
  for (const sku of ['46091', '465636', '802e8b01-d19b-11ec-be83-7c8bca00854e']) {
    const the = product(sku, 'CULTI MILANO')
    assert.doesNotMatch(renderToStaticMarkup(ProductCard({ product: the })), /Популярный аромат/, sku)
  }
})

test('rendered catalog shows priority order and leaks no internal research labels', async () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  const source = require('../src/catalog/source.ts')
  const originalRepository = source.getCatalogRepository
  const originalSource = source.catalogSource
  const asset = fs.readdirSync('public/catalog/official').find((name) => /\.(jpg|webp|png)$/.test(name))
  assert.ok(asset)
  const ranked = (sku, brand, name) => {
    const item = product(sku, brand)
    item.trade.name = name
    item.editorial.images = [`/catalog/official/${asset}`]
    return item
  }
  const core = ranked('802e8ae5-d19b-11ec-be83-7c8bca00854e', 'CULTI MILANO', 'Decor Classic диффузор Aramara 250мл')
  const strong = ranked('DANHNIR250DEC', 'DANHERA', 'Ароматизатор воздуха NIRO, 250 мл, ТМ DANHERA')
  // Unranked fixtures stay out of the curator section (no description), so first
  // slug occurrences belong to the priority-ordered grid below the curator block.
  const the = ranked('46091', 'CULTI MILANO', 'Спрей для дома The 100 мл')
  the.editorial.description = null
  const plain = ranked('PLAIN-1', 'Castelbel', 'Саше Cotton Flower')
  plain.editorial.description = null
  try {
    source.catalogSource = () => 'staged-1c'
    source.getCatalogRepository = async () => ({ list: async () => [plain, the, strong, core], getBySlug: async () => core })
    const Catalog = require('../app/catalog/page.tsx').default
    const Product = require('../app/catalog/[slug]/page.tsx').default
    const html = renderToStaticMarkup(await Catalog({ searchParams: Promise.resolve({}) }))
    const positions = ['slug-802e8ae5-d19b-11ec-be83-7c8bca00854e', 'slug-DANHNIR250DEC', 'slug-46091', 'slug-PLAIN-1']
      .map((slug) => html.indexOf(slug))
    assert.ok(positions.every((position) => position >= 0), 'all cards rendered')
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'priority order: CORE, STRONG, then unranked')
    assert.doesNotMatch(html, /CORE|STRONG|NORMAL|SLOW|CLEARANCE|promotion_rank|bestseller_label/i)
    const details = renderToStaticMarkup(await Product({ params: Promise.resolve({ slug: 'slug-802e8ae5-d19b-11ec-be83-7c8bca00854e' }), searchParams: Promise.resolve({}) }))
    assert.match(details, /Популярность аромата подтверждена внешними источниками/)
    assert.doesNotMatch(details, /CORE|STRONG|NORMAL|SLOW|CLEARANCE/i)
  } finally {
    source.getCatalogRepository = originalRepository
    source.catalogSource = originalSource
  }
})
