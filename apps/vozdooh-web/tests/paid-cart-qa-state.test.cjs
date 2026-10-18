const test = require('node:test')
const assert = require('node:assert/strict')
const { createPaymentStatusMock, countPurchases } = require('./paid-cart-qa-state.cjs')
const vm = require('node:vm')

test('purchase totals include either tab and expose duplicates across tabs', async () => {
  const tab = (dataLayer) => ({ evaluate: async (read) => vm.runInNewContext(`(${read.toString()})()`, { window: { dataLayer } }) })
  const purchase = { ecommerce: { purchase: { actionField: { id: 'synthetic' } } } }
  const empty = tab([{ event: 'page_view' }])
  const tracked = tab([purchase])
  assert.equal(await countPurchases([empty, empty]), 0)
  assert.equal(await countPurchases([tracked, empty]), 1)
  assert.equal(await countPurchases([empty, tracked]), 1)
  assert.equal(await countPurchases([tracked, tracked]), 2)
})

for (const scenario of ['paid', 'edited', 'pending', 'canceled', 'failed', 'storage-failure', 'already-tracked', 'delayed']) {
  test(`synthetic ${scenario}: background polling cannot confirm payment`, () => {
    const payment = createPaymentStatusMock(scenario)
    for (let check = 0; check < 50; check++) assert.equal(payment.status(), 'pending')
    assert.equal(payment.checks, 0)
    payment.start()
    const pendingChecks = scenario === 'delayed' ? 26 : 1
    if (['pending', 'canceled', 'failed'].includes(scenario)) {
      for (let check = 0; check < 30; check++) assert.equal(payment.status(), scenario)
    } else {
      for (let check = 0; check < pendingChecks; check++) assert.equal(payment.status(), 'pending')
      assert.equal(payment.status(), 'paid')
      assert.equal(payment.checks, pendingChecks + 1)
    }
  })
}
