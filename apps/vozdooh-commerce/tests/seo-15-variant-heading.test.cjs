/* Synthetic catalog records: only reviewed SKU/name identity facts are reused. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const { productPageHeading, productPresentation } = require('../src/catalog/presentation.ts')
const { productStructuredData } = require('../src/catalog/structuredData.ts')
const { inferStagedBrand, inferStagedCategory, inferStagedVolume } = require('../src/catalog/stagedEditorial.ts')
// Reviewed synthetic rows copied from the prior read-only fixture; no JSON fixture dependency.
const variants = [
  {
    "group": "TEATRO CERESIA",
    "sku": "8c80d0e5-231d-11ef-b412-e92179844ed4",
    "name": "TEATRO Диффузор с палочками CERESIA / Черезия, 250 мл",
    "volume": "250 мл",
    "suffix": "диффузор с палочками 250 мл"
  },
  {
    "group": "TEATRO CERESIA",
    "sku": "CE500TFU.23",
    "name": "TEATRO Диффузор с палочками CERESIA / Черезия, 500 мл",
    "volume": "500 мл",
    "suffix": "диффузор с палочками 500 мл"
  },
  {
    "group": "TEATRO DOLCE VANIGLIA",
    "sku": "DV250TFU",
    "name": "TEATRO Диффузор с палочками DOLCE VANIGLIA / Сладкая ваниль, 250 мл",
    "volume": "250 мл",
    "suffix": "диффузор с палочками 250 мл"
  },
  {
    "group": "TEATRO DOLCE VANIGLIA",
    "sku": "655467",
    "name": "TEATRO Диффузор с палочками DOLCE VANIGLIA / Сладкая ваниль, 500 мл",
    "volume": "500 мл",
    "suffix": "диффузор с палочками 500 мл"
  },
  {
    "group": "TEATRO DOLCE VANIGLIA",
    "sku": "DV500RTFU",
    "name": "TEATRO Рефилл для диффузора DOLCE VANIGLIA / Сладкая ваниль, 500 мл",
    "volume": "500 мл",
    "suffix": "рефилл для диффузора 500 мл"
  },
  {
    "group": "Christian Tortu JARDIN CITRUS",
    "sku": "N019873",
    "name": "Аромапопурри Christian Tortu /JARDIN CITRUS/ ЦИТРУСОВЫЕ САДЫ",
    "volume": null,
    "suffix": "аромапопурри"
  },
  {
    "group": "Christian Tortu JARDIN CITRUS",
    "sku": "N019836",
    "name": "Сменный аромат для аромапопурри 15 мл Christian Tortu/JARDIN CITRUS/ ЦИТРУСОВЫЕ САДЫ",
    "volume": "15 мл",
    "suffix": "сменный аромат для аромапопурри 15 мл"
  },
  {
    "group": "MAMI NUVOLA DI COTONE",
    "sku": "MF-FRAGR2.06",
    "name": "MAMI MILANO Диффузор с палочками NUVOLA DI COTONE / Хлопковое облако. Коллекция PALAZZO, 200 мл",
    "volume": "200 мл",
    "suffix": "диффузор с палочками 200 мл"
  },
  {
    "group": "MAMI NUVOLA DI COTONE",
    "sku": "MF-REFILL.06",
    "name": "MAMI MILANO Рефилл для диффузора NUVOLA DI COTONE / Хлопковое облако. Коллекция PALAZZO, 250 мл",
    "volume": "250 мл",
    "suffix": "рефилл для диффузора 250 мл"
  },
  {
    "group": "TEATRO ROSE OUD",
    "sku": "ROU250TFU",
    "name": "TEATRO Диффузор с палочками ROSE OUD / Роза & Уд Luxury collection, 250 мл",
    "volume": "250 мл",
    "suffix": "диффузор с палочками 250 мл"
  },
  {
    "group": "TEATRO ROSE OUD",
    "sku": "CAND-ROU180",
    "name": "TEATRO Ароматическая свеча ROSE OUD / Роза & Уд Luxury Сollection, 180 г",
    "volume": "180 г",
    "suffix": "свеча 180 г"
  },
  {
    "group": "CULTI The",
    "sku": "465636",
    "name": "Рефил для заправки диффузора The 1000мл",
    "volume": "1000 мл",
    "suffix": "рефилл для диффузора 1000 мл"
  },
  {
    "group": "CULTI The",
    "sku": "46091",
    "name": "Спрей для дома  The 100 мл",
    "volume": "100 мл",
    "suffix": "спрей для дома 100 мл"
  },
  {
    "group": "Christian Tortu VERT FRAIS",
    "sku": "N019834",
    "name": "Аромапопурри Christian Tortu /VERT FRAIS/ СВЕЖЕСТЬ ЗЕЛЕНИ",
    "volume": null,
    "suffix": "аромапопурри"
  },
  {
    "group": "Christian Tortu VERT FRAIS",
    "sku": "N019900",
    "name": "Сменный аромат для аромапопурри 15 мл Christian Tortu/VERT FRAIS/ СВЕЖЕСТЬ ЗЕЛЕНИ",
    "volume": "15 мл",
    "suffix": "сменный аромат для аромапопурри 15 мл"
  },
  {
    "group": "MAMI VIA DELLE SPEZIE",
    "sku": "MF-FRAGR2.12",
    "name": "MAMI MILANO Диффузор с палочками VIA DELLE SPEZIE / Улица специй. Коллекция PALAZZO, 200 мл",
    "volume": "200 мл",
    "suffix": "диффузор с палочками 200 мл"
  },
  {
    "group": "MAMI VIA DELLE SPEZIE",
    "sku": "MF-REFILL.12",
    "name": "MAMI MILANO Рефилл для диффузора VIA DELLE SPEZIE / Улица специй. Коллекция PALAZZO, 250 мл",
    "volume": "250 мл",
    "suffix": "рефилл для диффузора 250 мл"
  },
  {
    "group": "AROMAgroup BERBERI",
    "sku": "988768798",
    "name": "Бербери картридж AG 100мл пласт.",
    "volume": "100 мл",
    "suffix": "100 мл"
  },
  {
    "group": "AROMAgroup BERBERI",
    "sku": "137897",
    "name": "Бербери картридж AG 110мл пласт.",
    "volume": "110 мл",
    "suffix": "110 мл"
  },
  {
    "group": "AROMAgroup BERBERI",
    "sku": "675483",
    "name": "Бербери картридж AG 150мл пласт.",
    "volume": "150 мл",
    "suffix": "150 мл"
  },
  {
    "group": "AROMAgroup BERBERI",
    "sku": "fc7e824a-136a-11ef-b412-e92179844ed4",
    "name": "Бербери картридж AG 180мл пласт.",
    "volume": "180 мл",
    "suffix": "180 мл"
  },
  {
    "group": "AROMAgroup BORDO",
    "sku": "32131",
    "name": "Бордо картридж AG 110мл пласт.",
    "volume": "110 мл",
    "suffix": "110 мл"
  },
  {
    "group": "AROMAgroup BORDO",
    "sku": "87654",
    "name": "Бордо картридж АG 150мл пласт.",
    "volume": "150 мл",
    "suffix": "150 мл"
  },
  {
    "group": "AROMAgroup IGRISTAYA MALINA",
    "sku": "323244211",
    "name": "Игристая малина картридж AG 110 мл.",
    "volume": "110 мл",
    "suffix": "110 мл"
  },
  {
    "group": "AROMAgroup IGRISTAYA MALINA",
    "sku": "876687",
    "name": "Игристая малина картридж AG 150 мл.",
    "volume": "150 мл",
    "suffix": "150 мл"
  },
  {
    "group": "AROMAgroup MAGMA",
    "sku": "76544",
    "name": "Магма картридж AG 100мл пласт.",
    "volume": "100 мл",
    "suffix": "100 мл"
  },
  {
    "group": "AROMAgroup MAGMA",
    "sku": "45360",
    "name": "Магма, 150 мл, пластик",
    "volume": "150 мл",
    "suffix": "150 мл"
  },
  {
    "group": "AROMAgroup MAGMA",
    "sku": "99889898",
    "name": "Магма картридж AG 500мл пласт.",
    "volume": "500 мл",
    "suffix": "500 мл"
  },
  {
    "group": "AROMAgroup MALDIVY",
    "sku": "0789",
    "name": "Мальдивы картридж AG 110мл пласт.",
    "volume": "110 мл",
    "suffix": "110 мл"
  },
  {
    "group": "AROMAgroup MALDIVY",
    "sku": "088976",
    "name": "Мальдивы картридж AG 150мл пласт.",
    "volume": "150 мл",
    "suffix": "150 мл"
  },
  {
    "group": "AROMAgroup TADZH MAHAL",
    "sku": "087654",
    "name": "Тадж- Махал картридж AG 100мл пласт.",
    "volume": "100 мл",
    "suffix": "100 мл"
  },
  {
    "group": "AROMAgroup TADZH MAHAL",
    "sku": "787532",
    "name": "Тадж- Махал картридж AG 110мл пласт.",
    "volume": "110 мл",
    "suffix": "110 мл"
  },
  {
    "group": "AROMAgroup TADZH MAHAL",
    "sku": "5445098",
    "name": "Тадж- Махал картридж AG 150мл пласт.",
    "volume": "150 мл",
    "suffix": "150 мл"
  },
  {
    "group": "VELLUTIER MIDNIGHT TOAST",
    "sku": "V62014",
    "name": "Vellutier / Свеча средняя Вечерний тост 225гр / Midnight Toast",
    "volume": "225 г",
    "suffix": "свеча 225 г"
  },
  {
    "group": "VELLUTIER MIDNIGHT TOAST",
    "sku": "V61014",
    "name": "Vellutier / Свеча большая Вечерний тост 515гр / Midnight Toast",
    "volume": "515 г",
    "suffix": "свеча 515 г"
  }
]

function fixture(row) {
  return {
    id: `synthetic-${row.sku}`, isActive: true,
    trade: { sku: row.sku, name: row.name, brand: inferStagedBrand(row.name),
      category: inferStagedCategory(row.name), volume: inferStagedVolume(row.name),
      price: 1234.5, stock: 2, barcode: null, characteristics: {} },
    editorial: { slug: `synthetic-${row.sku}`, images: ['/catalog/synthetic.webp'],
      description: null, scentFamily: null, mood: null, room: null, recommendations: [] },
  }
}
const schema = item => productStructuredData(item, item.editorial.images[0], 'https://catalog.example.invalid')['@graph'][0]

for (const group of new Set(variants.map(row => row.group))) {
  const rows = variants.filter(row => row.group === group)
  test(`${group}: verified variants have distinct H1 and Product names; identity and offers are preserved`, () => {
    const headings = []
    for (const row of rows) {
      const item = fixture(row)
      const before = structuredClone(item)
      assert.equal(item.trade.volume, row.volume)
      const display = productPresentation(item)
      const heading = `${display.title} — ${row.suffix}`
      assert.equal(productPageHeading(item), heading)
      const data = schema(item)
      assert.equal(data.name, display.russianTitle ? `${heading} — ${display.russianTitle}` : heading)
      assert.equal(data.sku, row.sku)
      assert.equal(data.url, `https://catalog.example.invalid/catalog/${item.editorial.slug}`)
      assert.equal(data['@id'], `${data.url}#product`)
      assert.equal(data.offers.price, '1234.50')
      assert.equal(data.offers.availability, 'https://schema.org/InStock')
      assert.deepEqual(item, before)
      item.trade.stock = 0
      assert.equal(schema(item).offers.availability, 'https://schema.org/OutOfStock')
      assert.equal(productPageHeading(item), heading)
      headings.push(heading)
    }
    assert.equal(new Set(headings).size, rows.length)
  })

  test(`${group}: missing/conflicting evidence keeps existing presentation without slug inference`, () => {
    for (const row of rows) {
      const patches = [{ name: '' }, { name: `${row.name} changed` }, { sku: 'synthetic-unreviewed' },
        { volume: '999 мл' }, { volume: row.volume?.endsWith('г') ? row.volume.replace('г', 'мл') : '999 г' }]
      if (row.volume) patches.push({ volume: null }, { volume: '' })
      for (const patch of patches) {
        const item = fixture(row)
        Object.assign(item.trade, patch)
        // A plausible editorial path cannot authorize any trade facts.
        item.editorial.slug = 'verified-fragrance-refill-500'
        const display = productPresentation(item)
        assert.equal(productPageHeading(item), display.title)
        assert.equal(schema(item).name, display.russianTitle ? `${display.title} — ${display.russianTitle}` : display.title)
      }
    }
  })
}