/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
require('../scripts/register-typescript.cjs')
const { acceptOrderRequest } = require('../src/commerce/orderRequests.ts')
const { localRequestStore } = require('../src/commerce/localRequestStore.ts')
const {
  buildOzonPickupCheckoutRequest,
  buildOzonPickupCreateRequest,
  createOzonPickupDelivery,
  quoteOzonPickupDelivery,
  OzonDeliveryQuoteError,
} = require('../src/commerce/ozonDeliveryBusiness.ts')

function order(overrides = {}) {
  return {
    version: 1,
    id: '49c5480d-bf19-4a3e-bc10-34443fe9983d',
    createdAt: '2026-10-01T22:43:22.731Z',
    fingerprint: 'synthetic',
    input: {
      retryKey: '83837bde-7b6e-4e49-a1cc-5db5b14f3ab2',
      lines: [{ sku: 'N020408', quantity: 1, expectedPriceMinor: 70000 }],
      contact: { name: 'Test Buyer', phone: '+7 (900) 555-01-00', email: 'buyer@example.test' },
      delivery: {
        method: 'ozon-pvz',
        address: 'Synthetic Ozon point',
        comment: '',
        deliveryPointId: 71500,
        shipmentMethodId: 1020005031646010,
      },
      consent: true,
    },
    catalogSource: 'staged-1c',
    lines: [{ sku: 'N020408', name: 'Synthetic item', quantity: 1, unitPriceMinor: 70000, totalMinor: 70000, stockAtRequest: 1 }],
    totalMinor: 70000,
    currency: 'RUB',
    status: 'request_received',
    consentVersion: 'request-contact-v1',
    ...overrides,
  }
}

const parcel = { weightG: 13, lengthMm: 140, widthMm: 70, heightMm: 10 }

test('Business checkout payload uses exact Ozon units, selected PVZ/method and declared RUB value', () => {
  const first = buildOzonPickupCheckoutRequest(order(), parcel)
  const second = buildOzonPickupCheckoutRequest(order(), parcel)
  assert.equal(first.requestId, second.requestId)
  assert.ok(Number.isSafeInteger(first.requestId) && first.requestId > 0)
  assert.deepEqual(first.body, {
    recipient: { phone_number: '+79005550100' },
    postings: [{
      request_id: first.requestId,
      shipment_method_id: 1020005031646010,
      declared_value: { amount: '700.00', currency_code: 'RUB' },
      dimensions: { weight_g: 13, length_mm: 140, width_mm: 70, height_mm: 10 },
    }],
    delivery: { delivery_point: { delivery_point_id: 71500 } },
  })
})

test('Business checkout fails closed on unsupported delivery or missing/invalid parcel facts', () => {
  assert.throws(
    () => buildOzonPickupCheckoutRequest(order({ input: { ...order().input, delivery: { method: 'courier', address: 'x', comment: '' } } }), parcel),
    (error) => error instanceof OzonDeliveryQuoteError && error.code === 'OZON_DELIVERY_METHOD_UNSUPPORTED',
  )
  const missingPoint = order()
  missingPoint.input.delivery = { method: 'ozon-pvz', address: 'x', comment: '', shipmentMethodId: 1 }
  assert.throws(() => buildOzonPickupCheckoutRequest(missingPoint, parcel), /OZON_DELIVERY_POINT_MISSING/)
  assert.throws(() => buildOzonPickupCheckoutRequest(order(), { ...parcel, weightG: 0 }), /OZON_DELIVERY_WEIGHTG_INVALID/)
  assert.throws(() => buildOzonPickupCheckoutRequest(order(), { ...parcel, heightMm: 1.5 }), /OZON_DELIVERY_HEIGHTMM_INVALID/)
})

test('Business checkout quote parses delivery plus insurance without mutating an order', async () => {
  let request
  const fake = {
    async checkoutOrder(body) {
      request = body
      return {
        results: [{
          request_id: body.postings[0].request_id,
          posting: {
            estimated_delivery_cost: { amount: '289.40', currency_code: 'RUB' },
            estimated_insurance_cost: { amount: '7.00', currency_code: 'RUB' },
            estimated_delivery_days: 4,
            cutoff_at: '2026-10-02T12:00:00Z',
          },
        }],
      }
    },
  }
  const result = await quoteOzonPickupDelivery(order(), parcel, fake)
  assert.equal(request.delivery.delivery_point.delivery_point_id, 71500)
  assert.deepEqual(result, {
    requestId: request.postings[0].request_id,
    estimatedDeliveryCostRub: 289.4,
    estimatedInsuranceCostRub: 7,
    totalDeliveryCostRub: 296.4,
    estimatedDeliveryDays: 4,
    cutoffAt: '2026-10-02T12:00:00Z',
  })
})

test('Business checkout quote rejects missing or provider-error rows', async () => {
  await assert.rejects(
    () => quoteOzonPickupDelivery(order(), parcel, { checkoutOrder: async () => ({ results: [] }) }),
    /OZON_DELIVERY_QUOTE_MISSING/,
  )
  await assert.rejects(
    () => quoteOzonPickupDelivery(order(), parcel, { checkoutOrder: async (body) => ({ results: [{ request_id: body.postings[0].request_id, error: { code: 'bad' } }] }) }),
    /OZON_DELIVERY_QUOTE_REJECTED/,
  )
})


