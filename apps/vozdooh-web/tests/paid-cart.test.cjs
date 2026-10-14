/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const cart = require('../src/cart/storage.ts')
const { verifiedPaidOrder, applyConfirmedPayment } = require('../src/cart/confirmedPayment.ts')
const originalWindow = global.window
const originalCustomEvent = global.CustomEvent
let serial = 0
let order
let local
let session
let changes
function storage() {
  const data = new Map()
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}
beforeEach(() => {
  local = storage(); session = storage(); changes = 0
  const events = new EventTarget()
  global.CustomEvent = class extends Event {}
  global.window = { localStorage: local, sessionStorage: session, __vozdoohAnalyticsId: 42, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events), ym() {} }
  cart.subscribeCart(() => changes++)
  order = { id: `order-${++serial}`, totalMinor: 20000, currency: 'RUB', items: [{ id: 'A', name: 'Synthetic A', priceMinor: 10000, quantity: 2 }] }
})
afterEach(() => { global.window = originalWindow; global.CustomEvent = originalCustomEvent })
function snapshot() { cart.addLine('A', 2); cart.capturePaymentCart('attempt', [{ sku: 'A', quantity: 2 }]); cart.bindPaymentCart('attempt', order.id) }
function lines() { return cart.readCart().lines }
test('only verified paid state authorizes cleanup; pending/cancel/failure/submission do not', async () => {
  snapshot()
  for (const state of ['pending', 'canceled', 'failed', 'no_payment', 'request_received']) assert.equal(verifiedPaidOrder({ state, order }, order.id), null)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
  assert.equal(verifiedPaidOrder({ state: 'paid', order }, 'other'), null)
  assert.equal(verifiedPaidOrder({ state: 'paid', order: { ...order, totalMinor: 1 } }, order.id), null)
  const before = changes
  assert.equal(await applyConfirmedPayment(verifiedPaidOrder({ state: 'paid', order }, order.id)), true)
  assert.deepEqual(lines(), [])
  assert.equal(changes, before + 1)
  assert.equal(window.dataLayer.length, 1)
})
test('new SKU and increases of purchased SKU survive; repeated visits are idempotent', async () => {
  snapshot(); cart.addLine('B', 3); cart.addLine('A', 1)
  await applyConfirmedPayment(order)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 3 }])
  cart.addLine('A', 4)
  const before = changes
  await applyConfirmedPayment(order)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 5 }, { sku: 'B', quantity: 3 }])
  assert.equal(changes, before)
  assert.equal(window.dataLayer.length, 1)
})
test('decrease then increase preserves newly added units, even with equal final quantity', async () => {
  snapshot(); cart.setLineQuantity('A', 1); cart.setLineQuantity('A', 2)
  await applyConfirmedPayment(order)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 1 }])
})
test('remove/readd and clear/readd cannot delete newer units', async () => {
  snapshot(); cart.setLineQuantity('A', 0); cart.addLine('A', 2)
  await applyConfirmedPayment(order)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
  cart.clearCart(); cart.addLine('A', 4); await applyConfirmedPayment(order)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 4 }])
})
test('already tracked analytics does not skip cart cleanup', async () => {
  snapshot(); local.setItem(`vozdooh-purchase-tracked:${order.id}`, '1')
  await applyConfirmedPayment(order)
  assert.deepEqual(lines(), [])
  assert.equal(window.dataLayer, undefined)
})
test('cart write failure is retryable, does not record cleanup or duplicate analytics', async () => {
  snapshot()
  const write = local.setItem
  local.setItem = (key, value) => { if (key === 'vozdooh-cart-v1') throw new Error('quota'); write(key, value) }
  assert.equal(await applyConfirmedPayment(order), false)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
  local.setItem = write
  assert.equal(await applyConfirmedPayment(order), true)
  assert.deepEqual(lines(), [])
  assert.equal(window.dataLayer.length, 1)
})
test('storage read failure leaves cart untouched and does not crash subscription snapshot', async () => {
  snapshot(); const read = local.getItem
  local.getItem = () => { throw new Error('denied') }
  assert.doesNotThrow(() => cart.getCartSnapshot())
  assert.equal(await applyConfirmedPayment(order), false)
  await applyConfirmedPayment(order)
  local.getItem = read
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
  assert.equal(window.dataLayer.length, 1)
  await applyConfirmedPayment(order)
  assert.deepEqual(lines(), [])
})
test('analytics store failures use memory and session receipts independently of cleanup', async () => {
  snapshot(); const write = local.setItem
  local.setItem = (key, value) => { if (key.startsWith('vozdooh-purchase')) throw new Error('denied'); write(key, value) }
  await applyConfirmedPayment(order); await applyConfirmedPayment(order)
  assert.equal(session.getItem(`vozdooh-purchase-tracked:${order.id}`), '1')
  assert.equal(window.dataLayer.length, 1)
})
test('missing snapshot / mismatched purchased quantities preserve the cart', async () => {
  cart.addLine('A', 2); await applyConfirmedPayment(order)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
  cart.capturePaymentCart('attempt', lines()); cart.bindPaymentCart('attempt', order.id)
  assert.equal(cart.removePaidCartItems(order.id, [{ id: 'A', quantity: 1 }]), false)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
})
test('edits during submission and repeated binding retain the original eligible snapshot', async () => {
  cart.addLine('A', 2); cart.capturePaymentCart('attempt', lines())
  cart.setLineQuantity('A', 0); cart.addLine('A', 2)
  cart.bindPaymentCart('attempt', order.id)
  cart.capturePaymentCart('retry', lines()); cart.bindPaymentCart('retry', order.id)
  await applyConfirmedPayment(order)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
})
test('arbitrary cart replacement conservatively disables original cleanup', async () => {
  snapshot(); cart.writeCart({ lines: [{ sku: 'A', quantity: 2 }] })
  await applyConfirmedPayment(order)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
})

