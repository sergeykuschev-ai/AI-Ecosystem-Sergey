const { test } = require('node:test')
const assert = require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const { POST } = require('../app/api/ozon/delivery-quote/route.ts')
const prior = process.env.OZON_DELIVERY_ENABLED
process.env.OZON_DELIVERY_ENABLED = 'true'
process.on('exit', () => { if (prior === undefined) delete process.env.OZON_DELIVERY_ENABLED; else process.env.OZON_DELIVERY_ENABLED = prior })
const origin = 'https://vozdooh27.ru'
const request = (body, overrides = {}) => new Request(origin + '/api/ozon/delivery-quote', { method: 'POST', headers: { origin, host: 'vozdooh27.ru', 'content-type': 'application/json', ...overrides }, body: JSON.stringify(body) })
test('quote endpoint rejects cross-site callers without consulting Ozon', async () => {
  const response = await POST(request({ requestId: '49c5480d-bf19-4a3e-bc10-34443fe9983d' }, { origin: 'https://example.com' }))
  assert.equal(response.status, 403)
})
test('quote endpoint rejects malformed IDs and does not contact Ozon', async () => {
  const response = await POST(request({ requestId: '../order' }))
  assert.equal(response.status, 422)
  assert.equal((await response.json()).code, 'INVALID_REQUEST_ID')
})
test('quote endpoint does not disclose nonexistent orders', async () => {
  const response = await POST(request({ requestId: '49c5480d-bf19-4a3e-bc10-34443fe9983d' }))
  assert.equal(response.status, 404)
  assert.equal((await response.json()).code, 'REQUEST_NOT_FOUND')
})
