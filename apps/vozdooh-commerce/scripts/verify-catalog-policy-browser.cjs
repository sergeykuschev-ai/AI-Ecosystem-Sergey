/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in read-only URL/HTML policy checks. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const base = process.env.VOZDOOH_QA_URL || 'http://127.0.0.1:3448'
const output = process.env.VOZDOOH_QA_OUTPUT || '/tmp/vozdooh-catalog-policy'
const cases = [
  ['/catalog', '/catalog', true],
  ['/catalog?q=CULTI', '/catalog?q=CULTI', false],
  ['/catalog?q=', '/catalog?q=', false],
  ['/catalog?brand=CULTI%20MILANO', '/brands/culti-milano', true],
  ['/catalog?brand=TEATRO%20Fragranze%20Uniche', '/brands/teatro-fragranze-uniche', true],
  ['/catalog?brand=missing-seo-fixture', '/catalog?brand=missing-seo-fixture', false],
  ['/catalog?brand=CULTI%20MILANO&category=Диффузоры', '/catalog?brand=CULTI+MILANO&category=Диффузоры', false],
  ['/catalog?unknown=fixture', '/catalog', true],
  ['/catalog?debugCatalog=1', '/catalog', false],
  ['/brands/culti-milano', '/brands/culti-milano', true],
]
;(async () => {
  fs.mkdirSync(output, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'], ...(process.env.VOZDOOH_QA_PROXY ? { proxy: { server: process.env.VOZDOOH_QA_PROXY } } : {}) })
  const results = []
  try {
    const context = await browser.newContext()
    await context.route('**/*', route => route.request().method() === 'GET' && new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort())
    for (const path of ['/catalog?page=2', '/catalog?page=0', '/catalog?page=abc', '/catalog?page=1&page=2']) {
      const response = await context.request.get(base + path, { maxRedirects: 0 })
      assert.equal(response.status(), 404, path)
      assert.match(response.headers()['x-robots-tag'], /noindex/)
      results.push({ path, status: response.status() })
    }
    const first = await context.request.get(base + '/catalog?page=1&q=CULTI', { maxRedirects: 0 })
    assert.equal(first.status(), 308)
    assert.equal(new URL(first.headers().location, base).search, '?q=CULTI')
    for (const width of [390, 1280]) {
      const page = await context.newPage()
      await page.setViewportSize({ width, height: 900 })
      assert.equal(await page.evaluate(() => innerWidth), width)
      for (const [index, [path, canonical, indexable]] of cases.entries()) {
        const response = await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 90000 })
        assert.equal(response.status(), 200, path)
        const href = await page.locator('link[rel=canonical]').getAttribute('href')
        assert.equal(href, new URL(canonical, 'https://vozdooh27.ru').href, path)
        assert.match(await page.locator('meta[name=robots]').getAttribute('content'), indexable ? /^index, follow$/ : /^noindex, follow$/, path)
        if (path.includes('missing-seo-fixture')) {
          assert.equal(await page.locator('.catalogGrid .productCard').count(), 0)
          assert.match(await page.locator('main').innerText(), /Значение фильтра не найдено/)
        }
        await page.evaluate(() => document.fonts.ready)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow ${path} ${width}`)
        await page.screenshot({ path: `${output}/${width}-${index}.png`, fullPage: true })
        results.push({ path, width, canonical: href, status: response.status(), indexable })
        console.log('PASS', width, path)
      }
      await page.close()
    }
  } finally {
    fs.writeFileSync(`${output}/results.json`, JSON.stringify({ base, time: new Date().toISOString(), results }, null, 2))
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
