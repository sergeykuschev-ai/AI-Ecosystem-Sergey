/* eslint-disable @typescript-eslint/no-require-imports -- Read-only SSR verification. */
// Fallback when browser processes/sockets are unavailable. This does not measure
// geometry or replace visual inspection of a production build.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
require('./register-typescript.cjs')
require.extensions['.tsx'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  })
  module._compile(outputText, filename)
}
const { renderToStaticMarkup } = require('react-dom/server')
const { getCatalogRepository } = require('../src/catalog/source.ts')
const { availableLandings } = require('../src/catalog/landings.ts')
const { withValidImages } = require('../src/catalog/validImages.ts')
const { storefrontProducts } = require('../src/catalog/presentation.ts')
const demand = require('../research/demand-evidence-2026-09.json')
const output = '/tmp/vozdooh-catalog-rendered-qa'
;(async () => {
  assert.equal(process.env.CATALOG_PROVIDER, 'staged-1c', 'Set staged-1c and the existing read-only snapshot path')
  const products = await withValidImages(await (await getCatalogRepository()).list())
  assert.equal(products.length, 148)
  assert.deepEqual(storefrontProducts(products).slice(0, 25).map((p) => p.trade.sku), demand.top_skus)
  fs.mkdirSync(output, { recursive: true })
  const css = fs.readFileSync('app/globals.css', 'utf8')
  const routes = [
    ['/catalog', require('../app/catalog/page.tsx').default, { searchParams: Promise.resolve({}) }],
    ['/catalog?brand=VINOVE', require('../app/catalog/page.tsx').default, { searchParams: Promise.resolve({ brand: 'VINOVE' }) }],
    ['/catalog?category=Рефилы', require('../app/catalog/page.tsx').default, { searchParams: Promise.resolve({ category: 'Рефилы' }) }],
    ['/brands', require('../app/brands/page.tsx').default, {}],
    ['/categories', require('../app/categories/page.tsx').default, {}],
  ]
  for (const kind of ['brand', 'category']) {
    const plural = kind === 'brand' ? 'brands' : 'categories'
    const page = require(`../app/${plural}/[slug]/page.tsx`).default
    for (const landing of availableLandings(products, kind)) routes.push([`/${plural}/${landing.slug}`, page, { params: Promise.resolve({ slug: landing.slug }) }])
  }
  const productPage = require('../app/catalog/[slug]/page.tsx').default
  for (const product of products) routes.push([`/catalog/${product.editorial.slug}`, productPage, { params: Promise.resolve({ slug: product.editorial.slug }), searchParams: Promise.resolve({}) }])
  for (const [index, [route, page, props]] of routes.entries()) {
    const body = renderToStaticMarkup(await page(props))
    assert.equal((body.match(/<h1>/g) ?? []).length, 1, route)
    assert.doesNotMatch(body, /PREVIEW 1C|CORE|STRONG|NORMAL|SLOW|CLEARANCE|promotion_rank|₽|\bRUB\b|Добавить в корзину/i, route)
    for (const match of body.matchAll(/src="(\/catalog\/official\/[^"?]+)"/g)) assert.ok(fs.existsSync(path.join('public', match[1])), match[1])
    fs.writeFileSync(`${output}/${index}.html`, `<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><style>${css}</style></head><body>${body}</body></html>`)
  }
  fs.writeFileSync(`${output}/routes.json`, JSON.stringify(routes.map(([route]) => route), null, 2))
  console.log(`PASS: ${routes.length} SSR route renders, 148 SKU, TOP-25, no-price/no-tier boundary. HTML/CSS: ${output}. Browser geometry and HTTP status NOT verified.`)
})().catch((error) => { console.error(error); process.exitCode = 1 })
