/* eslint-disable @typescript-eslint/no-require-imports -- Read-only private preview smoke test. */
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.VOZDOOH_TEST_URL || 'http://127.0.0.1:3419'
require('./register-typescript.cjs')
const evidence = require('../research/demand-evidence-2026-09.json')
const { stagedTrade, stagedEditorial } = require('../src/catalog/stagedEditorial.ts')
const trades = evidence.products.map(p => stagedTrade({ sku: p.sku, name: p.original_name, brand: p.brand, category: p.current_category, volume: p.volume, price: null, stock: p.stock, barcode: null, characteristics: {} }))
const editorial = stagedEditorial(trades)
const expected = evidence.top_skus.map(sku => `/catalog/${editorial[sku].slug}`)
;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    for (const width of [390, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const route of ['/', '/catalog', '/brands', '/categories', '/cart', '/checkout', '/catalog/does-not-exist']) {
        const response = await page.goto(base + route, { waitUntil: 'networkidle' })
        assert.equal(response.status(), route.endsWith('does-not-exist') ? 404 : 200)
        assert.match(response.headers()['x-robots-tag'], /noindex/)
        assert.equal(await page.locator('h1').count(), 1, route)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route)
      }
    }
    await page.goto(base + '/catalog', { waitUntil: 'networkidle' })
    const actual = await page.locator('.catalogGrid .productCard').evaluateAll(nodes => nodes.slice(0, 25).map(n => n.getAttribute('href')))
    assert.deepEqual(actual, expected, 'Rendered TOP-25 must match frozen research')
    assert.equal(await page.locator('.catalogGrid .productCard').count(), 136)
    await page.locator('.catalogGrid .productCard').first().click()
    await page.waitForURL(base + expected[0])
    await page.waitForLoadState('networkidle')
    await page.locator('.productHeroImage').evaluate(async image => { await image.decode() })
    assert.equal(await page.locator('h1').count(), 1)
    assert.match(await page.locator('meta[name="robots"]').first().getAttribute('content'), /noindex/)
    await page.screenshot({ path: '/tmp/vozdooh-hardening-product.png', fullPage: true })
    assert.match(await (await page.request.get(base + '/robots.txt')).text(), /Disallow: \//)
    assert.deepEqual(errors, [])
    console.log('PASS: 21 route/viewport checks, noindex headers, one H1, no overflow, 136 pictured products, frozen TOP-25, product navigation, robots; no orders submitted')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
