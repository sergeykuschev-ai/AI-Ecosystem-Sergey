/* Regression coverage for the compact mobile homepage/navigation. */
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const read = (p) => readFileSync(resolve(__dirname, p), 'utf8')

test('mobile footer uses grouped links and compact legal information', () => {
  const footer = read('../components/SiteFooter.tsx')
  const css = read('../app/globals.css')
  assert.match(footer, /className="siteFooter"/)
  assert.match(footer, /Магазин/)
  assert.match(footer, /Покупателям/)
  assert.match(css, /\.siteFooter nav\{display:grid/)
  assert.match(css, /\.siteFooter \.footerNote\{[^}]*display:block/)
})

test('home SEO discovery links remain in markup but can be collapsed', () => {
  const component = read('../components/ContextualCatalogLinks.tsx')
  assert.match(component, /currentPath === '\/'/)
  assert.match(component, /<details className="landingGuideDetails">/)
  assert.match(component, /sections\.map\(item => <Link/)
  assert.match(component, /examples\.map\(item => <Link/)
})

test('horizontal mobile discovery gives scroll cue and aligned arrows', () => {
  const page = read('../app/page.tsx')
  const css = read('../app/globals.css')
  assert.match(page, /Листайте категории/)
  assert.match(page, /Листайте комнаты/)
  assert.match(page, /className="categoryTitleRow"/)
  assert.match(css, /\.homeCategoryGrid \.categoryTitleRow b\{position:static/)
})
