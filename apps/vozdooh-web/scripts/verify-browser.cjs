/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS verification runner. */
// Run against a local production build. Playwright is optional verification tooling.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.VOZDOOH_TEST_URL || 'http://127.0.0.1:3187';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [320, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(baseURL);
      await page.locator('.category').first().waitFor();
      assert.equal(await page.locator('.category').count(), 6);
      assert.equal(await page.locator('.roomCard').count(), 5);
      assert.equal(await page.locator('.productCard, .demoTag').count(), 0);
      assert.match(await page.locator('.selectionStatus').innerText(), /Искусство выбирать/i);
      assert.doesNotMatch(await page.locator('main').innerText(), /Коллекция готовится|Готовим знакомство|Мы готовим|DEMO|Демонстрационн|недоступны к покупке|не доступны к покупке|синхронизац|noindex|фото ожидается|Фото после/i);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Homepage overflow at ${width}`);
      for (const selector of ['.category', '.roomCard', '.brandPlaceholder a', 'footer nav a']) {
        assert.ok(await page.locator(selector).evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height >= 44)), `Tap targets: ${selector}`);
      }
      for (const selector of ['.category', '.roomCard']) {
        for (const href of await page.locator(selector).evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))) {
          const response = await page.request.get(`${baseURL}${href}`);
          assert.equal(response.status(), 200, href);
        }
      }
      assert.doesNotMatch(await page.locator('footer').innerText(), /1С|noindex|синхронизац/);
      await page.locator('.footerLogo').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('.footerLogo img').evaluate(async img => {
        await img.decode();
        return img.naturalWidth > 0 && img.getBoundingClientRect().width >= 140;
      }), 'Footer logo loaded and legible');
      assert.match(await page.locator('.footerLogo img').getAttribute('src'), /vozdooh-horizontal/);
      await page.screenshot({ path: `/tmp/vozdooh-home-${width}.png`, fullPage: true });
      console.log(`Homepage layout: ${width}px passed`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.menuTrigger').click();
    assert.equal(await page.locator('.menuTrigger').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.menuTrigger').getAttribute('aria-expanded'), 'false');
    await page.goto(`${baseURL}/finder`);
    for (const label of ['Древесные', 'Спокойствие', 'Кабинет', 'Диффузоры']) {
      await page.getByRole('button', { name: label, exact: true }).click();
    }
    await page.locator('.quizResult a').click();
    await page.waitForURL('**/catalog?**');
    assert.equal(await page.locator('.productCard').count(), 1);
    await page.locator('.productCard').click();
    await page.getByRole('button', { name: 'Добавить в корзину', exact: true }).click();
    await page.locator('.addToCart a').click();
    await page.getByRole('button', { name: 'Увеличить количество' }).click();
    assert.equal(await page.locator('.qtyControl b').innerText(), '2');
    await page.reload();
    await page.locator('.cartRow').waitFor();
    assert.equal(await page.locator('.qtyControl b').innerText(), '2');
    await page.getByRole('link', { name: 'Перейти к оформлению' }).click();
    await page.locator('.submitDisabled').waitFor();
    assert.equal(await page.locator('.submitDisabled').isDisabled(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Checkout overflow');
    await page.goto(`${baseURL}/cart`);
    await page.getByRole('button', { name: 'Убрать из корзины' }).click();
    await page.getByRole('heading', { name: 'Корзина пока пуста' }).waitFor();
    assert.deepEqual(errors, [], 'Browser runtime errors');
    console.log('Menu, finder filters, product, cart quantity/persistence/removal, disabled checkout: passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
