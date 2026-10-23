/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { createOzonPayment, createPaymentSign, verifyOzonNotification } = require('../src/commerce/ozonAcquiring.ts')

test('createPayment signature follows Ozon extId + accessKey + secretKey order', () => {
  const extId = '11111111-1111-4111-8111-111111111111'
  const accessKey = 'access-key'
  const secret = 'secret-key'
  const expected = createHash('sha256').update(`${extId}${accessKey}${secret}`).digest('hex')
  assert.equal(createPaymentSign(extId, accessKey, secret), expected)
})

test('notification signature accepts exact documented pipe-separated fingerprint', () => {
  const secret = 'notification-secret'
  const body = { accessKey: 'a', orderID: 'o', transactionID: 't', extOrderID: 'e', amount: '100', currencyCode: '643' }
  body.requestSign = createHash('sha256').update('a|o|t|e|100|643|notification-secret').digest('hex')
  assert.equal(verifyOzonNotification(body, secret), true)
  assert.equal(verifyOzonNotification({ ...body, amount: '101' }, secret), false)
})
test('createPayment sends RUB/SBP and returns the Ozon redirect without leaking secret', async () => {
  const old = { ...process.env }
  process.env.OZON_ACQUIRING_TOKEN_ID = 'access-key'
  process.env.OZON_ACQUIRING_SECRET_KEY = 'secret-key'
  process.env.OZON_ACQUIRING_NOTIFICATION_SECRET = 'notify-key'
  let captured
  const fetcher = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) }
    return new Response(JSON.stringify({ redirectUrl: 'https://pay.ozon.ru/example', paymentDetails: { paymentId: 'p1', status: 'PAYMENT_NEW' } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await createOzonPayment({ extId: '11111111-1111-4111-8111-111111111111', amountMinor: 12345, redirectUrl: 'https://vozdooh27.ru/checkout/success' }, fetcher)
    assert.equal(captured.url, 'https://payapi.ozon.ru/v1/createPayment')
    assert.deepEqual(captured.body.amount, { currencyCode: '643', value: '12345' })
    assert.equal(captured.body.payType, 'SBP')
    assert.equal(captured.body.secretKey, undefined)
    assert.deepEqual(result, { paymentId: 'p1', redirectUrl: 'https://pay.ozon.ru/example', status: 'PAYMENT_NEW' })
  } finally { process.env = old }
})

test('createPayment accepts the live Ozon SBP payload as payment redirect', async () => {
  const old = { ...process.env }
  process.env.OZON_ACQUIRING_TOKEN_ID = 'access-key'
  process.env.OZON_ACQUIRING_SECRET_KEY = 'secret-key'
  process.env.OZON_ACQUIRING_NOTIFICATION_SECRET = 'notify-key'
  const fetcher = async () => new Response(JSON.stringify({ order: {}, paymentDetails: { paymentId: 'p-sbp', type: 'SBP', status: 'PAYMENT_NEW', sbp: { payload: 'https://qr.nspk.ru/test' } } }), { status: 200 })
  try {
    const result = await createOzonPayment({ extId: '11111111-1111-4111-8111-111111111111', amountMinor: 70000, redirectUrl: 'https://vozdooh27.ru/checkout/success' }, fetcher)
    assert.deepEqual(result, { paymentId: 'p-sbp', redirectUrl: 'https://qr.nspk.ru/test', status: 'PAYMENT_NEW' })
  } finally { process.env = old }
})

test('createOzonOrder uses hosted order payLink and sends amount in kopecks', async () => {
  process.env.OZON_ACQUIRING_TOKEN_ID = 'token-id'
  process.env.OZON_ACQUIRING_SECRET_KEY = 'secret-key'
  let sent
  const { createOzonOrder } = await import('../src/commerce/ozonAcquiring.ts')
  const result = await createOzonOrder({ extId: 'order-700', amountMinor: 70000, items: [{ extId: 'sku-1', name: 'Test product', quantity: 1, unitPriceMinor: 70000 }], successUrl: 'https://vozdooh27.ru/checkout/success', failUrl: 'https://vozdooh27.ru/checkout/fail' }, async (_url, init) => {
    sent = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ order: { id: 'ozon-order-id', payLink: 'https://pay.ozon.ru/example', status: 'STATUS_NEW' } }), { status: 200 })
  })
  assert.equal(sent.amount.value, '70000')
  assert.equal(sent.amount.currencyCode, '643')
  assert.equal(sent.mode, 'MODE_FULL')
  assert.equal(sent.paymentAlgorithm, 'PAY_ALGO_SMS')
  assert.equal(result.redirectUrl, 'https://pay.ozon.ru/example')
})
