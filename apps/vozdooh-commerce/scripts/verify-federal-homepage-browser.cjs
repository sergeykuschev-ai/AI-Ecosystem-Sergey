/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in browser checks. */
// GET-only page inspection; analytics and all external requests are blocked.
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const base = process.env.VOZDOOH_QA_URL || 'http://127.0.0.1:3445'
;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-webgl'], ...(process.env.VOZDOOH_QA_PROXY ? { proxy: { server: process.env.VOZDOOH_QA_PROXY } } : {}) })
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      page.setDefaultTimeout(90000)
      page.setDefaultNavigationTimeout(90000)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => route.request().method() === 'GET' && new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort())
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await page.locator('.heroProductShowcase img').waitFor()
      await page.evaluate(() => document.fonts.ready)
      assert.equal(await page.locator('h1').innerText(), 'Ароматы, которые создают атмосферу')
      assert.equal(await page.locator('.heroActions .creamButton').getAttribute('href'), '/catalog')
      assert.match(await page.locator('.heroProductShowcase').getAttribute('href'), /culti-decor-aramara-250/)
      assert.equal(await page.locator('.homeBenefits h2').count(), 3)
      assert.ok(await page.locator('.homeBenefits').evaluate(el => el.getBoundingClientRect().top >= document.querySelector('.hero').getBoundingClientRect().bottom - 1))
      assert.equal((await page.locator('link[rel=canonical]').getAttribute('href')).replace(/\/$/, ''), 'https://vozdooh27.ru')
      assert.match(await page.locator('meta[property="og:title"]').getAttribute('content'), /создают атмосферу/)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: `/tmp/vozdooh-federal-home-${width}.png`, fullPage: false })
      await page.locator('.homeBenefits').screenshot({ path: `/tmp/vozdooh-federal-benefits-${width}.png` })
      await page.locator('.homeBenefits a[href="/khabarovsk"]').click()
      await page.waitForURL('**/khabarovsk')
      await page.getByRole('heading', { name: 'Ароматы для дома в Хабаровске', exact: true }).waitFor()
      assert.match(await page.locator('main').innerText(), /Павла Морозова, 97/)
      assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), 'https://vozdooh27.ru/khabarovsk')
      assert.deepEqual(errors, [])
      console.log(`PASS federal homepage and useful local landing ${width}px`)
      await page.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
