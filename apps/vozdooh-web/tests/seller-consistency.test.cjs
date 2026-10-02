/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
require.extensions['.tsx'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  })
  module._compile(outputText, filename)
}
const render = (component) => renderToStaticMarkup(React.createElement(component))

test('footer and legal seller block retain the owner-confirmed public identity', () => {
  const { SiteFooter } = require('../components/SiteFooter.tsx')
  const { SellerRequisites } = require('../components/InfoPage.tsx')
  // Public business facts confirmed in issue #192, not customer fixtures.
  for (const html of [render(SiteFooter), render(SellerRequisites)]) {
    for (const fact of ['ИП Кущев Сергей Васильевич', '270393428446', '322270000003316', 'г. Хабаровск', 'Павла Морозова, 97']) {
      assert.ok(html.includes(fact), `Missing confirmed seller fact: ${fact}`)
    }
    assert.match(html, /href="tel:\+79244199990"/)
    assert.match(html, /href="mailto:vozdooh.kms@yandex.ru"/)
  }
})

test('footer customer information links resolve to implemented pages', () => {
  const { SiteFooter } = require('../components/SiteFooter.tsx')
  const html = render(SiteFooter)
  for (const route of ['delivery', 'payment', 'returns', 'contacts', 'privacy', 'offer', 'user-agreement']) {
    assert.ok(html.includes(`href="/${route}"`), `Missing footer route: ${route}`)
    const page = require(`../app/${route}/page.tsx`)
    assert.equal(typeof page.default, 'function')
    assert.equal(page.metadata.robots.index, false)
    assert.ok(render(page.default).includes('<h1>'))
  }
})