test('Business create payload carries quoted cutoff, recipient, selected PVZ and stable external ids', () => {
  const value = buildOzonPickupCreateRequest(order(), parcel, '2026-10-02T12:00:00Z')
  assert.equal(value.body.order_external_id, order().id)
  assert.deepEqual(value.body.recipient, { phone_number: '+79005550100', full_name: 'Test Buyer' })
  assert.deepEqual(value.body.delivery, { delivery_point: { delivery_point_id: 71500 } })
  assert.equal(value.body.postings[0].request_id, value.requestId)
  assert.equal(value.body.postings[0].shipment_method_id, 1020005031646010)
  assert.equal(value.body.postings[0].cutoff_at, '2026-10-02T12:00:00Z')
  assert.equal(value.body.postings[0].posting_external_id, order().id)
  assert.deepEqual(value.body.postings[0].dimensions, { weight_g: 13, length_mm: 140, width_mm: 70, height_mm: 10 })
})

test('delivery creation persists pending idempotency before mutation, records posting once and queues one email', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vozdooh-delivery-create-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const previousOutbox = process.env.MAIL_OUTBOX_PATH
  process.env.MAIL_OUTBOX_PATH = path.join(root, 'outbox')
  t.after(() => {
    if (previousOutbox === undefined) delete process.env.MAIL_OUTBOX_PATH
    else process.env.MAIL_OUTBOX_PATH = previousOutbox
  })

  const store = localRequestStore(path.join(root, 'orders'))
  const sku = 'delivery-fixture'
  const receipt = await acceptOrderRequest({
    retryKey: randomUUID(),
    lines: [{ sku, quantity: 1, expectedPriceMinor: 70000 }],
    contact: { name: 'Delivery Test', phone: '+79005550100', email: 'buyer@example.test' },
    delivery: { method: 'ozon-pvz', address: 'Synthetic Ozon point', comment: '', deliveryPointId: 71500, shipmentMethodId: 1020005031646010 },
    consent: true,
  }, {
    readCatalog: async () => [{ sku, name: 'Synthetic product', price: 700, stock: 1 }],
    store,
  })
  const initial = await store.findById(receipt.id)
  await store.replace({
    ...initial,
    payment: {
      provider: 'ozon',
      paymentId: randomUUID(),
      extId: randomUUID(),
      redirectUrl: 'https://checkout.ozon.ru/order/test',
      createdAt: new Date().toISOString(),
      status: 'PAID',
      paidAt: new Date().toISOString(),
    },
  })

  let checkoutCalls = 0
  let createCalls = 0
  let idempotencyKey
  const client = {
    async checkoutOrder(body) {
      checkoutCalls += 1
      return {
        results: [{
          request_id: body.postings[0].request_id,
          posting: {
            estimated_delivery_cost: { amount: '92.00' },
            estimated_insurance_cost: { amount: '10.00' },
            estimated_delivery_days: 3,
            cutoff_at: '2026-10-02T12:00:00Z',
          },
        }],
      }
    },
    async createOrder(body, key) {
      createCalls += 1
      idempotencyKey = key
      const persisted = await store.findById(receipt.id)
      assert.equal(persisted.deliveryOrder.status, 'pending')
      assert.equal(persisted.deliveryOrder.idempotencyKey, key)
      return {
        order_number: 'OZON-ORDER-1',
        postings: [{ request_id: body.postings[0].request_id, posting_number: 'POSTING-1' }],
      }
    },
  }

  const first = await createOzonPickupDelivery(receipt.id, store, parcel, client)
  assert.equal(first.changed, true)
  assert.equal(first.orderNumber, 'OZON-ORDER-1')
  assert.equal(first.postingNumber, 'POSTING-1')
  assert.match(idempotencyKey, /^[0-9a-f-]{36}$/i)
  assert.equal(checkoutCalls, 1)
  assert.equal(createCalls, 1)

  const stored = await store.findById(receipt.id)
  assert.equal(stored.deliveryOrder.status, 'created')
  assert.equal(stored.deliveryOrder.orderNumber, 'OZON-ORDER-1')
  assert.equal(stored.deliveryOrder.postingNumber, 'POSTING-1')
  assert.ok(Number.isFinite(Date.parse(stored.deliveryOrder.createdAt)))
  assert.equal((await fs.readdir(process.env.MAIL_OUTBOX_PATH)).filter((name) => name.includes('delivery_created')).length, 1)

  const second = await createOzonPickupDelivery(receipt.id, store, parcel, {
    checkoutOrder: async () => { throw new Error('must not quote twice') },
    createOrder: async () => { throw new Error('must not create twice') },
  })
  assert.deepEqual(second, { changed: false, orderNumber: 'OZON-ORDER-1', postingNumber: 'POSTING-1' })
  assert.equal(checkoutCalls, 1)
  assert.equal(createCalls, 1)
})

test('delivery creation refuses unpaid orders before any provider mutation', async () => {
  const value = order()
  value.payment = { provider: 'ozon', paymentId: 'p', extId: 'e', redirectUrl: 'https://example.test', createdAt: new Date().toISOString(), status: 'PAYMENT_NEW' }
  const store = { findById: async () => value }
  let called = false
  await assert.rejects(
    () => createOzonPickupDelivery(value.id, store, parcel, {
      checkoutOrder: async () => { called = true },
      createOrder: async () => { called = true },
    }),
    /ORDER_NOT_PAID/,
  )
  assert.equal(called, false)
})
