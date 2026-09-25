/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.tsx'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  })
  module._compile(outputText, filename)
}
const { submitRequest } = require('../src/commerce/submitRequest.ts')
const receipt = { id: '00000000-0000-4000-8000-000000000001', totalMinor: 100, createdAt: '2026-09-25T00:00:00Z', currency: 'RUB', status: 'request_received' }

test('submission preserves payload and returns only a validated receipt', async () => {
  const payload = { retryKey: receipt.id }
  assert.deepEqual(await submitRequest(payload, async (url, options) => {
    assert.equal(url, '/api/order-requests')
    assert.deepEqual(JSON.parse(options.body), payload)
    assert.ok(options.signal)
    return Response.json(receipt, { status: 201 })
  }), receipt)
  for (const invalid of [null, {}, { ...receipt, status: 'paid' }, { ...receipt, totalMinor: -1 }, { ...receipt, createdAt: 'invalid' }, { ...receipt, id: '-'.repeat(36) }]) {
    await assert.rejects(() => submitRequest(payload, async () => Response.json(invalid)), /INVALID_RECEIPT/)
  }
  await assert.rejects(() => submitRequest(payload, async () => Response.json({ code: 'PRICE_CHANGED' }, { status: 409 })), (error) => error.code === 'PRICE_CHANGED')
})

test('stalled submission aborts; caller can retry with unchanged key', async () => {
  const payload = { retryKey: receipt.id }
  await assert.rejects(() => submitRequest(payload, async (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }), 5), /aborted/)
  assert.equal(payload.retryKey, receipt.id)
  assert.deepEqual(await submitRequest(payload, async () => Response.json(receipt)), receipt)
})

test('error and missing-page UI provide recovery without exposing exceptions', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const ErrorPage = require('../app/error.tsx').default
  const NotFound = require('../app/not-found.tsx').default
  const html = renderToStaticMarkup(React.createElement(ErrorPage, { retry() {}, error: new Error('PRIVATE DATA') }))
  assert.match(html, /role="alert"/)
  assert.match(html, /Повторить загрузку/)
  assert.doesNotMatch(html, /PRIVATE DATA/)
  assert.match(renderToStaticMarkup(React.createElement(NotFound)), /href="\/catalog"/)
})


test('preview headers keep every route unindexed and checkout has one page heading', async () => {
  const config = require('../next.config.ts').default
  const rules = await config.headers()
  assert.ok(rules.some((rule) => rule.source === '/(.*)' && rule.headers.some((header) => header.key === 'X-Robots-Tag' && header.value === 'noindex, nofollow')))
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { CheckoutForm } = require('../components/CheckoutForm.tsx')
  const html = renderToStaticMarkup(React.createElement(CheckoutForm, { products: [], enabled: false }))
  assert.match(html, /<h2>Корзина пуста<\/h2>/)
  assert.doesNotMatch(html, /<h1>/)
})
