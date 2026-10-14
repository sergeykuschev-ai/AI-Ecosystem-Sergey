/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in browser verification. */
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const baseURL = process.env.VOZDOOH_QA_URL || 'http://127.0.0.1:3436'
const origin = new URL(baseURL).origin
const sku = process.env.VOZDOOH_QA_SKU
if (!sku) throw new Error('VOZDOOH_QA_SKU_REQUIRED')
const requestId = '11111111-1111-4111-8111-111111111111'
const cartKey = 'vozdooh-cart-v1'
;(async () => {
  const browser = await chromium.launch({ proxy: process.env.VOZDOOH_QA_PROXY ? { server: process.env.VOZDOOH_QA_PROXY } : undefined, executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] })
  try {
    for (const width of [390, 1280]) {
      for (const scenario of ['paid', 'edited', 'pending', 'canceled', 'failed', 'storage-failure', 'already-tracked', 'delayed']) {
        const context = await browser.newContext({ viewport: { width, height: 900 } })
        const errors = []; let payload; let checks = 0; let writes = 0
        await context.route('**/*', async (route) => {
          const request = route.request(); const url = new URL(request.url())
          if (url.hostname === 'pay.example.test' && request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(`${baseURL}/checkout/success?requestId=${requestId}`)})</script>` })
          if (url.origin !== origin) return route.abort()
          if (url.pathname === '/api/payments/ozon/status') {
            checks++
            const state = ['pending', 'canceled', 'failed'].includes(scenario) ? scenario : scenario === 'delayed' && checks <= 26 ? 'pending' : checks === 1 ? 'pending' : 'paid'
            return route.fulfill({ json: state === 'paid' ? { state, order: { id: requestId, totalMinor: payload.lines[0].expectedPriceMinor, currency: 'RUB', items: [{ id: sku, name: 'Synthetic browser payment item', priceMinor: payload.lines[0].expectedPriceMinor, quantity: 1 }] } } : { state } })
          }
          if (request.method() === 'GET') return route.continue()
          if (url.pathname === '/api/order-requests') {
            writes++; payload = request.postDataJSON()
            return route.fulfill({ status: 201, json: { id: requestId, createdAt: new Date().toISOString(), totalMinor: payload.lines[0].expectedPriceMinor, currency: 'RUB', status: 'request_received' } })
          }
          if (url.pathname === '/api/payments/ozon/create') return route.fulfill({ json: { redirectUrl: 'https://pay.example.test/synthetic' } })
          return route.abort()
        })
        const page = await context.newPage()
        page.on('pageerror', (error) => errors.push(error.message))
        await page.goto(`${baseURL}/cart`, { waitUntil: 'networkidle' })
        await page.evaluate(({ sku, cartKey }) => localStorage.setItem(cartKey, JSON.stringify({ lines: [{ sku, quantity: 1 }] })), { sku, cartKey })
        await page.goto(`${baseURL}/checkout`, { waitUntil: 'networkidle' })
        await page.getByRole('radio', { name: 'Самовывоз — бесплатно', exact: true }).check()
        await page.getByLabel('Имя', { exact: true }).fill('Synthetic Browser')
        await page.getByLabel('Телефон', { exact: true }).fill('+70000000000')
        await page.getByLabel('Email', { exact: true }).fill('cart-qa@example.test')
        await page.locator('input[name=consent]').check()
        await page.getByRole('button', { name: 'Оформить заказ', exact: true }).click()
        await page.getByRole('heading', { name: 'Заказ оформлен — ожидает оплаты' }).waitFor()
        assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).lines[0].quantity, cartKey), 1)
        const editPage = await context.newPage()
        await editPage.goto(`${baseURL}/cart`, { waitUntil: 'networkidle' })
        if (scenario === 'edited') {
          await editPage.getByRole('button', { name: 'Увеличить количество' }).click()
          // Simulate another unrelated SKU while preserving snapshot provenance.
          await editPage.evaluate((key) => { const cart = JSON.parse(localStorage.getItem(key)); cart.lines.push({ sku: 'SYNTHETIC-NEW-SKU', quantity: 3 }); localStorage.setItem(key, JSON.stringify(cart)); window.dispatchEvent(new Event('vozdooh-cart-changed')) }, cartKey)
        }
        if (scenario === 'already-tracked') await page.evaluate((id) => localStorage.setItem(`vozdooh-purchase-tracked:${id}`, '1'), requestId)
        if (scenario === 'storage-failure') await context.addInitScript(() => {
          const setItem = Storage.prototype.setItem
          Storage.prototype.setItem = function (key, value) { if (key === 'vozdooh-cart-v1' && !window.__allowCartWrite) throw new Error('Synthetic quota'); return setItem.call(this, key, value) }
        })
        await page.clock.install()
        await page.getByRole('button', { name: 'Оплатить через Ozon Pay' }).click()
        await page.waitForURL('**/checkout/success?*')
        await page.waitForFunction(() => document.querySelector('main [role=status]')?.textContent.includes('Проверяем'))
        const nonPaid = ['pending', 'canceled', 'failed'].includes(scenario)
        const targetChecks = scenario === 'delayed' ? 27 : 2
        for (let step = 0; checks < targetChecks && step < 40; step++) { await page.clock.fastForward(30001); await page.waitForTimeout(100) }
        assert.ok(checks >= targetChecks, 'status polling must continue beyond the former one-minute limit')
        if (!nonPaid) await page.waitForFunction(() => document.querySelector('main [role=status]')?.textContent.includes('Оплата подтверждена'))
        if (scenario === 'storage-failure') {
          assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).lines.length, cartKey), 1)
          await page.evaluate(() => { window.__allowCartWrite = true; window.dispatchEvent(new Event('focus')) })
        }
        const expected = nonPaid ? [{ sku, quantity: 1 }] : scenario === 'edited' ? [{ sku, quantity: 1 }, { sku: 'SYNTHETIC-NEW-SKU', quantity: 3 }] : []
        await page.waitForFunction(({ key, expected }) => JSON.stringify(JSON.parse(localStorage.getItem(key)).lines) === JSON.stringify(expected), { key: cartKey, expected })
        const count = expected.reduce((sum, line) => sum + line.quantity, 0)
        await editPage.getByRole('link', { name: `Корзина, товаров: ${count}`, exact: true }).waitFor()
        const purchases = await page.evaluate(() => (window.dataLayer || []).filter((event) => event.ecommerce?.purchase).length)
        assert.equal(purchases, nonPaid || scenario === 'already-tracked' ? 0 : 1)
        if (!nonPaid && scenario !== 'storage-failure') {
          await page.reload({ waitUntil: 'networkidle' })
          await page.waitForFunction(() => document.querySelector('main [role=status]')?.textContent.includes('Оплата подтверждена'))
          assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).lines, cartKey), expected)
          assert.equal(await page.evaluate(() => (window.dataLayer || []).filter((event) => event.ecommerce?.purchase).length), 0)
        }
        assert.equal(writes, 1)
        assert.deepEqual(errors, [])
        console.log(`PASS ${width}px ${scenario}; mocked writes only; status checks=${checks}`)
        await context.close()
      }
    }
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })
