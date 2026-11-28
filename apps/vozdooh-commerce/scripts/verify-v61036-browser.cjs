/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in isolated content/SSR regression. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const base = process.env.VOZDOOH_QA_URL || 'http://127.0.0.1:34934'
const output = process.env.VOZDOOH_QA_OUTPUT || '/tmp/vozdooh-v61036-qa'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Use an isolated loopback build')

;(async () => {
  fs.mkdirSync(output, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  const errors = []
  const results = []
  try {
    for (const width of [375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => route.request().method() === 'GET' && new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort())
      const path = '/catalog/vellutier-siberian-pine-forest-515'
      const response = await page.goto(base + path, { waitUntil: 'networkidle' })
      assert.equal(response.status(), 200)
      assert.equal(await page.locator('h1').count(), 1)
      assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), 'https://vozdooh27.ru' + path)
      assert.equal(await page.locator('meta[name=robots]').getAttribute('content'), 'index, follow')
      const description = await page.locator('.productDesc').innerText()
      for (const fact of ['сосна', 'полынь', 'мёд', 'кедр', 'амбра', 'в стекле', '515 г', 'высота 16 см', 'длина 11 см', 'ширина 11 см']) assert.ok(description.includes(fact), fact)
      const meta = await page.locator('meta[name=description]').getAttribute('content')
      assert.ok(meta.length <= 170)
      for (const fact of ['Siberian Pine Forest', '515 г', 'сосна', 'полынь', 'кедр']) assert.ok(meta.includes(fact), fact)
      const graph = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.flatMap(node => JSON.parse(node.textContent)['@graph'] || []))
      const product = graph.find(node => node['@type'] === 'Product')
      assert.equal(product.sku, 'V61036')
      assert.equal(product.description, description)
      assert.equal(product.brand.name, 'Vellutier')
      assert.ok(product.additionalProperty.find(p => p.name === 'Ноты').value.includes('полынь'))
      const visiblePrice = Number((await page.locator('.productPrice').innerText()).replace(/[^\d,]/g, '').replace(',', '.'))
      assert.equal(Number(product.offers.price), visiblePrice)
      assert.equal(product.offers.availability, 'https://schema.org/InStock')
      const html = await response.text()
      assert.ok(html.includes(description) && html.includes('Siberian Pine Forest'))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.locator('.productDesc').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${output}/${width}.png` })
      results.push({ width, status: response.status(), schemaMatchesBody: true, priceMatchesSchema: true, overflow: false })
      await page.close()
    }
    assert.deepEqual(errors, [])
    fs.writeFileSync(`${output}/results.json`, JSON.stringify({ results, errors, externalRequestsAllowed: false }, null, 2))
    console.log('PASS: V61036 actual SSR, metadata/schema/body consistency and two browser viewports')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
