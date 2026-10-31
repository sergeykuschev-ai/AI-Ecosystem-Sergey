/* eslint-disable @typescript-eslint/no-require-imports -- Isolated metadata regression tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { join } = require('node:path')
const { discoveryDescriptions } = require('../src/seo/discoveryDescriptions.ts')
const { editorialCollections } = require('../src/catalog/collections.ts')
const expected = {
  'brands': 'Бренды интерьерной парфюмерии в VOZDOOH: познакомьтесь с коллекциями и сравните ароматы, форматы и объёмы в карточках товаров.',
  'categories': 'Категории VOZDOOH: диффузоры, свечи, спреи для дома, рефилы и аксессуары. Выберите формат и проверьте назначение и комплектацию в карточке.',
  'collections': 'Подборки VOZDOOH по характеру аромата, настроению и комнате: свежие, цветочные, древесные и пряные композиции, ароматы для гостиной и спальни.',
  'bedroom': 'Ароматы для спальни в VOZDOOH: подборка товаров с подтверждённой редакционной отметкой этой комнаты. Сравните композиции в карточках.',
  'floral': 'Цветочные ароматы в VOZDOOH: подборка композиций с подтверждённым цветочным направлением. Познакомьтесь с описаниями товаров в карточках.',
  'focused': 'Подборка VOZDOOH «Собранность»: композиции с проверенной редакционной характеристикой настроения. Изучите описания ароматов в карточках.',
  'fresh-air': 'Свежие ароматы в VOZDOOH: композиции с подтверждённым свежим направлением. Сравните товары подборки и прочитайте описания в карточках.',
  'living-room': 'Ароматы для гостиной в VOZDOOH: подборка товаров, для которых гостиная указана как редакционное пространство. Изучите композиции в карточках.',
  'popular': 'Подборка «Популярные ароматы» в VOZDOOH основана на подтверждённом внешнем интересе. Познакомьтесь с композициями и форматами в карточках.',
  'warm-interior': 'Подборка VOZDOOH «Тёплый интерьер»: композиции с подтверждённым тёплым характером в редакционных данных. Сравните описания ароматов в карточках.',
  'woods-and-spices': 'Древесные и пряные ароматы в VOZDOOH: товары с подтверждённым древесным или пряным направлением. Сравните композиции по описаниям в карточках.',
}
test('exact 11 distinct factual descriptions with natural length and neutral tone', () => {
  assert.deepEqual(discoveryDescriptions, expected)
  assert.equal(new Set(Object.values(expected)).size, 11)
  for (const text of Object.values(expected)) {
    assert.ok(text.length >= 95 && text.length <= 155, `${text.length}: ${text}`)
    assert.doesNotMatch(text, /скид|достав|гарант|в наличии|ноты|бестселлер|улучшает|продаж/i)
  }
})
test('all eight targeted collection slugs exist; other collections keep their descriptions', () => {
  assert.equal(editorialCollections.length, 11)
  for (const slug of Object.keys(expected).filter(key => !['brands', 'categories', 'collections'].includes(key))) {
    assert.ok(editorialCollections.some(collection => collection.slug === slug), slug)
  }
  for (const slug of ['vozdooh-selection', 'gift-diffusers', 'home-fragrance']) assert.equal(discoveryDescriptions[slug], undefined)
})
// SHA-256 of UTF-8 source at afb3ebcb8978caed8edf2f457cd33d0c9d8a61ab.
// Normalize CRLF to LF for identical Windows/Linux source invariance checks.
const baselineHashes = {
  "app/brands/page.tsx": "c1d43e7f3b20a6c02bdfa0141c9bffc4c067b55272123fcb2357ff90f02e4fa7",
  "app/categories/page.tsx": "1008189bcb643f23e5d87ddc8d80bf04663195b1ef5fadab4f9ad2eb95eb26f0",
  "app/collections/page.tsx": "0bbc202093e923b27b82be6b0985f444e91939684b7e4f730b0fd52a2d442041",
  "app/collections/[slug]/page.tsx": "0b79e96282aa1207e3f5bd8079bd4aec87bccabc869b298d2f4944246869295f",
  "src/catalog/collections.ts": "2a948543c2f769bfe2615e326d42d3923124da10f4b56dc97adf05dd3f5be0a4",
  "src/catalog/landings.ts": "220019290738709ddc5b3af3683d795525a6a1bd027714f48a905d5522aec78f",
  "app/sitemap.ts": "158e1b7069c9c78a542caa04861622bcafeefe745f4af9928609026d58803b82",
  "src/catalog/structuredData.ts": "08767cbccbcb63e8779f32b691a160e99bdf51aa014072a22d173b3fbb174073"
}
const baselineHubDescriptions = {
  "brands": "'Знакомство с брендами интерьерной парфюмерии в коллекции VOZDOOH.'",
  "categories": "'Диффузоры, свечи, спреи и другие форматы интерьерных ароматов VOZDOOH.'",
  "collections": "'Редакционные подборки VOZDOOH по характеру аромата, настроению и пространству.'"
}
const sourceHash = source => createHash('sha256').update(source.replace(/\r\n/g, '\n'), 'utf8').digest('hex')

test('only metadata wiring changes: titles, robots, canonicals, links, markup and schema equal pinned baseline', () => {
  for (const route of ['brands', 'categories', 'collections', 'collections/[slug]']) {
    const path = `app/${route}/page.tsx`
    let current = readFileSync(join(__dirname, '..', 'app', route, 'page.tsx'), 'utf8').replace(/\r\n/g, '\n')
    current = current.replace(/^import \{ discoveryDescriptions \}[^\n]*\n/, '')
    if (route === 'collections/[slug]') {
      current = current.replace('  const description = discoveryDescriptions[collection.slug] ?? collection.description\n', '').replace('    description,', '    description: collection.description,').replace('openGraph: { title, description }', 'openGraph: { title, description: collection.description }')
    } else {
      const old = baselineHubDescriptions[route]
      current = current.replaceAll(`description: discoveryDescriptions.${route}`, `description: ${old}`)
    }
    assert.equal(sourceHash(current), baselineHashes[path], route)
  }
  for (const path of ['src/catalog/collections.ts', 'src/catalog/landings.ts', 'app/sitemap.ts', 'src/catalog/structuredData.ts']) {
    assert.equal(sourceHash(readFileSync(join(__dirname, '..', path), 'utf8')), baselineHashes[path], path)
  }
})

test('synthetic catalog resolves all 11 metadata targets and sitemap entries without missing collections', async () => {
  const ts = require('typescript')
  require.extensions['.tsx'] = (module, filename) => {
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
    })
    module._compile(outputText, filename)
  }
  const source = require('../src/catalog/source.ts')
  const original = source.getCatalogRepository
  const indexing = process.env.SEARCH_INDEXING_ENABLED
  const products = editorialCollections.map((collection, index) => {
    const field = { family: 'scentFamily', mood: 'mood', room: 'room' }[collection.rule.field]
    return {
      id: `synthetic-${index}`, isActive: true,
      trade: { sku: collection.rule.field === 'demand' || collection.rule.field === 'researchSelection' ? '802e8ae5-d19b-11ec-be83-7c8bca00854e' : `synthetic-${index}`, name: 'Synthetic fixture', brand: 'Synthetic', category: collection.rule.field === 'category' ? collection.rule.values[0] : 'Диффузоры', volume: null, price: 100, stock: 1, barcode: null, characteristics: {} },
      editorial: { slug: `synthetic-${index}`, description: 'Synthetic fixture', images: ['/brand/vozdooh-horizontal.webp'], recommendations: [], ...(field ? { [field]: collection.rule.values[0] } : {}) },
    }
  })
  source.getCatalogRepository = async () => ({ list: async () => products })
  try {
    const route = require('../app/collections/[slug]/page.tsx')
    const sitemap = require('../app/sitemap.ts').default
    const urls = (await sitemap()).map(entry => new URL(entry.url).pathname)
    for (const enabled of ['true', 'false']) {
      process.env.SEARCH_INDEXING_ENABLED = enabled
      for (const [key, description] of Object.entries(expected)) {
        const hub = ['brands', 'categories', 'collections'].includes(key)
        const path = hub ? `/${key}` : `/collections/${key}`
        if (hub) delete require.cache[require.resolve(`../app/${key}/page.tsx`)]
        const metadata = hub ? require(`../app/${key}/page.tsx`).metadata : await route.generateMetadata({ params: Promise.resolve({ slug: key }) })
        assert.equal(metadata.description, description, path)
        assert.deepEqual(metadata.alternates, { canonical: path })
        assert.deepEqual(metadata.robots, { index: enabled === 'true', follow: enabled === 'true' })
        assert.ok(urls.includes(path), path)
      }
    }
    const missing = await route.generateMetadata({ params: Promise.resolve({ slug: 'synthetic-missing' }) })
    assert.deepEqual(missing.robots, { index: false, follow: false })
  } finally {
    source.getCatalogRepository = original
    if (indexing === undefined) delete process.env.SEARCH_INDEXING_ENABLED
    else process.env.SEARCH_INDEXING_ENABLED = indexing
  }
})