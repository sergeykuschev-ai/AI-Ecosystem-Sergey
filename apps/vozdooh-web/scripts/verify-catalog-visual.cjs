/* eslint-disable @typescript-eslint/no-require-imports -- Optional browser verification. */
// Production staged preview only. No checkout actions and no external requests authored here.
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const baseURL = process.env.VOZDOOH_TEST_URL || 'http://127.0.0.1:3411'
const routes = ['/catalog', '/brands', '/categories', '/brands/culti-milano', '/brands/teatro-fragranze-uniche', '/categories/refills', '/categories/accessories', '/categories/water-soluble', '/catalog?brand=VINOVE&category=Для%20автомобиля', '/catalog/vinove-rome-evolution-excellence', '/catalog/culti-automobili-lamborghini-1000', '/catalog/millefiori-mimosa-flower-hydro-15', '/catalog/aromagroup-bordo-110']
;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    for (const width of [390, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const [index, route] of routes.entries()) {
        // Background route prefetches can outlive navigation; check page load and
        // explicitly decode the displayed images below instead of waiting for idle.
        const response = await page.goto(baseURL + route, { waitUntil: 'load' })
        assert.equal(response.status(), 200, route)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow: ${route}, ${width}`)
        assert.doesNotMatch(await page.locator('main').innerText(), /PREVIEW 1C|CORE|STRONG|NORMAL|SLOW|CLEARANCE|promotion_rank/i)
        assert.match(await page.locator('meta[name="robots"]').first().getAttribute('content'), /noindex/)
        assert.equal(await page.locator('h1').count(), 1)
        assert.ok(await page.locator('.productCardMeta h3').evaluateAll((nodes) => nodes.every((node) => node.getBoundingClientRect().height <= parseFloat(getComputedStyle(node).lineHeight) * 2 + 1)), `Card title height: ${route}`)
        assert.ok(await page.locator('.landingLinks a, .productBack, .filterDisclosure>summary, .catalogFinder, .activeFilters a, .productFacts>summary').evaluateAll((nodes) => nodes.every((node) => node.getBoundingClientRect().height >= 44)), `Touch target: ${route}`)
        assert.ok(await page.locator('.productCardImage, .productHeroImage').evaluateAll(async (nodes) => {
          // Offscreen Next.js images are lazy: decode alone does not start loading.
          // Change only this test page's DOM, never the storefront loading policy.
          nodes.forEach((img) => { img.loading = 'eager' })
          let timer
          try {
            await Promise.race([
              Promise.all(nodes.map((img) => img.decode())),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Image decoding exceeded 60 seconds')), 60_000) }),
            ])
          } finally { clearTimeout(timer) }
          return nodes.every((img) => img.naturalWidth > 0 && getComputedStyle(img).objectFit === 'contain')
        }), `Image frame: ${route}`)
        await page.screenshot({ path: `/tmp/vozdooh-catalog-qa-${width}-${index}.png`, fullPage: true })
      }
    }
    const filterRoute = '/catalog?brand=TEATRO%20Fragranze%20Uniche&category=Рефилы'
    await page.goto(baseURL + filterRoute)
    await page.locator('.catalogGrid .productCard').first().click()
    await page.locator('.productBack').click()
    const query = new URL(page.url()).searchParams
    assert.equal(query.get('brand'), 'TEATRO Fragranze Uniche')
    assert.equal(query.get('category'), 'Рефилы')
    assert.match(await (await page.request.get(baseURL + '/robots.txt')).text(), /Disallow: \//)
    assert.deepEqual(errors, [])
    console.log('PASS: 39 route/viewport checks, filters, noindex, image frames, customer boundaries; inspect /tmp/vozdooh-catalog-qa-*.png')
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })
