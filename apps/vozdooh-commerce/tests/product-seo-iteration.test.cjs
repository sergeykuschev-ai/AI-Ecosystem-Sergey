/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const test = require('node:test')
const assert = require('node:assert/strict')
const { stagedTrade, stagedEditorial } = require('../src/catalog/stagedEditorial.ts')
const { fragranceFactsFor } = require('../src/catalog/fragranceFacts.ts')
const { reviewedProductSearchDescription } = require('../src/catalog/productSeo.ts')
const { productStructuredData } = require('../src/catalog/structuredData.ts')

function product(sku, name, stock = 1) {
  const raw = { sku, name, brand: null, category: 'Товар', volume: null, price: 100, stock, barcode: null, characteristics: {} }
  return { id: sku, isActive: true, trade: stagedTrade(raw), editorial: stagedEditorial([raw])[sku] }
}

test('official Vellutier notes reach the snippet and JSON-LD through actual staged normalization', () => {
  const cases = [
    ['V61028', 'Vellutier / Свеча большая В пустыне 515гр / Into the Wilderness', 'Into the Wilderness', ['цитрусовый аккорд', 'красная смородина', 'амбра', 'тиковое дерево']],
    ['V63017', 'Vellutier / Свеча маленькая Старинная библиотека 90гр / Vintege Library', 'Vintage Library', ['тёмный ром', 'опопанакс', 'лабданум', 'бурбонская ваниль', 'индийский сандал']],
  ]
  for (const [sku, name, fragrance, notes] of cases) {
    const item = product(sku, name)
    const facts = fragranceFactsFor(item)
    assert.equal(item.trade.brand, 'Vellutier')
    assert.equal(facts.name, fragrance)
    assert.deepEqual(facts.notes, notes)
    assert.deepEqual(facts.rooms, [])
    assert.equal(facts.family, null)
    const snippet = reviewedProductSearchDescription(item)
    assert.ok(snippet.includes(fragrance))
    assert.match(snippet, /Свечи · (515|90) г/)
    assert.ok(snippet.includes(facts.summary))
    const schema = productStructuredData(item, '/catalog/example.jpg')['@graph'][0]
    assert.equal(schema.description, facts.summary)
    assert.equal(schema.additionalProperty.find(x => x.name === 'Ноты').value, notes.join(', '))
    assert.equal(schema.additionalProperty.some(x => x.name === 'Рекомендуемые пространства'), false)
  }
})

test('matching rejects other brands, near names, accessories and nonpositive stock', () => {
  const item = product('V63017', 'Vellutier / Свеча маленькая / Vintage Library')
  assert.equal(fragranceFactsFor({ ...item, trade: { ...item.trade, brand: 'OTHER' } }), null)
  for (const name of ['Vellutier / Свеча / NotVintage Library', 'Vellutier / Свеча / Vintage Librarybook']) {
    assert.equal(fragranceFactsFor(product('V63017', name)), null)
  }
  assert.equal(fragranceFactsFor(product('V63017', 'Vellutier керамическая ваза Vintage Library')), null)
  for (const stock of [0, -1, null]) {
    const unavailable = product('V63017', item.trade.name, stock)
    assert.equal(fragranceFactsFor(unavailable), null)
    assert.equal(reviewedProductSearchDescription(unavailable), null)
  }
  assert.equal(reviewedProductSearchDescription({ ...item, trade: { ...item.trade, brand: 'OTHER' } }), null)
  assert.equal(reviewedProductSearchDescription(product('unknown', item.trade.name)), null)
})

test('unverified target fragrances use format facts without invented notes or attribution', () => {
  for (const [sku, name, brand, format] of [
    ['N020291', 'Аромадиффузор 250 мл Christian Tortu /TUBEROSE/ ТУБЕРОЗА', 'Christian Tortu', 'Диффузоры'],
    ['N020713', 'Аромадиффузор 250 мл Christian Tortu /TOMATO LEAF/ ТОМАТНЫЙ ЛИСТ', 'Christian Tortu', 'Диффузоры'],
    ['N019873', 'Аромапопурри Christian Tortu /JARDIN CITRUS/ ЦИТРУСОВЫЕ САДЫ', 'Christian Tortu', 'Ароматы для пространства'],
    ['N019834', 'Аромапопурри Christian Tortu /VERT FRAIS/ СВЕЖЕСТЬ ЗЕЛЕНИ', 'Christian Tortu', 'Ароматы для пространства'],
    ['N019836', 'Сменный аромат для аромапопурри 15 мл Christian Tortu/JARDIN CITRUS/ ЦИТРУСОВЫЕ САДЫ', 'Christian Tortu', 'Рефилы'],
    ['N019900', 'Сменный аромат для аромапопурри 15 мл Christian Tortu/VERT FRAIS/ СВЕЖЕСТЬ ЗЕЛЕНИ', 'Christian Tortu', 'Рефилы'],
    ['V61036', 'Vellutier / Свеча большая Сибирский сосновый лес 515гр / Siberian Pine Forest', 'Vellutier', 'Свечи'],
  ]) {
    const item = product(sku, name)
    assert.equal(item.trade.brand, brand)
    assert.equal(item.trade.category, format)
    assert.equal(fragranceFactsFor(item), null)
    assert.equal(item.editorial.scentFamily, null)
    const snippet = reviewedProductSearchDescription(item)
    assert.ok(snippet.includes(item.editorial.description))
    assert.doesNotMatch(snippet, /ноты|официальн|производител|как пахнет/i)
    assert.equal(productStructuredData(item, '/catalog/example.jpg')['@graph'][0].additionalProperty, undefined)
  }
})

test('NIRO retains earlier retailer-supported facts without invented room claims', () => {
  const item = product('DANHNIR250DEC', 'Ароматизатор воздуха NIRO, 250 мл, ТМ DANHERA')
  assert.equal(item.trade.brand, 'DANHERA')
  assert.equal(item.editorial.scentFamily, 'woody')
  assert.equal(item.editorial.room, null)
  const facts = fragranceFactsFor(item)
  assert.equal(facts.name, 'NIRO')
  assert.equal(facts.source, 'карточки Bosco и ЦУМ для NIRO 250 мл')
  assert.deepEqual(facts.rooms, [])
  assert.ok(reviewedProductSearchDescription(item).includes(facts.summary))
})

test('existing stocked Vellutier profiles remain covered and Lothantique stays outside snippet scope', () => {
  for (const [sku, name, fragrance] of [
    ['V63011', 'Vellutier / Свеча маленькая Удовое дерево 90гр / Oudwood Journey', 'Oudwood Journey'],
    ['V61014', 'Vellutier / Свеча большая Вечерний тост 515гр / Midnight Toast', 'Midnight Toast'],
    ['V62014', 'Vellutier / Свеча средняя Вечерний тост 225гр / Midnight Toast', 'Midnight Toast'],
  ]) {
    const item = product(sku, name)
    assert.equal(fragranceFactsFor(item).name, fragrance)
    assert.equal(item.editorial.description, fragranceFactsFor(item).summary)
    assert.ok(reviewedProductSearchDescription(item).includes(fragrance))
  }
  const lothantique = product('N020458', "Аромадиффузор 200 мл/ LES SECRETS D'ANTOINE/ СЕКРЕТЫ АНТУАНА", 2)
  assert.equal(lothantique.trade.brand, 'Lothantique')
  assert.equal(reviewedProductSearchDescription(lothantique), null)
})
