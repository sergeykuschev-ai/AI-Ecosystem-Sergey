/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const { trackEvent, trackPurchase, trackPathname, flushPendingEvents } = require('../src/integrations/analytics.ts')
const { verifiedPaidOrder, applyConfirmedPaymentResult } = require('../src/cart/confirmedPayment.ts')
let calls
let originalWindow
let originalFlag
beforeEach(() => {
  originalWindow = global.window
  originalFlag = process.env.NEXT_PUBLIC_METRICA_GOALS_ENABLED
  delete process.env.NEXT_PUBLIC_METRICA_GOALS_ENABLED
  calls = []
  global.window = { __vozdoohAnalyticsId: 42, ym: (...args) => calls.push(args) }
})
afterEach(() => {
  if (originalWindow === undefined) delete global.window
  else global.window = originalWindow
  if (originalFlag === undefined) delete process.env.NEXT_PUBLIC_METRICA_GOALS_ENABLED
  else process.env.NEXT_PUBLIC_METRICA_GOALS_ENABLED = originalFlag
})
const purchase = () => trackPurchase({ id: 'synthetic-id', revenue: 100, items: [{ id: 'A', name: 'Synthetic', price: 100, quantity: 1 }] })
const goals = () => calls.filter((call) => call[1] === 'reachGoal')

test('goals default off and require exact true; ecommerce remains unchanged', () => {
  for (const flag of [undefined, 'false', 'TRUE', '1']) {
    if (flag === undefined) delete process.env.NEXT_PUBLIC_METRICA_GOALS_ENABLED
    else process.env.NEXT_PUBLIC_METRICA_GOALS_ENABLED = flag
    for (const event of ['add_to_cart', 'begin_checkout', 'submit_order']) trackEvent(event)
    purchase()
  }
  assert.deepEqual(goals(), [])
  assert.equal(window.dataLayer.length, 4)
})

test('only allowed goals; arbitrary personal fields never enter goal arguments', () => {
  process.env.NEXT_PUBLIC_METRICA_GOALS_ENABLED = 'true'
  const dirty = { request_id: 'secret', transaction_id: 'secret', email: 'secret', phone: 'secret', name: 'secret', address: 'secret', contact: 'secret', customer: { secret: true }, url: '/?secret', value: 999, paidRevenue: 999 }
  for (const event of ['add_to_cart', 'begin_checkout', 'submit_order', 'purchase', 'view_item', 'view_collection', 'remove_from_cart']) trackEvent(event, dirty)
  purchase()
  assert.deepEqual(goals(), [
    [42, 'reachGoal', 'vz_add_to_cart'], [42, 'reachGoal', 'vz_begin_checkout'],
    [42, 'reachGoal', 'vz_submit_order'], [42, 'reachGoal', 'vz_paid_purchase', { order_price: 100, currency: 'RUB' }],
  ])
  assert.ok(!JSON.stringify(goals()).includes('secret'))
})

test('queued goals flush once after init with safe purchase metadata', () => {
  process.env.NEXT_PUBLIC_METRICA_GOALS_ENABLED = 'true'
  delete window.__vozdoohAnalyticsId
  trackEvent('add_to_cart', { email: 'secret' })
  purchase()
  flushPendingEvents()
  assert.deepEqual(calls, [])
  window.__vozdoohAnalyticsId = 42
  flushPendingEvents()
  flushPendingEvents()
  assert.deepEqual(goals(), [[42, 'reachGoal', 'vz_add_to_cart'], [42, 'reachGoal', 'vz_paid_purchase', { order_price: 100, currency: 'RUB' }]])
  assert.equal(window.dataLayer.length, 1)
})

test('paid goal follows existing verified result and duplicate guard only', async () => {
  process.env.NEXT_PUBLIC_METRICA_GOALS_ENABLED = 'true'
  const order = { id: 'synthetic-paid-funnel', totalMinor: 10000, currency: 'RUB', items: [{ id: 'A', name: 'Synthetic', priceMinor: 10000, quantity: 1 }] }
  for (const state of ['pending', 'failed', 'canceled', 'request_received']) {
    assert.equal(verifiedPaidOrder({ state, order }, order.id), null)
  }
  trackEvent('submit_order')
  assert.equal(goals().some((call) => call[2] === 'vz_paid_purchase'), false)
  const paid = verifiedPaidOrder({ state: 'paid', order }, order.id)
  await applyConfirmedPaymentResult(paid)
  await applyConfirmedPaymentResult(paid)
  assert.equal(goals().filter((call) => call[2] === 'vz_paid_purchase').length, 1)
})

test('invalid purchase revenue cannot create a paid goal', () => {
  process.env.NEXT_PUBLIC_METRICA_GOALS_ENABLED = 'true'
  for (const revenue of [0, -1, NaN, Infinity]) trackPurchase({ id: 'synthetic', revenue, items: [{ id: 'A', name: 'Synthetic', price: 1, quantity: 1 }] })
  assert.deepEqual(goals(), [])
})

test('SPA skips first pathname and StrictMode repeats, allows return navigation', () => {
  trackPathname('/')
  trackPathname('/')
  trackPathname('/collections/vozdooh-selection')
  trackPathname('/collections/vozdooh-selection')
  trackPathname('/?email=secret')
  trackPathname('/#secret')
  trackPathname(null)
  trackPathname('/')
  assert.deepEqual(calls, [[42, 'hit', '/collections/vozdooh-selection'], [42, 'hit', '/']])
})

test('disabled counter sends and queues no SPA hits; initialization seeds first route', () => {
  delete window.__vozdoohAnalyticsId
  trackPathname('/')
  trackPathname('/collections/vozdooh-selection')
  assert.deepEqual(calls, [])
  assert.equal(window.__vozdoohAnalyticsPathname, undefined)
  window.__vozdoohAnalyticsId = 42
  window.__vozdoohAnalyticsPathname = '/'
  trackPathname('/')
  trackPathname('/collections/vozdooh-selection')
  assert.deepEqual(calls, [[42, 'hit', '/collections/vozdooh-selection']])
})
