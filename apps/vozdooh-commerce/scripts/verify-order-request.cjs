/* eslint-disable @typescript-eslint/no-require-imports -- Optional browser smoke verification. */
// Creates exactly one synthetic-contact request on the private staged preview.
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const baseURL = 'http://127.0.0.1:3411'
;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    for (const route of ['/', '/catalog', '/cart', '/checkout']) {
      assert.equal((await page.goto(baseURL + route)).status(), 200)
      assert.match(await page.locator('meta[name="robots"]').first().getAttribute('content'), /noindex/)
    }
    assert.match(await (await page.request.get(baseURL + '/robots.txt')).text(), /Disallow: \//)
    await page.goto(baseURL + '/catalog')
    await page.locator('.productCard').first().click()
    await page.getByRole('button', { name: 'Добавить в корзину', exact: true }).click()
    await page.getByRole('link', { name: 'Перейти в корзину →', exact: true }).click()
    await page.getByRole('link', { name: 'Перейти к оформлению', exact: true }).click()
    await page.getByLabel('Имя', { exact: true }).fill('Synthetic Preview Test')
    await page.getByLabel('Телефон', { exact: true }).fill('+7 000 000 00 00')
    await page.getByLabel('Комментарий', { exact: true }).fill('SYNTHETIC SMOKE TEST — DO NOT FULFILL')
    await page.getByRole('checkbox').check()
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/order-requests') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Отправить заявку', exact: true }).click()
    const response = await responsePromise
    assert.equal(response.status(), 201)
    const result = await response.json()
    await page.getByRole('heading', { name: 'Заявка получена', exact: true }).waitFor()
    assert.equal(result.status, 'request_received')
    assert.ok(result.totalMinor > 0)
    const retry = await page.request.post(baseURL + '/api/order-requests', {
      headers: { Origin: baseURL, 'Content-Type': 'application/json' }, data: response.request().postDataJSON(),
    })
    assert.equal(retry.status(), 201)
    assert.deepEqual(await retry.json(), result)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile checkout overflow')
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ passed: true, syntheticRequestId: result.id, retryKey: response.request().postDataJSON().retryKey, totalMinor: result.totalMinor }))
  } finally { await browser.close() }
})().catch((error) => { console.error(error.message); process.exitCode = 1 })
