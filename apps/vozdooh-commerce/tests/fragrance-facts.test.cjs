/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS Node tooling. */
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
  const mareminerale = fragranceFactsFor(product('CULTI MILANO', 'Саше для автомобиля Mareminerale 7х7см'))
  assert.equal(mareminerale.name, 'Mareminerale')
  assert.equal(mareminerale.family, 'ароматическое')
  assert.equal(mareminerale.facet, 'морское')
  assert.deepEqual(mareminerale.notes, ['морской аккорд', 'сок растений', 'минеральный мускус'])
  assert.equal(mareminerale.created, '1997')

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

  const roseOud = fragranceFactsFor(product('TEATRO Fragranze Uniche', 'TEATRO Диффузор ROSE OUD 250 мл'))
  assert.equal(roseOud.name, 'Rose Oud')
  assert.ok(roseOud.notes.includes('дамасская роза'))
  assert.ok(roseOud.notes.includes('уд'))

  const bianco = fragranceFactsFor(product('TEATRO Fragranze Uniche', 'TEATRO Диффузор BIANCO DIVINO 500 мл'))
  assert.equal(bianco.name, 'Bianco Divino')
  assert.ok(bianco.notes.includes('виноград Шампань'))

  const fico = fragranceFactsFor(product('TEATRO Fragranze Uniche', 'TEATRO Диффузор FOGLIE DI FICO 250 мл'))
  assert.equal(fico.name, 'Foglie di Fico')
  assert.deepEqual(fico.rooms, ['кухня', 'столовая', 'веранда'])

  const diamante = fragranceFactsFor(product('TEATRO Fragranze Uniche', 'TEATRO Диффузор DIAMANTE 250 мл'))
  assert.equal(diamante.name, 'Diamante')
  assert.ok(diamante.rooms.includes('спальня'))

  const incenso = fragranceFactsFor(product('TEATRO Fragranze Uniche', 'TEATRO Диффузор INCENSO IMPERIALE 250 мл'))
  assert.equal(incenso.name, 'Incenso Imperiale')
  assert.ok(incenso.notes.includes('ладан'))

  const fiore = fragranceFactsFor(product('TEATRO Fragranze Uniche', 'TEATRO Диффузор FIORE 250 мл'))
  assert.equal(fiore.name, 'Fiore')
  assert.ok(fiore.notes.includes('гардения'))

  const santal = fragranceFactsFor(product('Lothantique', 'Аромадиффузор 200 мл SANDALWOOD САНДАЛ'))
  assert.equal(santal.name, 'Santal')
  assert.equal(santal.family, 'древесное')
  assert.deepEqual(santal.notes, [])
  assert.match(santal.summary, /Мягкий древесный аромат/)

  const antoine = fragranceFactsFor(product('Lothantique', "Аромадиффузор LES SECRETS D'ANTOINE 200 мл"))
  assert.equal(antoine.name, 'Les Secrets d’Antoine')
  assert.equal(antoine.family, 'древесное')
  assert.deepEqual(antoine.notes, ['мандарин', 'розовое дерево', 'мускус'])
  assert.deepEqual(antoine.rooms, [])

  const oudwood = fragranceFactsFor(product('Vellutier', 'Vellutier / Свеча маленькая Удовое дерево 90гр / Oudwood Journey'))
  assert.equal(oudwood.name, 'Oudwood Journey')
  assert.equal(oudwood.family, null)
  assert.deepEqual(oudwood.rooms, [])
  assert.deepEqual(oudwood.notes, ['уд', 'олибанум', 'пачули', 'мускус', 'амбра'])

  const midnight = fragranceFactsFor(product('Vellutier', 'Vellutier / Свеча большая Вечерний тост 515гр / Midnight Toast'))
  assert.equal(midnight.name, 'Midnight Toast')
  assert.ok(midnight.notes.includes('джин-тоник'))
  assert.ok(midnight.notes.includes('тиковое дерево'))

  assert.equal(fragranceFactsFor(product('MAMI MILANO', 'DIAMANTE 200 мл')), null)
  assert.equal(fragranceFactsFor(product('MAMI MILANO', 'ROSE IN FIORE 200 мл')), null)
  assert.equal(fragranceFactsFor(product('OTHER', 'Aramara 250 мл')), null)
  assert.equal(fragranceFactsFor(product('CULTI MILANO', 'Unknown 250 мл')), null)
})
