/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node regression tests. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { distinctProductMetadataTitle } = require('../src/seo/productMetadata.ts')
const { landingMetadataDescription, landingSearchDescription } = require('../src/seo/landingCopy.ts')
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const product = (slug, category, stock = 1) => ({
  trade: { name: 'DOLCE VANIGLIA', brand: 'TEATRO Fragranze Uniche', category, volume: '500 мл', stock, price: 100 },
  editorial: { slug },
})
const baseTitle = 'DOLCE VANIGLIA 500 мл — TEATRO Fragranze Uniche — купить с доставкой по России | VOZDOOH'

test('the exact duplicate pair gets distinct trade-category titles without changing products', () => {
  const diffuser = product('teatro-dolce-vaniglia-500', 'Диффузоры')
  const refill = product('teatro-dolce-vaniglia-refill-500', 'Рефилы')
  const before = JSON.stringify([diffuser, refill])
  assert.equal(distinctProductMetadataTitle(diffuser, baseTitle), `Аромадиффузор ${baseTitle}`)
  assert.equal(distinctProductMetadataTitle(refill, baseTitle), `Рефил ${baseTitle}`)
  assert.notEqual(distinctProductMetadataTitle(diffuser, baseTitle), distinctProductMetadataTitle(refill, baseTitle))
  assert.equal(JSON.stringify([diffuser, refill]), before)
  // A misleading slug must never override the reliable trade category.
  assert.equal(distinctProductMetadataTitle(product(refill.editorial.slug, 'Диффузоры'), baseTitle), `Аромадиффузор ${baseTitle}`)
  assert.equal(distinctProductMetadataTitle(product(refill.editorial.slug, 'Товар'), baseTitle), baseTitle)
  assert.equal(distinctProductMetadataTitle(product('other-diffuser', 'Диффузоры'), baseTitle), baseTitle)
})

test('brand and category metadata retain identity, real formats and qualified delivery within the limit', () => {
  const items = [product('fake-diffuser', 'Диффузоры'), product('fake-refill', 'Рефилы'), product('fake-candle', 'Свечи', 0)]
  for (const [name, kind] of [['CULTI MILANO', 'brand'], ['Диффузоры', 'category'], ['TEATRO Fragranze Uniche', 'brand']]) {
    const landing = { name, guidance: 'Длинный редакционный текст. '.repeat(12) }
    const description = landingMetadataDescription(landing, items, kind)
    assert.ok(description.length >= 140 && description.length <= 170, `${name}: ${description.length}`)
    assert.ok(description.includes(name))
    assert.match(description, /В наличии\./)
    assert.match(description, /Доставка в доступные пункты Ozon по России\./)
    assert.match(description, /Бесплатный самовывоз в Хабаровске\./)
    assert.doesNotMatch(description, /Свечи|бесплатная доставка|по всей России|100|₽/i)
    if (kind === 'brand') assert.match(description, /Диффузоры, Рефилы/)
    const editorial = landingSearchDescription(landing, items, kind)
    assert.ok(editorial.length > description.length)
    if (kind === 'category') assert.ok(editorial.includes(landing.guidance))
  }
})

test('missing stock and long formats never create stock facts or cut words', () => {
  for (const stock of [0, -1, null, undefined]) {
    const item = product('fake', 'Свечи', stock)
    item.trade.stock = stock
    const description = landingMetadataDescription({ name: 'CULTI MILANO' }, [item], 'brand')
    assert.doesNotMatch(description, /В наличии|Свечи/)
    assert.ok(description.length <= 170)
  }
  const description = landingMetadataDescription({ name: 'CULTI MILANO' }, [product('fake', 'Очень длинное название формата '.repeat(20))], 'brand')
  assert.doesNotMatch(description, /Очень|…|\.\.\./)
  assert.match(description, /Бесплатный самовывоз в Хабаровске\./)
  assert.throws(() => landingMetadataDescription({ name: 'Название '.repeat(30) }, [], 'brand'), /170 characters/)
})

test('all configured landing names fit intact with synthetic inventory', () => {
  const names = [...read('src/catalog/landings.ts').matchAll(/\bname: '([^']+)'/g)].map(match => match[1])
  assert.ok(names.length >= 23)
  for (const name of names) {
    for (const kind of ['brand', 'category']) {
      const description = landingMetadataDescription({ name }, [product('fake', 'Диффузоры'), product('fake-2', 'Рефилы')], kind)
      assert.ok(description.includes(name))
      assert.ok(description.length >= 140 && description.length <= 170, `${name}: ${description.length}`)
    }
  }
})

test('routes wire concise metadata and keep canonical and long page copy', () => {
  for (const [folder, kind] of [['brands', 'brand'], ['categories', 'category']]) {
    const source = read(`app/${folder}/[slug]/page.tsx`)
    assert.ok(source.includes(`landingMetadataDescription(landing, landing.products, '${kind}')`))
    assert.match(source, /openGraph: \{ title, description \}/)
    assert.ok(source.includes(`canonical: landingPath('${kind}', landing.slug)`))
    assert.ok(source.includes(`description: landingSearchDescription(landing, landing.products, '${kind}')`))
    assert.match(source, /<CatalogLanding landing=\{landing\}/)
  }
  const source = read('app/catalog/[slug]/page.tsx')
  assert.ok(source.includes('const title = reviewedCommercialTitle(product, conciseProductMetadataTitle(product, distinctProductMetadataTitle(product, baseTitle), display), display)'))
  assert.ok(source.includes('canonical: `/catalog/${product.editorial.slug}`'))
  assert.match(source, /<h1>\{display.title\}<\/h1>/)
  assert.match(source, /productStructuredData\(product, heroImage\)/)
})
