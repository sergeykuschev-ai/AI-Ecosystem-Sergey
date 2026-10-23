/* eslint-disable @typescript-eslint/no-require-imports -- Inventory-backed copy contracts. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { landingSearchDescription } = require('../src/seo/landingCopy.ts')
test('brand snippet mentions only stocked formats and distinct category guidance', () => {
  const landing = { name: 'Synthetic brand', guidance: 'Compare size and intended use.' }
  const text = landingSearchDescription(landing, [{ trade: { stock: 1, category: 'Диффузоры' } }, { trade: { stock: 0, category: 'Свечи' } }], 'brand')
  assert.match(text, /Synthetic brand.*Диффузоры/); assert.doesNotMatch(text, /Свечи/)
  assert.match(text, /доступные пункты Ozon/);assert.match(text, /Бесплатный самовывоз в Хабаровске/)
  assert.match(landingSearchDescription(landing, [], 'category'), /Compare size and intended use/)
  assert.doesNotMatch(text, /бесплатная доставка|вся Россия|гарантирован|завтра/)
})
test('delivery copy matches online checkout, separate delivery payment and free fixed pickup', () => {
  const text = fs.readFileSync(require('node:path').join(__dirname, '../app/delivery/page.tsx'), 'utf8')
  assert.match(text, /canonical: '\/delivery'/);assert.match(text, /publicRobots\(\)/)
  assert.match(text, /Павла Морозова, 97/);assert.match(text, /Бесплатный самовывоз/)
  assert.match(text, /заказ ожидает оплаты товаров через Ozon Pay/)
  assert.match(text, /Сохранённый заказ ещё не означает подтверждённую оплату или резерв/)
  assert.doesNotMatch(text, /Сейчас магазин работает в режиме заявок|До завершения этой интеграции|доставка за 1 день/)
})
