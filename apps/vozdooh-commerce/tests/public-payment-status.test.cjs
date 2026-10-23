/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const { publicPaymentStatus } = require('../src/commerce/publicPaymentStatus.ts')

function order(status) {
  return {
    id: '12345678-1234-4123-8123-123456789abc', totalMinor: 70000, currency: 'RUB',
    payment: status ? { provider: 'ozon', status } : undefined,
    input: { contact: { name: 'Private Name', phone: '+70000000000', email: 'private@example.com' }, delivery: { method: 'ozon-pvz', address: 'Private address', comment: '' } },
    lines: [{ sku: 'SKU-1', name: 'Diffuser', unitPriceMinor: 70000, quantity: 1 }],
  }
}

test('public paid state contains only transaction and product facts', () => {
  const result = publicPaymentStatus(order('PAID'))
  assert.equal(result.state, 'paid')
  assert.deepEqual(result.order, { id: '12345678-1234-4123-8123-123456789abc', totalMinor: 70000, currency: 'RUB', items: [{ id: 'SKU-1', name: 'Diffuser', priceMinor: 70000, quantity: 1 }] })
  assert.ok(!JSON.stringify(result).match(/Private|email|phone|address|delivery/i))
})

test('public state does not expose order facts before payment', () => {
  assert.deepEqual(publicPaymentStatus(order('PAYMENT_NEW')), { state: 'pending' })
  assert.deepEqual(publicPaymentStatus(order()), { state: 'no_payment' })
})
