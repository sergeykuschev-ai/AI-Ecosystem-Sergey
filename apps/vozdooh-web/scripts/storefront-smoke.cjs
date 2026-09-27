/* eslint-disable @typescript-eslint/no-require-imports -- Optional browser QA, no runtime dependency. */
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.VOZDOOH_QA_URL || 'http://127.0.0.1:3427'

async function main() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    // Always intercept writes: browser QA must never create a real request.
    const attempts = []
    await page.route('**/api/order-requests', async (route) => {
      attempts.push(route.request().postDataJSON())
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNAVAILABLE' }) })
    })
    await page.goto(base + '/catalog', { waitUntil: 'networkidle' })
    const catalogCards = await page.locator('.catalogGrid .productCard').evaluateAll((cards) => cards.map((card) => ({ href: card.getAttribute('href'), price: card.querySelector('.productCardPrice')?.textContent })))
    assert.ok(catalogCards.length > 0)
    assert.ok(catalogCards.every((card) => /₽/.test(card.price)), 'Every staged card has a positive RUB price')
    // Cover both section modes with the actual staged catalog; never submit requests.
    let explicit = 0, fallback = 0
    for (const card of catalogCards) {
      await page.goto(base + card.href, { waitUntil: 'domcontentloaded' })
      const brandSection = page.locator('section[aria-labelledby="same-brand-heading"]')
      const editorialHeading = page.getByRole('heading', { name: 'Вам также может понравиться', exact: true })
      const hasBrand = await brandSection.count()
      const hasEditorial = await editorialHeading.count()
      assert.ok(!(hasBrand && hasEditorial), 'Never mix editorial recommendations and brand navigation')
      if (hasBrand) {
        fallback++
        assert.equal(await brandSection.locator('h2').innerText(), 'Ещё из бренда')
        assert.ok(await brandSection.locator('.productCard').count() <= 3)
        const brand = await page.locator('.productInfo > .eyebrow').innerText()
        assert.ok((await brandSection.locator('.productCardMeta > span:first-child').allInnerTexts()).every((value) => value === brand))
      }
      if (hasEditorial) explicit++
      if (explicit && fallback) break
    }
    assert.ok(explicit && fallback, 'Staged QA covers explicit and same-brand sections')
    const productHref = catalogCards[0].href
    assert.ok(productHref)
    await page.goto(base + productHref, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Добавить в корзину', exact: true }).click()
    await page.getByRole('link', { name: 'Перейти в корзину →' }).click()
    await page.locator('.cartRow').first().waitFor()
    assert.equal(await page.locator('.cartRow').count(), 1)
    assert.equal(await page.locator('.cartRowVisual img').count(), 1)
    await page.getByRole('button', { name: 'Увеличить количество' }).click()
    assert.equal(await page.locator('.qtyControl b').innerText(), '2')
    await page.getByRole('button', { name: 'Уменьшить количество' }).click()
    await page.getByRole('link', { name: 'Оформить заявку' }).click()
    await page.locator('#checkout-name').waitFor()
    assert.equal(await page.locator('#checkout-address').isVisible(), false)
    await page.getByText('Доставка курьером', { exact: true }).click()
    assert.equal(await page.locator('#checkout-address').isVisible(), true)
    assert.equal(await page.locator('#checkout-address').getAttribute('required'), '')
    await page.locator('#checkout-address').fill('Synthetic QA address')
    await page.getByText('Самовывоз', { exact: true }).click()
    await page.locator('#checkout-name').fill('Synthetic QA')
    await page.locator('#checkout-phone').fill('+79990000000')
    await page.getByRole('button', { name: 'Отправить заявку' }).click()
    assert.equal(attempts.length, 0, 'Consent must be required')
    await page.locator('[name=consent]').check()
    await page.getByRole('button', { name: 'Отправить заявку' }).click()
    await page.locator('#request-form [role=alert]').waitFor()
    await page.getByRole('button', { name: 'Отправить заявку' }).click()
    await page.waitForFunction(() => !document.querySelector('#request-form').getAttribute('aria-busy').includes('true'))
    assert.equal(attempts.length, 2)
    assert.deepEqual(attempts[0], attempts[1], 'Retry keeps the same payload and key')
    assert.equal(attempts[0].delivery.address, '')
    assert.equal(attempts[0].delivery.method, 'pickup')
    assert.equal(attempts[0].consent, true)
    assert.ok(attempts[0].lines[0].expectedPriceMinor > 0)
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      for (const route of ['/', '/catalog', productHref, '/cart', '/checkout', '/brands', '/categories', '/finder']) {
        const response = await page.goto(base + route, { waitUntil: 'networkidle' })
        assert.equal(response.status(), 200, route)
        assert.match(response.headers()['x-robots-tag'], /noindex/)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} overflows at ${width}`)
        assert.doesNotMatch(await page.locator('body').innerText(), /PREVIEW 1C|DEMO|Фото ожидается|debugCatalog|demandRank|demand_score/)
        assert.ok(await page.locator('.productCard').evaluateAll((cards) => cards.every((card) => {
          const nodes = [...card.querySelector('.productCardMeta').children]
          return nodes.every((node, index) => {
            const rect = node.getBoundingClientRect()
            const previous = index ? nodes[index - 1].getBoundingClientRect() : null
            return rect.width > 0 && rect.height > 0 && (!previous || rect.top >= previous.bottom - 1) && node.scrollWidth <= node.clientWidth + 1
          })
        })), `${route} card text overlaps or overflows at ${width}`)
        if (route === productHref) assert.ok(await page.locator('.productPrice').isVisible())
        if (route === '/catalog') {
          await page.locator('.filterDisclosure summary').click()
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          assert.ok(await page.locator('.filterPanel select, .filterPanel button').evaluateAll((nodes) => nodes.every((node) => node.getBoundingClientRect().height >= 44)))
        }
      }
    }
    await page.goto(base + '/catalog', { waitUntil: 'networkidle' })
    await page.locator('.filterDisclosure summary').click()
    const select = page.locator('select[name=brand]')
    const value = await select.locator('option').nth(1).getAttribute('value')
    await select.selectOption(value)
    await page.getByRole('button', { name: 'Показать ароматы' }).click()
    assert.equal(new URL(page.url()).searchParams.get('brand'), value)
    await page.locator('.catalogGrid .productCard').first().click()
    await page.getByRole('link', { name: '← Каталог', exact: true }).click()
    assert.equal(new URL(page.url()).searchParams.get('brand'), value)
    assert.deepEqual(errors, [])
    console.log('PASS: 32 route/viewport checks, card prices/text geometry, cross-sell headings, no debug labels, filters and URL round-trip, cart quantities, consent, pickup/courier, retry payload, noindex; all request writes intercepted.')
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
