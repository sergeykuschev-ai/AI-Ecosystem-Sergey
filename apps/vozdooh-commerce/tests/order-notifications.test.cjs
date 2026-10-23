/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { acceptOrderRequest } = require('../src/commerce/orderRequests.ts')
const { localRequestStore } = require('../src/commerce/localRequestStore.ts')
const { queueOrderNotification, processOrderNotificationOutbox } = require('../src/commerce/orderNotifications.ts')

test('Arthur order notification outbox is idempotent and only marks a sent event after delivery', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vozdooh-notification-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const previous = process.env.ARTHUR_NOTIFICATION_OUTBOX_PATH
  process.env.ARTHUR_NOTIFICATION_OUTBOX_PATH = path.join(root, 'outbox')
  t.after(() => {
    if (previous === undefined) delete process.env.ARTHUR_NOTIFICATION_OUTBOX_PATH
    else process.env.ARTHUR_NOTIFICATION_OUTBOX_PATH = previous
  })
  const store = localRequestStore(path.join(root, 'orders'))
  const receipt = await acceptOrderRequest({
    retryKey: randomUUID(),
    lines: [{ sku: 'notice-fixture', quantity: 1, expectedPriceMinor: 70000 }],
    contact: { name: 'Notice Test', phone: '+70000000000', email: 'buyer@example.test' },
    delivery: { method: 'ozon-pvz', address: 'Synthetic Ozon point', comment: '', deliveryPointId: 6201, shipmentMethodId: 1020005031646010 },
    consent: true,
  }, { readCatalog: async () => [{ sku: 'notice-fixture', name: 'Synthetic product', price: 700, stock: 2 }], store })
  const order = await store.findById(receipt.id)
  assert.ok(order)
  assert.equal(await queueOrderNotification(order, 'payment_confirmed'), true)
  assert.equal(await queueOrderNotification(order, 'payment_confirmed'), false)

  const sent = []
  const first = await processOrderNotificationOutbox(store, { sender: async (value) => sent.push(value) })
  assert.deepEqual(first, { sent: 1, failed: 0, skipped: 0 })
  assert.equal(sent[0].event, 'payment_confirmed')
  assert.equal(sent[0].order.id, order.id)
  assert.equal(sent[0].order.input.contact.phone, '+70000000000')
  assert.deepEqual(await processOrderNotificationOutbox(store, { sender: async () => assert.fail('must not resend') }), { sent: 0, failed: 0, skipped: 0 })
})
