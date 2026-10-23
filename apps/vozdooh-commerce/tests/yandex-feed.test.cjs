/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const { buildYandexYml } = require('../src/integrations/yandexFeed.ts')

function product({ sku = 'SKU-1', stock = 2, price = 7900, image = '/catalog/official/feed-test.jpg' } = {}) {
  return {
    id: sku,
    isActive: true,
    trade: { sku, name: 'Диффузор TEST Brand 250 мл', brand: 'TEST Brand', category: 'Диффузоры', volume: '250 мл', price, stock, barcode: null, characteristics: {} },
    editorial: { slug: `item-${sku.toLowerCase()}`, description: 'Тестовое описание без рекламных обещаний.', images: [image], scentFamily: null, mood: null, room: null, recommendations: [] },
  }
}

test('Yandex YML uses the catalog SKU as offer id and current price/availability', () => {
  const yml = buildYandexYml([product()], 'https://vozdooh27.ru', new Date('2026-10-07T12:34:00Z'))
  assert.match(yml, /<offer id="SKU-1" available="true">/)
  assert.match(yml, /<price>7900<\/price>/)
  assert.match(yml, /<currencyId>RUB<\/currencyId>/)
  assert.match(yml, /<url>https:\/\/vozdooh27\.ru\/catalog\/item-sku-1<\/url>/)
  assert.match(yml, /<picture>https:\/\/vozdooh27\.ru\/catalog\/official\/feed-test\.jpg<\/picture>/)
})

test('Yandex YML omits unavailable products and too-small ad pictures', () => {
  const yml = buildYandexYml([
    product({ sku: 'GOOD', image: '/catalog/official/09877.jpg' }),
    product({ sku: 'ZERO', stock: 0 }),
  ], 'https://vozdooh27.ru', new Date('2026-10-07T12:34:00Z'))
  assert.match(yml, /<offer id="GOOD"/)
  assert.doesNotMatch(yml, /<offer id="ZERO"/)
  assert.doesNotMatch(yml, /<picture>[^<]*09877\.jpg<\/picture>/)
})
