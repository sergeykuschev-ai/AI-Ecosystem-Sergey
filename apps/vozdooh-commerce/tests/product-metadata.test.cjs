/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic regression fixtures. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { conciseProductMetadataTitle, conciseProductMetadataDescription, distinctProductMetadataTitle } = require('../src/seo/productMetadata.ts')
const { productPresentation } = require('../src/catalog/presentation.ts')
const fixtures = require('./fixtures/product-metadata.json')

test('long priority and nonpriority title shapes retain complete identity and format', () => {
  const titles = []
  for (const product of fixtures) {
    const display = productPresentation(product)
    const legacyTitles = [
      `${display.title} ${product.trade.volume} — ${product.trade.brand} — купить с доставкой по России | VOZDOOH`,
      `${display.title} · ${product.trade.volume} · ${product.trade.brand} — купить с доставкой по России | VOZDOOH`,
    ]
    const before = JSON.stringify(product)
    for (const legacy of legacyTitles) {
      const result = conciseProductMetadataTitle(product, distinctProductMetadataTitle(product, legacy), display)
      assert.ok(result.includes(display.title))
      assert.ok(result.includes(product.trade.brand))
      assert.ok(result.includes(product.trade.volume))
      if (distinctProductMetadataTitle(product, legacy).length > 95) assert.ok(result.includes(product.trade.category))
      if (product.editorial.slug === 'teatro-dolce-vaniglia-500') assert.match(result, /^Аромадиффузор /)
      if (product.editorial.slug === 'teatro-dolce-vaniglia-refill-500') assert.match(result, /^Рефил /)
      assert.ok(result.length <= 95, `${result.length}: ${result}`)
      assert.doesNotMatch(result, /…|\.\.\./)
      titles.push(result)
    }
    assert.equal(JSON.stringify(product), before)
  }
  assert.notEqual(titles[0], titles[2], 'Teatro diffuser and refill remain distinct')
})

test('short titles and descriptions remain byte-for-byte stable including boundaries', () => {
  const product = fixtures[0]
  const display = productPresentation(product)
  for (const length of [0, 75, 94, 95]) {
    const title = 'x'.repeat(length)
    assert.equal(conciseProductMetadataTitle(product, title, display), title)
  }
  for (const length of [0, 140, 169, 170]) {
    const description = 'x'.repeat(length)
    assert.equal(conciseProductMetadataDescription(product, description, display), description)
  }
})

test('long editorial prose becomes factual complete units, with qualified delivery', () => {
  for (const product of fixtures) {
    const display = productPresentation(product)
    const before = JSON.stringify(product)
    const long = 'Синтетический редакционный текст с очень длинным предложением '.repeat(20)
    const result = conciseProductMetadataDescription(product, long, display, long)
    for (const fact of [display.title, product.trade.brand, product.trade.category, product.trade.volume]) assert.ok(result.includes(fact))
    assert.ok(result.length >= 140 && result.length <= 170, `${result.length}: ${result}`)
    assert.match(result, /В наличии по данным каталога\./)
    assert.match(result, /Доставка в доступные пункты Ozon по России\.$/)
    assert.doesNotMatch(result, /Синтетический|…|\.\.\.|₽/)
    assert.equal(JSON.stringify(product), before)
    for (const stock of [0, -1, null, undefined]) {
      assert.doesNotMatch(conciseProductMetadataDescription({ ...product, trade: { ...product.trade, stock } }, long, display), /В наличии/)
    }
  }
})

test('only a complete fitting sentence is included; oversized identities are kept intact', () => {
  const product = fixtures[2]
  const display = { title: 'TEST', subtitle: 'Свечи · 90 г' }
  const result = conciseProductMetadataDescription(product, 'x'.repeat(171), display, 'Проверенный текст.')
  assert.ok(result.includes('Проверенный текст.'))
  assert.doesNotMatch(result, /Непомещающийся/)
  const longDisplay = { ...display, title: 'ПолноеНазваниеВарианта'.repeat(12) }
  assert.ok(conciseProductMetadataTitle(product, 'x'.repeat(96), longDisplay).includes(longDisplay.title))
  assert.ok(conciseProductMetadataDescription(product, 'x'.repeat(171), longDisplay).includes(longDisplay.title))
  const variant = { ...display, title: 'TEST Colours Green Limited Edition' }
  assert.ok(conciseProductMetadataTitle(product, 'x'.repeat(96), variant).includes(variant.title))
  assert.ok(conciseProductMetadataDescription(product, 'x'.repeat(171), variant).includes(variant.title))
  const abbreviation = 'Редакционный текст, т. е. описание. '.repeat(12)
  assert.doesNotMatch(conciseProductMetadataDescription(product, 'x'.repeat(171), display, abbreviation), /Редакционный/)
})

test('route shares final metadata with Open Graph and preserves demo, H1 and schema wiring', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/catalog/[slug]/page.tsx'), 'utf8')
  assert.match(source, /openGraph: \{ title, description,/)
  assert.ok(source.includes("const description = catalogSource() === 'demo' ? originalDescription"))
  assert.match(source, /conciseProductMetadataDescription\(product, purchaseGuide\?\.description \?\? originalDescription, display,/)
  assert.match(source, /<h1>\{productPageHeading\(product\)\}<\/h1>/)
  assert.ok(source.includes('canonical: `/catalog/${product.editorial.slug}`'))
  assert.ok(source.includes('productStructuredData(product, heroImage)'))
})
