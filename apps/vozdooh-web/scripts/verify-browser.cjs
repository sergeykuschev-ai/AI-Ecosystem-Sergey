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
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(baseURL);
      await page.locator('.categoryArt').first().waitFor();
      assert.equal(await page.locator('.category').count(), 6);
      assert.equal(await page.locator('.roomCard').count(), 5);
      assert.equal(await page.locator('.products .demoTag').count(), 4);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Homepage overflow at ${width}`);
      if (width < 800) {
        const cards = await page.locator('.products .productCard').evaluateAll(nodes => nodes.slice(0, 2).map(node => node.getBoundingClientRect().top));
        assert.equal(cards[0], cards[1], 'Mobile products must be two-up');
      }
      assert.doesNotMatch(await page.locator('footer').innerText(), /1С|noindex|синхронизац/);
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
