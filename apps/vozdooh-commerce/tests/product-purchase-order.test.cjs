const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '../app/catalog/[slug]/page.tsx'), 'utf8')
const info = source.slice(source.indexOf('<div className="productInfo">'), source.indexOf('<details className="productFacts">'))

test('product purchase precedes popularity disclosure and redundant catalog link', () => {
  const markers = [
    '<h1>{productPageHeading(product)}</h1>',
    'className="productTranslation"',
    'className="productSubtitle"',
    'className="productPurchase"',
    'className="productPrice"',
    'className="stockState"',
    '<AddToCartButton product={product} />',
    'className="productDeliveryOptions"',
    'className="notice"',
    '</section>}',
    'className="popularityNote"',
    'className="productBack"',
  ]
  let previous = -1
  for (const marker of markers) {
    const position = info.indexOf(marker)
    assert.ok(position > previous, `${marker} must exist in purchase/content order`)
    previous = position
  }
  assert.match(info, /isExternallyConfirmedPopular\(product.trade.sku\) && <p className="popularityNote">\{POPULARITY_NOTE\}/)
  for (const href of ['/delivery', '/khabarovsk', '/payment']) {
    assert.ok(info.includes(`href="${href}"`), `preserve disclosure link ${href}`)
  }
  assert.ok(source.indexOf('className="productBreadcrumb"') < source.indexOf('className="productLayout"'))
})
