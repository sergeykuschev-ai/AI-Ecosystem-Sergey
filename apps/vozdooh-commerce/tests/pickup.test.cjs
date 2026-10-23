/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { parseRequest, PICKUP_ADDRESS } = require('../src/commerce/requestValidation.ts')
const { acceptOrderRequest } = require('../src/commerce/orderRequests.ts')
const { localRequestStore } = require('../src/commerce/localRequestStore.ts')
const { renderOrderMail, processMailOutbox } = require('../src/commerce/orderMail.ts')
const { beginOzonPayment } = require('../src/commerce/orderPayment.ts')
const { reconcileOzonPayment } = require('../src/commerce/paymentReconciliation.ts')
const { quoteOzonPickupDelivery, createOzonPickupDelivery } = require('../src/commerce/ozonDeliveryBusiness.ts')
const input = () => ({ retryKey: randomUUID(), lines: [{ sku: 'synthetic-pickup', quantity: 1, expectedPriceMinor: 70000 }], contact: { name: 'Synthetic Pickup', phone: '+70000000000', email: 'pickup@example.test' }, delivery: { method: 'pickup', address: PICKUP_ADDRESS, comment: '' }, consent: true })

test('pickup preserves the fixed address, drops Ozon fields and keeps legacy empty receipts readable', () => {
  const value = input()
  const parsed = parseRequest({ ...value, delivery: { ...value.delivery, deliveryPointId: 12, shipmentMethodId: 13 } })
  assert.deepEqual(parsed.delivery, { method: 'pickup', address: PICKUP_ADDRESS, comment: '' })
  assert.equal(parseRequest({ ...value, delivery: { ...value.delivery, address: '' } }).delivery.address, '')
  assert.throws(() => parseRequest({ ...value, delivery: { ...value.delivery, address: 'Other store' } }), /INVALID_DELIVERY/)
  for (const method of ['courier', 'ozon-pvz']) {
    assert.throws(() => parseRequest({ ...value, delivery: { method, address: '', comment: '' } }))
    const delivery = { method, address: 'Synthetic destination', comment: '', ...(method === 'ozon-pvz' ? { deliveryPointId: 12, shipmentMethodId: 13 } : {}) }
    assert.deepEqual(parseRequest({ ...value, delivery }).delivery, delivery)
  }
})

test('pickup order, Ozon Pay and paid email use fakes; payment never queues readiness or delivery', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vozdooh-pickup-regression-'))
  const previous = process.env.MAIL_OUTBOX_PATH
  process.env.MAIL_OUTBOX_PATH = path.join(root, 'mail')
  t.after(async () => { if (previous === undefined) delete process.env.MAIL_OUTBOX_PATH; else process.env.MAIL_OUTBOX_PATH = previous; await fs.rm(root, { recursive: true, force: true }) })
  const store = localRequestStore(path.join(root, 'orders'))
  const dependencies = { store, readCatalog: async () => [{ sku: 'synthetic-pickup', name: 'Synthetic Item', stock: 3, price: 700 }] }
  for (const address of ['', PICKUP_ADDRESS]) {
    const value = input(); value.delivery.address = address
    const receipt = await acceptOrderRequest(value, dependencies)
    assert.deepEqual(await acceptOrderRequest(value, dependencies), receipt)
    assert.equal((await store.findById(receipt.id)).input.delivery.address, address)
  }
  const receipt = await acceptOrderRequest(input(), dependencies)
  let paymentCalls = 0
  await beginOzonPayment(receipt.id, store, async (value) => {
    paymentCalls += 1
    assert.equal(value.amountMinor, 70000)
    return { paymentId: 'fake-payment', redirectUrl: 'https://pay.example.test/fake' }
  }, async () => {})
  assert.equal(paymentCalls, 1)
  await reconcileOzonPayment(receipt.id, store, async () => ({ status: 'STATUS_PAID' }))
  const order = await store.findById(receipt.id)
  assert.equal(order.totalMinor, 70000)
  assert.equal(order.deliveryOrder, undefined)
  const sent = []
  await processMailOutbox(store, { sender: async (_order, event) => sent.push(event) })
  assert.deepEqual(sent, ['payment_confirmed'])
  const client = { checkoutOrder: async () => { throw new Error('REAL API MUST NOT RUN') }, createOrder: async () => { throw new Error('REAL API MUST NOT RUN') } }
  const parcel = { weightG: 100, lengthMm: 100, widthMm: 100, heightMm: 100 }
  await assert.rejects(quoteOzonPickupDelivery(order, parcel, client), /OZON_DELIVERY_METHOD_UNSUPPORTED/)
  await assert.rejects(createOzonPickupDelivery(order.id, store, parcel, client), /OZON_DELIVERY_METHOD_UNSUPPORTED/)
  assert.equal((await store.findById(order.id)).deliveryOrder, undefined)
  for (const event of ['request_received', 'payment_confirmed', 'delivery_ready']) {
    const rendered = renderOrderMail(order, event)
    assert.ok(rendered.text.includes(PICKUP_ADDRESS))
    assert.ok(rendered.html.includes(PICKUP_ADDRESS))
    assert.match(rendered.text, /бесплатно \(0 руб\.\)/)
    assert.doesNotMatch(rendered.text, /передаче в доставку|выбранном пункте/)
    if (event === 'payment_confirmed') assert.doesNotMatch(rendered.subject, /готов/)
    if (event === 'delivery_ready') assert.match(rendered.subject, /готов к самовывозу/)
  }
  const ozonOrder = { ...order, input: { ...order.input, delivery: { method: 'ozon-pvz', address: 'Synthetic Ozon point' } } }
  assert.match(renderOrderMail(ozonOrder, 'payment_confirmed').text, /передаче в доставку/)
  assert.match(renderOrderMail(ozonOrder, 'delivery_ready').subject, /пункт выдачи/)
})
