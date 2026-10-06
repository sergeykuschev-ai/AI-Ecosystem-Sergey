/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { acceptOrderRequest } = require('../src/commerce/orderRequests.ts')
const { localRequestStore } = require('../src/commerce/localRequestStore.ts')
const { beginOzonPayment } = require('../src/commerce/orderPayment.ts')

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vozdooh-payment-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = localRequestStore(path.join(dir, 'requests'))
  const retryKey = randomUUID()
  const receipt = await acceptOrderRequest({
    retryKey,
    lines: [{ sku: 'sku-1', quantity: 1, expectedPriceMinor: 70000 }],
    contact: { name: 'Synthetic Test', phone: '+7 000 000 00 00' },
    delivery: { method: 'pickup', address: '', comment: 'SYNTHETIC TEST ONLY' },
    consent: true,
  }, { store, readCatalog: async () => [{ sku: 'sku-1', name: 'Synthetic item', brand: null, category: 'test', volume: null, barcode: null, price: 700, stock: 1, characteristics: {} }] })
  return { store, retryKey, receipt }
}

test('first Ozon payment fails before provider call when inventory freshness fails', async (t) => {
  const { store, receipt } = await fixture(t)
  let providerCalls = 0
  let freshnessCalls = 0
  await assert.rejects(
    () => beginOzonPayment(receipt.id, store, async () => { providerCalls += 1; throw new Error('provider should not run') }, async () => {
      freshnessCalls += 1
      const error = new Error('INVENTORY_STALE')
      error.code = 'INVENTORY_STALE'
      throw error
    }),
    (error) => error.code === 'INVENTORY_STALE',
  )
  assert.equal(freshnessCalls, 1)
  assert.equal(providerCalls, 0)
})

test('existing hosted payment replay remains idempotent even if freshness later fails', async (t) => {
  const { store, retryKey, receipt } = await fixture(t)
  const record = await store.find(retryKey)
  record.payment = { provider: 'ozon', paymentId: 'payment-existing', extId: randomUUID(), redirectUrl: 'https://pay.ozon.ru/existing', createdAt: new Date().toISOString(), status: 'PAYMENT_NEW' }
  await store.replace(record)
  const result = await beginOzonPayment(receipt.id, store, async () => { throw new Error('provider should not run') }, async () => { throw new Error('freshness should not run') })
  assert.deepEqual(result, { paymentId: 'payment-existing', redirectUrl: 'https://pay.ozon.ru/existing' })
})
