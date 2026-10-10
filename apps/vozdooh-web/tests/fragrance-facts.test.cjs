const test = require('node:test')
const assert = require('node:assert/strict')
const { fragranceFactsFor } = require('../src/catalog/fragranceFacts.ts')

function product(brand, name) {
  return {
    id: 'x', isActive: true,
    trade: { sku: 'x', name, brand, category: 'Диффузоры', volume: '250 мл', price: 1, stock: 1, barcode: null, characteristics: {} },
    editorial: { slug: 'x', description: null, images: [], scentFamily: null, mood: null, room: null, recommendations: [] },
  }
}

test('verified fragrance facts match only the reviewed brand/fragrance pairs', () => {
  const aramara = fragranceFactsFor(product('CULTI MILANO', 'Decor Classic диффузор Aramara 250мл'))
  assert.equal(aramara.name, 'Aramara')
  assert.deepEqual(aramara.notes, ['горький апельсин', 'бергамот', 'сандал'])
  assert.deepEqual(aramara.rooms, ['гостиная', 'кухня', 'кабинет'])

  const tessuto = fragranceFactsFor(product('CULTI MILANO', 'Stile Classic диффузор Tessuto 250мл'))
  assert.equal(tessuto.family, 'цветочное')
  assert.ok(tessuto.notes.includes('белый мускус'))

  const aqqua = fragranceFactsFor(product('CULTI MILANO', 'Decor Classic диффузор Aqqua 250мл'))
  assert.equal(aqqua.created, '1990')
  assert.ok(aqqua.rooms.includes('ванная'))

  const dolce = fragranceFactsFor(product('TEATRO Fragranze Uniche', 'TEATRO Диффузор DOLCE VANIGLIA 500 мл'))
  assert.equal(dolce.name, 'Dolce Vaniglia')
  assert.ok(dolce.notes.includes('бобы тонка'))

  assert.equal(fragranceFactsFor(product('OTHER', 'Aramara 250 мл')), null)
  assert.equal(fragranceFactsFor(product('CULTI MILANO', 'Unknown 250 мл')), null)
})
