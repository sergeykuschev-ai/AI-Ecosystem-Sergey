/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
require('../scripts/register-typescript.cjs')
const { buildYandexYml } = require('../src/integrations/yandexFeed.ts')
const { GET } = require('../app/yml.xml/route.ts')

function product({ sku = 'SKU-1', stock = 2, price = 7900, image = '/catalog/official/feed-test.jpg' } = {}) {
  return {
    id: sku,
    isActive: true,
    trade: { sku, name: 'Диффузор TEST Brand 250 мл', brand: 'TEST Brand', category: 'Диффузоры', volume: '250 мл', price, stock, barcode: null, characteristics: {} },
    editorial: { slug: `item-${sku.toLowerCase()}`, description: 'Тестовое описание без рекламных обещаний.', images: [image], scentFamily: null, mood: null, room: null, recommendations: [] },
  }
}

test('Yandex YML uses the catalog SKU as offer id and current price/availability', () => {
  const yml = buildYandexYml([product()], 'https://vozdooh27.ru/')
  assert.match(yml, /<offer id="SKU-1" available="true">/)
  assert.match(yml, /<price>7900<\/price>/)
  assert.match(yml, /<currency id="RUR" rate="1"\/>/)
  assert.match(yml, /<currencyId>RUR<\/currencyId>/)
  assert.doesNotMatch(yml, /\bRUB\b/)
  assert.match(yml, /<url>https:\/\/vozdooh27\.ru\/catalog\/item-sku-1<\/url>/)
  assert.match(yml, /<picture>https:\/\/vozdooh27\.ru\/catalog\/official\/feed-test\.jpg<\/picture>/)
})

test('Yandex YML omits unavailable products and offers without an eligible product picture', () => {
  const withoutImage = product({ sku: 'NO-IMAGE' })
  withoutImage.editorial.images = []
  withoutImage.trade.category = 'Excluded-only category'
  const alternateImage = product({ sku: 'ALTERNATE', image: '/catalog/official/09877.jpg' })
  alternateImage.editorial.images.push('/catalog/official/feed-test.jpg')
  const withoutDescription = product({ sku: 'NO-DESCRIPTION' })
  withoutDescription.editorial.description = null
  const yml = buildYandexYml([
    alternateImage,
    product({ sku: 'SMALL', image: '/catalog/official/09877.jpg' }),
    product({ sku: 'INVALID', image: '//example.com/foreign.jpg' }),
    product({ sku: 'AVIF', image: '/catalog/official/feed-test.avif' }),
    withoutImage,
    withoutDescription,
    product({ sku: 'ZERO', stock: 0 }),
    product({ sku: 'NO-PRICE', price: null }),
    product({ sku: '445445' }),
    { ...product({ sku: 'INACTIVE' }), isActive: false },
  ], 'https://vozdooh27.ru')
  assert.deepEqual([...yml.matchAll(/<offer id="([^"]+)"/g)].map((match) => match[1]), ['ALTERNATE'])
  assert.match(yml, /<picture>https:\/\/vozdooh27\.ru\/catalog\/official\/feed-test\.jpg<\/picture>/)
  assert.doesNotMatch(yml, /09877\.jpg|Excluded-only category/)
})

test('Yandex YML escapes XML-sensitive catalog text and offer IDs', () => {
  const item = product()
  const raw = `A & B < C > D "E" 'F'`
  Object.assign(item.trade, { sku: raw, category: raw, brand: raw })
  item.editorial.description = raw
  const yml = buildYandexYml([item], 'https://vozdooh27.ru')
  const escaped = 'A &amp; B &lt; C &gt; D &quot;E&quot; &apos;F&apos;'
  assert.ok(yml.includes(`<offer id="${escaped}" available="true">`))
  assert.ok(yml.includes(`<category id="1">${escaped}</category>`))
  assert.ok(yml.includes(`<vendor>${escaped}</vendor>`))
  assert.ok(yml.includes(`<description>${escaped}</description>`))
  assert.ok(!yml.includes(raw))
})

test('YML route serves staged catalog XML and returns a non-cacheable 503 when the catalog cannot load', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vozdooh-yml-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const env = { ...process.env }
  t.after(() => {
    for (const key of ['CATALOG_PROVIDER', 'ONEC_LOCAL_CATALOG_PATH', 'ONEC_STAGED_PREVIEW_ENABLED', 'NEXT_PUBLIC_SITE_URL']) {
      if (env[key] === undefined) delete process.env[key]
      else process.env[key] = env[key]
    }
  })
  process.env.CATALOG_PROVIDER = 'staged-1c'
  process.env.ONEC_STAGED_PREVIEW_ENABLED = 'true'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://vozdooh27.ru/'
  const snapshot = join(directory, 'catalog.json')
  process.env.ONEC_LOCAL_CATALOG_PATH = snapshot
  const failure = await GET()
  assert.equal(failure.status, 503)
  assert.equal(failure.headers.get('cache-control'), 'no-store')
  assert.equal(await failure.text(), 'Catalog feed temporarily unavailable')

  await writeFile(snapshot, JSON.stringify({
    version: 1,
    kind: 'staged-real-1c',
    products: [product({ sku: 'N020465' }).trade, product({ sku: 'UNPICTURED' }).trade],
  }))
  const response = await GET()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/xml; charset=utf-8')
  const yml = await response.text()
  assert.deepEqual([...yml.matchAll(/<offer id="([^"]+)"/g)].map((match) => match[1]), ['N020465'])
  assert.match(yml, /<url>https:\/\/vozdooh27\.ru\/catalog\/lothantique-sandalwood-diffuser-200<\/url>/)
  assert.match(yml, /<picture>https:\/\/vozdooh27\.ru\/catalog\/official\/N020465\.png<\/picture>/)
})
