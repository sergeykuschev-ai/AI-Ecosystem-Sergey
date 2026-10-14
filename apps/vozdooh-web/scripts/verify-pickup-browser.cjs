/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in browser verification. */
// All order/payment/Ozon writes are intercepted. This check never creates live orders.
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const baseURL = process.env.VOZDOOH_QA_URL || 'http://127.0.0.1:3436'
const sku = process.env.VOZDOOH_QA_SKU
if (!sku) throw new Error('VOZDOOH_QA_SKU_REQUIRED')
const shippingCity = process.env.VOZDOOH_QA_SHIPPING_CITY || 'Synthetic city'
const quoteRub = Number(process.env.VOZDOOH_QA_QUOTE_RUB || 0)
const address = 'Хабаровск, ул. Павла Морозова, 97'
;(async () => {
  const browser = await chromium.launch({ proxy: process.env.VOZDOOH_QA_PROXY ? { server: process.env.VOZDOOH_QA_PROXY } : undefined, executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] })
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      await context.addInitScript(({ sku, origin }) => { if (location.origin === origin) localStorage.setItem('vozdooh-cart-v1', JSON.stringify({ lines: [{ sku, quantity: 1 }] })) }, { sku, origin: new URL(baseURL).origin })
      for (const method of ['pickup', 'courier', 'ozon-pvz']) {
        const page = await context.newPage()
        const errors = []; const calls = []; let payload
        page.on('pageerror', (error) => errors.push(error.message))
        // Block analytics and every outgoing write except explicitly mocked checkout APIs.
        await page.route('**/*', async (route) => {
          const request = route.request(); const url = new URL(request.url())
          if (url.origin !== new URL(baseURL).origin) return route.abort()
          if (request.method() === 'GET') return route.continue()
          calls.push(url.pathname)
          if (url.pathname === '/api/order-requests') {
            payload = request.postDataJSON()
            return route.fulfill({ status: 201, json: { id: '11111111-1111-4111-8111-111111111111', createdAt: new Date().toISOString(), totalMinor: payload.lines.reduce((sum, line) => sum + line.expectedPriceMinor * line.quantity, 0), currency: 'RUB', status: 'request_received' } })
          }
          if (url.pathname === '/api/ozon/pickup-points') {
            assert.equal(request.postDataJSON().query, shippingCity)
            return route.fulfill({ json: { delivery_points: [{ delivery_point_id: 12, name: 'Synthetic Ozon point', full_address: `${shippingCity}, synthetic destination`, shipment_method_ids: [13] }] } })
          }
          if (url.pathname === '/api/ozon/delivery-quote') return quoteRub > 0 ? route.fulfill({ json: { productTotalMinor: payload.lines.reduce((sum, line) => sum + line.expectedPriceMinor * line.quantity, 0), estimatedTotalDeliveryRub: quoteRub, estimatedCombinedTotalMinor: payload.lines.reduce((sum, line) => sum + line.expectedPriceMinor * line.quantity, 0) + Math.round(quoteRub * 100), estimatedDeliveryDays: 15, deliveryIncludedInPayment: false, provisionalLogistics: true } }) : route.fulfill({ status: 503, json: { code: 'SYNTHETIC_QUOTE_UNAVAILABLE' } })
          if (url.pathname === '/api/payments/ozon/create') return route.fulfill({ json: { redirectUrl: 'https://pay.example.test/synthetic' } })
          return route.abort()
        })
        await page.goto(`${baseURL}/checkout`, { waitUntil: 'networkidle' })
        await page.locator('input[name=delivery]').first().waitFor()
        assert.equal(await page.locator('input[name=delivery]').count(), 3)
        await page.getByRole('radio', { name: method === 'pickup' ? 'Самовывоз — бесплатно' : method === 'courier' ? 'Доставка курьером' : 'Пункт Ozon', exact: true }).check()
        await page.getByLabel('Имя', { exact: true }).fill('Synthetic Browser')
        await page.getByLabel('Телефон', { exact: true }).fill('+70000000000')
        await page.getByLabel('Email', { exact: true }).fill('pickup@example.test')
        await page.locator('input[name=consent]').check()
        if (method === 'pickup') {
          assert.equal(await page.locator('#checkout-address:visible').count(), 0)
          assert.equal(await page.locator('#pvz-search').count(), 0)
          assert.equal(await page.locator('input[type=hidden][name=address]').inputValue(), address)
        } else if (method === 'courier') await page.getByLabel('Адрес', { exact: true }).fill('Synthetic courier destination')
        else {
          await page.locator('#pvz-search').fill(shippingCity)
          await page.getByRole('button', { name: 'Найти ПВЗ' }).click()
          await page.locator('input[name=pvzId]').check()
        }
        await page.getByRole('button', { name: 'Оформить заказ', exact: true }).click()
        await page.getByRole('heading', { name: 'Заказ оформлен — ожидает оплаты' }).waitFor()
        assert.equal(payload.delivery.method, method)
        if (method === 'ozon-pvz') assert.ok(payload.delivery.address.includes(shippingCity))
        if (method === 'pickup') {
          assert.equal(payload.delivery.address, address)
          assert.equal(payload.delivery.deliveryPointId, undefined)
          assert.equal(payload.delivery.shipmentMethodId, undefined)
          assert.ok((await page.locator('main').innerText()).includes('Самовывоз — бесплатно (0 руб.)'))
          assert.doesNotMatch(await page.locator('main').innerText(), /тариф|Перед отправкой|Доставка оплачивается/)
        }
        if (method === 'ozon-pvz') {
          await page.getByText(quoteRub > 0 ? 'Предварительная стоимость доставки Ozon:' : 'Не удалось получить надёжный тариф Ozon', { exact: false }).waitFor()
          assert.match(await page.locator('main').innerText(), /Стоимость доставки не входит в оплату товаров/)
          if (quoteRub > 0) assert.ok((await page.getByText('Предварительная стоимость доставки Ozon:', { exact: false }).innerText()).includes(String(quoteRub)))
        }
        await page.waitForTimeout(200)
        assert.equal(calls.includes('/api/ozon/delivery-quote'), method === 'ozon-pvz')
        assert.equal(calls.includes('/api/ozon/pickup-points'), method === 'ozon-pvz')
        await page.getByRole('button', { name: 'Оплатить через Ozon Pay' }).click()
        await page.waitForTimeout(200)
        assert.ok(calls.includes('/api/payments/ozon/create'))
        assert.equal(calls.filter((url) => url === '/api/order-requests').length, 1)
        assert.deepEqual(errors, [])
        console.log(`PASS ${width}px ${method}: mocked order/payment; quote=${method === 'ozon-pvz'}`)
        await page.close()
      }
      await context.close()
    }
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })
