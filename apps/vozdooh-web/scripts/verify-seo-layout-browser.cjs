/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in read-only browser regression. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const base = process.env.VOZDOOH_QA_URL || 'http://127.0.0.1:3447'
const output = process.env.VOZDOOH_QA_OUTPUT || '/tmp/vozdooh-seo-layout'
const routes = process.env.VOZDOOH_QA_ROUTES ? process.env.VOZDOOH_QA_ROUTES.split(',') : ['/', '/catalog', '/brands/culti-milano', '/brands/teatro-fragranze-uniche', '/categories/diffusers', '/categories/candles', '/collections/home-fragrance', '/collections/gift-diffusers', '/catalog/culti-decor-aramara-250', '/delivery']
;(async () => {
  fs.mkdirSync(output, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-webgl'], ...(process.env.VOZDOOH_QA_PROXY ? { proxy: { server: process.env.VOZDOOH_QA_PROXY } } : {}) })
  const results = []
  try {
    for (const width of (process.env.VOZDOOH_QA_WIDTHS || '320,375,390,430,1280').split(',').map(Number)) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      await page.route('**/*', route => route.request().method() === 'GET' && new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort())
      for (const [index, path] of routes.entries()) {
        const response = await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 90000 })
        if (process.env.VOZDOOH_QA_CONTEXTUAL === '1' && !['/delivery', '/catalog/culti-decor-aramara-250'].includes(path)) {
          const html = await response.text()
          assert.match(html, /aria-label="Бренды, форматы и подборки из наличия"/, `Raw HTML navigation: ${path}`)
          assert.match(html, /aria-label="Примеры товаров из наличия"/, `Raw HTML products: ${path}`)
          if (['/', '/catalog'].includes(path)) for (const href of ['/brands/culti-milano', '/brands/teatro-fragranze-uniche', '/categories/diffusers', '/categories/candles', '/collections/home-fragrance', '/collections/gift-diffusers']) assert.ok(html.includes(`href="${href}"`), `${path} links ${href}`)
        }
        if (process.env.VOZDOOH_QA_COLLECTION_SCHEMA === '1' && path.startsWith('/collections/')) {
          const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.flatMap(node => JSON.parse(node.textContent)['@graph'] || []))
          const collection = schemas.find(node => node['@type'] === 'CollectionPage')
          const items = schemas.find(node => node['@type'] === 'ItemList')
          const breadcrumbs = schemas.find(node => node['@type'] === 'BreadcrumbList')
          assert.ok(collection && items && breadcrumbs, path)
          const visible = await page.locator('.catalogGrid .productCard').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))
          assert.deepEqual(items.itemListElement.map(item => new URL(item.url).pathname), visible, `${path} schema/grid equality`)
          assert.deepEqual(items.itemListElement.map(item => item.position), visible.map((_, index) => index + 1))
          assert.equal(collection.url, `https://vozdooh27.ru${path}`)
          assert.equal(breadcrumbs.itemListElement[1].item, 'https://vozdooh27.ru/collections')
          assert.match(await response.text(), /"@type":"CollectionPage"/, 'Schema is present in raw HTML')
          assert.equal(await page.locator('[aria-current="page"]').innerText(), collection.name)
        }
        await page.evaluate(() => document.fonts.ready)
        const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
        results.push({ path, width, status: response.status(), ...size })
        assert.equal(response.status(), 200, path)
        assert.ok(size.document <= width, `Overflow ${path} at ${width}: ${size.document}`)
        assert.equal(await page.locator('h1').count(), 1, path)
        if ([390, 1280].includes(width)) await page.screenshot({ path: `${output}/${width}-${index}.png`, fullPage: true })
        console.log('PASS', width, path)
      }
      await page.close()
    }
  } finally {
    fs.writeFileSync(`${output}/results.json`, JSON.stringify({ base, time: new Date().toISOString(), results }, null, 2))
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
