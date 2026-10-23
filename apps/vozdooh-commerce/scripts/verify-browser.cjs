/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS verification runner. */
// Run against a local production build. Playwright is optional verification tooling.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const localCatalog = process.env.VOZDOOH_TEST_CATALOG === 'local-1c';
const stagedCatalog = process.env.VOZDOOH_TEST_CATALOG === 'staged-1c';
const importedCatalog = localCatalog || stagedCatalog;
const demoCatalog = !importedCatalog;
const baseURL = process.env.VOZDOOH_TEST_URL || 'http://127.0.0.1:3187';

require('./register-typescript.cjs');

// Derive homepage/catalog expectations from the same catalog pipeline the pages
// use, so the assertions track real data instead of drifting copy. Requires
// ONEC_LOCAL_CATALOG_PATH for the imported (local-1c / staged-1c) sources.
async function storefrontExpectations() {
  if (!demoCatalog && !process.env.ONEC_LOCAL_CATALOG_PATH) {
    throw new Error('Set ONEC_LOCAL_CATALOG_PATH for imported-catalog checks');
  }
  process.env.CATALOG_PROVIDER = demoCatalog ? 'demo' : stagedCatalog ? 'staged-1c' : 'local-1c';
  const { getCatalogRepository } = require('../src/catalog/source.ts');
  const { withValidImages } = require('../src/catalog/validImages.ts');
  const { storefrontProducts, curatorSelection } = require('../src/catalog/presentation.ts');
  const { applyCatalogFilters } = require('../src/catalog/filters.ts');
  const { roomLabels, familyLabels } = require('../src/catalog/vocabulary.ts');
  const all = await withValidImages(await (await getCatalogRepository()).list());
  const visible = storefrontProducts(all);
  const sellable = visible.filter((product) => (product.trade.stock ?? 0) > 0);
  const blank = { brand: null, category: null, family: null, mood: null, room: null };
  // A valid family+room pair with zero intersection exercises the honest empty state.
  let emptyCombo = null;
  for (const family of Object.keys(familyLabels)) {
    for (const room of Object.keys(roomLabels)) {
      if (applyCatalogFilters(visible, { ...blank, family, room }).length === 0) { emptyCombo = { family, room }; break; }
    }
    if (emptyCombo) break;
  }
  return {
    visible: visible.length,
    curated: curatorSelection(sellable).length,
    rooms: Object.keys(roomLabels).filter((room) => sellable.some((product) => product.editorial.room === room)).length,
    woody: applyCatalogFilters(visible, { ...blank, family: 'woody' }).length,
    emptyCombo,
    firstStock: visible[0] ? visible[0].trade.stock ?? 0 : 0,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const exp = await storefrontExpectations();
    for (const width of [320, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(baseURL);
      await page.locator('.category').first().waitFor();
      assert.equal(await page.locator('.category').count(), 6);
      assert.equal(await page.locator('.roomCard').count(), exp.rooms);
      assert.equal(await page.locator('.productCard, .demoTag').count(), 0);
      assert.match(await page.locator('.selectionStatus').innerText(), /актуального наличия/i);
      assert.doesNotMatch(await page.locator('main').innerText(), /Коллекция готовится|Готовим знакомство|Мы готовим|DEMO|Демонстрационн|недоступны к покупке|не доступны к покупке|синхронизац|noindex|фото ожидается|Фото после/i);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Homepage overflow at ${width}`);
      for (const selector of ['.category', '.roomCard', '.homeBrandCard', 'footer nav a']) {
        assert.ok(await page.locator(selector).evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height >= 44)), `Tap targets: ${selector}`);
      }
      // Room tiles deep-link into the catalog, which resolves in every source.
      for (const href of await page.locator('.roomCard').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))) {
        const response = await page.request.get(`${baseURL}${href}`);
        assert.equal(response.status(), 200, href);
      }
      // Category landings resolve only where real categories bind to them. The demo
      // placeholder uses internal English category keys that never bind to the
      // Russian-named landings, so its landing routes stay unchecked (demo-only gap).
      if (stagedCatalog) {
        for (const href of await page.locator('.category').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))) {
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
    for (const route of ['/catalog', '/finder', '/cart', '/checkout', '/brands', '/collections', '/api/health']) {
      assert.equal((await page.request.get(`${baseURL}${route}`)).status(), 200, route);
    }
    assert.match(await (await page.request.get(`${baseURL}/robots.txt`)).text(),  /Disallow: \//);
    assert.equal((await page.request.get(`${baseURL}/catalog/unknown-product`)).status(), 404);
    await page.goto(`${baseURL}/catalog`);
    assert.match(await page.locator('meta[name="robots"]').first().getAttribute('content'), /noindex/);
    if (importedCatalog) {
      assert.equal(await page.locator('.catalogGrid .productCard').count(), exp.visible);
      assert.equal(await page.locator('.curatorGrid .productCard').count(), exp.curated);
      if (stagedCatalog) {
        assert.doesNotMatch(await page.locator('.catalogGrid').innerText(), /Демонстрационный товар|DEMO/);
        await page.locator('.catalogGrid .productCard').first().click();
        // Prices are published from the selected 1C price type; the purchase panel is live.
        assert.match(await page.locator('.productPrice').innerText(), /₽/);
        assert.doesNotMatch(await page.locator('.productPrice').innerText(), /Цена не указана/);
        assert.match(await page.locator('.stockState').innerText(), /В наличии/);
        assert.ok((await page.getByRole('button', { name: 'Добавить в корзину' }).count()) >= 1);
        await page.locator('.productFacts summary').click();
        assert.match(await page.locator('.productMetaList').innerText(), /артикул/i);
        assert.ok((await page.locator('.recommendations').count()) >= 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Imported product overflow');
        await page.screenshot({ path: '/tmp/vozdooh-imported-product.png', fullPage: true });
      }
    }
    await page.goto(`${baseURL}/finder`);
    if (demoCatalog) {
      for (const label of ['Древесные', 'Спокойствие', 'Кабинет', 'Диффузоры']) {
        await page.getByRole('button', { name: label, exact: true }).click();
      }
      await page.locator('.quizResult a').click();
      await page.waitForURL('**/catalog?**');
      assert.equal(await page.locator('.catalogGrid .productCard').count(), 1);
    } else if (stagedCatalog) {
      await page.getByRole('button', { name: 'Древесные', exact: true }).click();
      await page.locator('.quizResult a').click();
      await page.waitForURL('**/catalog?**');
      assert.equal(await page.locator('.catalogGrid .productCard').count(), exp.woody);
    }
    // The add-to-cart → cart → checkout flow needs a purchasable staged-1c product;
    // demo hides the purchase panel and the local-1c fixture has no pictured products.
    if (stagedCatalog) {
      await page.goto(`${baseURL}/catalog`);
      await page.locator('.catalogGrid .productCard').first().click();
      await page.getByRole('button', { name: 'Добавить в корзину', exact: true }).click();
      await page.locator('.addToCart a').click();
      // Quantity stepper increases and the choice persists across reload.
      await page.getByRole('button', { name: 'Увеличить количество' }).click();
      assert.equal(await page.locator('.qtyControl b').innerText(), '2');
      await page.reload();
      await page.locator('.cartRow').waitFor();
      assert.equal(await page.locator('.qtyControl b').innerText(), '2');
      // The stock guard must refuse a quantity above the 1C stock, then allow a valid one.
      const exceedsStock = exp.firstStock > 0 && 2 > exp.firstStock;
      await page.getByRole('link', { name: 'Оформить заявку' }).click();
      await page.locator('button[form="request-form"]').waitFor();
      assert.equal(await page.locator('button[form="request-form"]').isDisabled(), exceedsStock);
      if (exceedsStock) {
        await page.getByText('Проверьте количество, наличие и цены в корзине.', { exact: true }).waitFor();
        await page.goto(`${baseURL}/cart`);
        await page.getByRole('button', { name: 'Уменьшить количество' }).click();
        await page.getByRole('link', { name: 'Оформить заявку' }).click();
        await page.locator('button[form="request-form"]').waitFor();
        assert.equal(await page.locator('button[form="request-form"]').isDisabled(), false);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Checkout overflow');
      await page.goto(`${baseURL}/cart`);
      await page.getByRole('button', { name: 'Убрать из корзины' }).click();
      await page.getByRole('heading', { name: 'Корзина пока пуста' }).waitFor();
    }
    // Switching sources must not hide persistent cart entries or produce /undefined links.
    await page.evaluate(() => localStorage.setItem('vozdooh-cart-v1', JSON.stringify({ lines: [{ sku: 'MISSING-SKU', quantity: 1 }] })));
    await page.goto(`${baseURL}/cart`);
    await page.getByText('Позиция отсутствует в текущем каталоге', { exact: true }).waitFor();
    assert.equal(await page.locator('a[href*="undefined"]').count(), 0);
    await page.goto(`${baseURL}/checkout`);
    await page.getByText('Позиция отсутствует в текущем каталоге', { exact: true }).waitFor();
    assert.equal(await page.locator('button[form="request-form"]').isDisabled(), true);
    await page.goto(`${baseURL}/cart`);
    await page.getByRole('button', { name: 'Убрать из корзины' }).click();
    await page.getByRole('heading', { name: 'Корзина пока пуста' }).waitFor();
    if (stagedCatalog && exp.emptyCombo) {
      // A valid family+room pair with zero matches must render the honest empty state.
      await page.goto(`${baseURL}/catalog?family=${exp.emptyCombo.family}&room=${exp.emptyCombo.room}`);
      await page.getByRole('heading', { name: 'Ничего не найдено' }).waitFor();
      assert.equal(await page.locator('.catalogGrid .productCard').count(), 0);
    }
    assert.deepEqual(errors, [], 'Browser runtime errors');
    console.log('Menu, finder filters, product, cart quantity/persistence/removal, checkout states: passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