test('unknown submission followed by retry binds the first snapshot after cart edits', async () => {
  cart.addLine('A', 2); cart.capturePaymentCart('first', lines())
  cart.setLineQuantity('A', 0); cart.addLine('A', 2)
  cart.capturePaymentCart('second', lines()); cart.selectPaymentCartAttempt('second', 'first')
  cart.bindPaymentCart('first', order.id)
  await applyConfirmedPayment(order)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
})
test('legacy retry without original snapshot preserves current units', async () => {
  cart.addLine('A', 2); cart.capturePaymentCart('new', lines())
  cart.selectPaymentCartAttempt('new', 'legacy'); cart.bindPaymentCart('legacy', order.id)
  await applyConfirmedPayment(order)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
})

test('corrupt snapshot metadata preserves readable cart lines', () => {
  local.setItem('vozdooh-cart-v1', JSON.stringify({ lines: [{ sku: 'A', quantity: 2 }], paymentSnapshots: { bad: { lines: [null] } } }))
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
  assert.equal(cart.removePaidCartItems(order.id, order.items), true)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
})

const { reconcilePendingPaidCart } = require('../src/cart/paymentRecovery.ts')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

test('return to storefront reconciles a confirmed payment without visiting success URL', async () => {
  const requestId = 'b2b35909-4e02-4d35-abf3-c243b2640011'
  const paid = { ...order, id: requestId }
  cart.addLine('A', 2)
  cart.capturePaymentCart('provider-attempt', [{ sku: 'A', quantity: 2 }])
  cart.bindPaymentCart('provider-attempt', requestId)
  cart.addLine('A', 1)
  cart.addLine('B', 3)
  assert.deepEqual(cart.pendingPaymentRequestIds(), [requestId])
  let checked = 0
  const fetchStatus = async (url, options) => {
    checked++
    assert.equal(options.cache, 'no-store')
    assert.match(url, /\/api\/payments\/ozon\/status\?requestId=/)
    return { ok: true, json: async () => ({ state: 'paid', order: paid }) }
  }
  assert.equal(await reconcilePendingPaidCart(fetchStatus), 1)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 3 }])
  assert.deepEqual(cart.pendingPaymentRequestIds(), [])
  assert.equal(await reconcilePendingPaidCart(fetchStatus), 0)
  assert.equal(checked, 1)
})

test('return after cancelled, pending, failed or unverifiable payment cannot clear cart', async () => {
  const requestId = 'b2b35909-4e02-4d35-abf3-c243b2640012'
  const paid = { ...order, id: requestId }
  cart.addLine('A', 2)
  cart.capturePaymentCart('provider-attempt', [{ sku: 'A', quantity: 2 }])
  cart.bindPaymentCart('provider-attempt', requestId)
  for (const state of ['pending', 'no_payment', 'failed', 'canceled']) {
    assert.equal(await reconcilePendingPaidCart(async () => ({ ok: true, json: async () => ({ state, order: paid }) })), 0)
    assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
  }
  assert.equal(await reconcilePendingPaidCart(async () => ({ ok: false })), 0)
  assert.equal(await reconcilePendingPaidCart(async () => { throw new Error('offline') }), 0)
  assert.equal(await reconcilePendingPaidCart(async () => ({ ok: true, json: async () => ({ state: 'paid', order: { ...paid, totalMinor: 1 } }) })), 0)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
  assert.deepEqual(cart.pendingPaymentRequestIds(), [requestId])
})

test('old purchases without a bound payment receipt never silently remove current cart', async () => {
  cart.addLine('A', 2)
  assert.deepEqual(cart.pendingPaymentRequestIds(), [])
  let fetched = false
  assert.equal(await reconcilePendingPaidCart(async () => { fetched = true; return { ok: true } }), 0)
  assert.equal(fetched, false)
  assert.deepEqual(lines(), [{ sku: 'A', quantity: 2 }])
})

test('payment reconciliation is wired to shared header on every storefront page', () => {
  const link = readFileSync(resolve(__dirname, '../components/CartLink.tsx'), 'utf8')
  const sync = readFileSync(resolve(__dirname, '../components/CartPaymentSync.tsx'), 'utf8')
  assert.match(link, /<CartPaymentSync\s*\/>/)
  assert.match(sync, /window\.addEventListener\('focus'/)
  assert.match(sync, /document\.addEventListener\('visibilitychange'/)
  assert.match(sync, /setInterval\(resume, 30000\)/)
})
