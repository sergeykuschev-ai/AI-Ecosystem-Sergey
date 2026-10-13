const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

test('homepage, brands, categories, collections and priority products address buyers across Russia', () => {
  for (const p of ['app/page.tsx', 'app/brands/[slug]/page.tsx', 'app/categories/[slug]/page.tsx', 'app/collections/[slug]/page.tsx', 'app/catalog/[slug]/page.tsx', 'src/catalog/productSeo.ts']) {
    const source = read(p)
    assert.match(source, /доставк[а-я]* по России/)
    assert.doesNotMatch(source, /купить в Хабаровске|Купить в Хабаровске|в Хабаровске — купить/)
  }
})

test('delivery page does not claim shipping price is included in product payment', () => {
  const source = read('app/delivery/page.tsx')
  assert.match(source, /Стоимость доставки подтверждается отдельно/)
  assert.match(source, /не включена в сумму оплаты товаров/)
  assert.match(source, /Пункты Ozon по России/)
  assert.doesNotMatch(source, /бесплатная доставка|доставка за 1 день/)
})
