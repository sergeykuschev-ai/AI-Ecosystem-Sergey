/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { acceptOrderRequest } = require('../src/commerce/orderRequests.ts')
const { localRequestStore } = require('../src/commerce/localRequestStore.ts')
const { queueOrderMail, processMailOutbox, renderOrderMail } = require('../src/commerce/orderMail.ts')
const { reconcileOzonPayment } = require('../src/commerce/paymentReconciliation.ts')

test('order mail outbox is idempotent and paid reconciliation queues one status email', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vozdooh-mail-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const previous = process.env.MAIL_OUTBOX_PATH
  process.env.MAIL_OUTBOX_PATH = path.join(root, 'outbox')
  t.after(() => {
    if (previous === undefined) delete process.env.MAIL_OUTBOX_PATH
    else process.env.MAIL_OUTBOX_PATH = previous
  })

  const store = localRequestStore(path.join(root, 'orders'))
  const sku = 'mail-fixture'
  const receipt = await acceptOrderRequest({
    retryKey: randomUUID(),
    lines: [{ sku, quantity: 1, expectedPriceMinor: 70000 }],
    contact: { name: 'Mail Test', phone: '+70000000000', email: 'buyer@example.test' },
    delivery: { method: 'ozon-pvz', address: 'Synthetic Ozon point', comment: '', deliveryPointId: 6201, shipmentMethodId: 1020005031646010 },
    consent: true,
  }, {
    readCatalog: async () => [{ sku, name: 'Synthetic product', price: 700, stock: 2 }],
    store,
  })
  const order = await store.findById(receipt.id)
  assert.ok(order)
  assert.equal(await queueOrderMail(order, 'request_received'), true)
  assert.equal(await queueOrderMail(order, 'request_received'), false)

  const sent = []
  const first = await processMailOutbox(store, { sender: async (value, event) => sent.push([value.id, event]) })
  assert.deepEqual(first, { sent: 1, failed: 0, skipped: 0 })
  assert.deepEqual(sent, [[order.id, 'request_received']])
  assert.deepEqual(await processMailOutbox(store, { sender: async () => { throw new Error('should not resend') } }), { sent: 0, failed: 0, skipped: 0 })

  const rendered = renderOrderMail(order, 'request_received')
  assert.equal(rendered.to, 'buyer@example.test')
  assert.match(rendered.subject, /Заказ создан/)
  assert.match(rendered.text, /700/)
  assert.match(rendered.text, /Synthetic Ozon point/)

  await store.replace({
    ...order,
    payment: {
      provider: 'ozon',
      paymentId: randomUUID(),
      extId: randomUUID(),
      redirectUrl: 'https://checkout.ozon.ru/order/test',
      createdAt: new Date().toISOString(),
      status: 'PAYMENT_NEW',
    },
  })
  const reconciled = await reconcileOzonPayment(order.id, store, async () => ({ status: 'STATUS_PAID' }))
  assert.deepEqual(reconciled, { state: 'paid', changed: true })
  assert.equal((await store.findById(order.id)).payment.status, 'PAID')

  const paidEvents = []
  const second = await processMailOutbox(store, { sender: async (_value, event) => paidEvents.push(event) })
  assert.deepEqual(second, { sent: 1, failed: 0, skipped: 0 })
  assert.deepEqual(paidEvents, ['payment_confirmed'])
})
