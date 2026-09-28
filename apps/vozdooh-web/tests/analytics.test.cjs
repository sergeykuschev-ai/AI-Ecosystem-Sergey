/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const { analyticsEnabled, trackEvent, productPayload } = require('../src/integrations/analytics.ts')

function fakeWindow() {
  const calls = []
  const win = {
    __vozdoohAnalyticsId: undefined,
    ym: (...args) => calls.push(args),
  }
  return { win, calls }
}

let originalWindow
beforeEach(() => { originalWindow = globalThis.window })
afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window
  else globalThis.window = originalWindow
})

test('trackEvent is a safe no-op until a counter id is configured', () => {
  delete globalThis.window
  assert.equal(analyticsEnabled(), false)
  assert.doesNotThrow(() => trackEvent('view_item', { item_id: 'SKU-1' }))
  assert.doesNotThrow(() => trackEvent('scent_finder', { family: 'woody' }))
})

test('trackEvent forwards the event and params to ym only when enabled', () => {
  const { win, calls } = fakeWindow()
  globalThis.window = win
  assert.equal(analyticsEnabled(), false)
  trackEvent('add_to_cart', { item_id: 'SKU-1' })
  assert.equal(calls.length, 0)

  win.__vozdoohAnalyticsId = 123456
  assert.equal(analyticsEnabled(), true)
  trackEvent('add_to_cart', { item_id: 'SKU-1', quantity: 1 })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], [123456, 'params', { event: 'add_to_cart', item_id: 'SKU-1', quantity: 1 }])
})

test('productPayload carries only non-personal catalog facts', () => {
  const payload = productPayload({
    trade: { sku: 'SKU-1', brand: 'CULTI MILANO', category: 'Диффузоры', price: 11200 },
    editorial: { slug: 'culti-decor-aramara-250' },
  })
  assert.deepEqual(payload, {
    item_id: 'SKU-1',
    item_brand: 'CULTI MILANO',
    item_category: 'Диффузоры',
    price: 11200,
    slug: 'culti-decor-aramara-250',
  })
  const serialized = JSON.stringify(payload)
  for (const forbidden of ['phone', 'name', 'address', 'comment', 'email', 'contact']) {
    assert.ok(!serialized.includes(forbidden), `payload leaks ${forbidden}`)
  }
})

test('cart quantity events use one-unit add/remove semantics', () => {
  const { win, calls } = fakeWindow()
  win.__vozdoohAnalyticsId = 42
  globalThis.window = win
  const product = { trade: { sku: 'SKU-9', brand: null, category: 'Аксессуары', price: 800 }, editorial: { slug: 'slug-9' } }
  trackEvent('add_to_cart', { ...productPayload(product), quantity: 1 })
  trackEvent('remove_from_cart', { ...productPayload(product), quantity: 1 })
  assert.equal(calls.length, 2)
  assert.equal(calls[0][2].event, 'add_to_cart')
  assert.equal(calls[0][2].quantity, 1)
  assert.equal(calls[1][2].event, 'remove_from_cart')
  assert.equal(calls[1][2].quantity, 1)
})
