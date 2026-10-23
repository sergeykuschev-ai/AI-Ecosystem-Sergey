/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
require('../scripts/register-typescript.cjs')
const { ozonDeliveryEnabled, loadOzonAuthFromEnv, loadOzonClientConfig, OzonConfigError } = require('../src/integrations/ozon/config.ts')
const { createOzonClient, OzonApiError, OzonMutationDisabledError } = require('../src/integrations/ozon/client.ts')
const pickupPointsRoute = require('../app/api/ozon/pickup-points/route.ts')

const ORIGINAL_ENV = { ...process.env }
const SECRET_FIXTURES = []
function secretFixture(value) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ozon-secret-')), 'secret')
  fs.writeFileSync(file, value, { mode: 0o600 })
  SECRET_FIXTURES.push(file)
  return file
}
afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  for (const file of SECRET_FIXTURES.splice(0)) {
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  }
})

test('feature flag is disabled by default and only literal true enables it', () => {
  delete process.env.OZON_DELIVERY_ENABLED
  assert.equal(ozonDeliveryEnabled(), false)
  process.env.OZON_DELIVERY_ENABLED = 'true'
  assert.equal(ozonDeliveryEnabled(), true)
  process.env.OZON_DELIVERY_ENABLED = 'TRUE'
  assert.equal(ozonDeliveryEnabled(), false)
  process.env.OZON_DELIVERY_ENABLED = '1'
  assert.equal(ozonDeliveryEnabled(), false)
})

test('auth loads from mounted secret files without exposing values in errors', () => {
  const clientIdFile = secretFixture('2861077\n')
  const apiKeyFile = secretFixture('test-api-key-value\n')
  const auth = loadOzonAuthFromEnv({ OZON_CLIENT_ID_FILE: clientIdFile, OZON_API_KEY_FILE: apiKeyFile })
  assert.equal(auth.type, 'api-key')
  assert.equal(auth.clientId, '2861077')
  assert.equal(auth.apiKey, 'test-api-key-value')
  assert.throws(() => loadOzonAuthFromEnv({ OZON_CLIENT_ID_FILE: '/nonexistent', OZON_API_KEY_FILE: apiKeyFile }), (error) => error instanceof OzonConfigError && error.code === 'OZON_CLIENT_ID_UNAVAILABLE')
  assert.throws(() => loadOzonAuthFromEnv({ OZON_CLIENT_ID_FILE: clientIdFile, OZON_API_KEY_FILE: '/nonexistent' }), (error) => error instanceof OzonConfigError && error.code === 'OZON_API_KEY_UNAVAILABLE')
  const empty = secretFixture('   \n')
  assert.throws(() => loadOzonAuthFromEnv({ OZON_CLIENT_ID_FILE: empty, OZON_API_KEY_FILE: apiKeyFile }), /OZON_CLIENT_ID_UNAVAILABLE/)
  const tokenFile = secretFixture('oauth-token\n')
  const oauth = loadOzonAuthFromEnv({ OZON_OAUTH_TOKEN_FILE: tokenFile })
  assert.deepEqual(oauth, { type: 'oauth', token: 'oauth-token' })
})

test('env-loaded config never enables mutating methods', () => {
  const clientIdFile = secretFixture('2861077')
  const apiKeyFile = secretFixture('test-key')
  const config = loadOzonClientConfig({ OZON_CLIENT_ID_FILE: clientIdFile, OZON_API_KEY_FILE: apiKeyFile })
  assert.equal(config.allowMutations, false)
  assert.equal(config.baseUrl, 'https://api-seller.ozon.ru')
})

function fakeFetch(handler) {
  const calls = []
  const impl = async (url, options) => { calls.push({ url, options }); return handler(url, options, calls.length) }
  return { impl, calls }
}

const baseConfig = { baseUrl: 'https://api-seller.ozon.ru', timeoutMs: 1000, maxAttempts: 3, retryBaseMs: 1, allowMutations: false }

test('client posts JSON with Api-Key auth headers and returns parsed JSON', async () => {
  const { impl, calls } = fakeFetch(async () => Response.json({ points: [{ map_point_id: 1 }] }))
  const client = createOzonClient({ ...baseConfig, auth: { type: 'api-key', clientId: '2861077', apiKey: 'secret-key' } }, { fetchImpl: impl })
  const result = await client.getPickupPoints()
  assert.deepEqual(result, { points: [{ map_point_id: 1 }] })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api-seller.ozon.ru/v1/delivery-point/list')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers['Client-Id'], '2861077')
  assert.equal(calls[0].options.headers['Api-Key'], 'secret-key')
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
  assert.equal(calls[0].options.body, JSON.stringify({ pagination: { cursor: null, limit: 100 } }))
})

test('client sends Bearer auth only for OAuth config', async () => {
  const { impl, calls } = fakeFetch(async () => Response.json({ ok: true }))
  const client = createOzonClient({ ...baseConfig, auth: { type: 'oauth', token: 'oauth-secret' } }, { fetchImpl: impl })
  await client.checkDelivery('79005550100')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer oauth-secret')
  assert.equal(calls[0].options.headers['Api-Key'], undefined)
  assert.equal(calls[0].options.body, JSON.stringify({ client_phone: '79005550100' }))
})

test('Business Delivery read methods use exact checkout and posting endpoints without mutation opt-in', async () => {
  const { impl, calls } = fakeFetch(async () => Response.json({ ok: true }))
  const client = createOzonClient({ ...baseConfig, baseUrl: 'https://api-delivery.ozon.ru', auth: { type: 'oauth', token: 'oauth-secret' } }, { fetchImpl: impl })
  const checkout = { recipient: { phone_number: '+79005550100' }, postings: [], delivery: {} }
  await client.checkoutOrder(checkout)
  await client.getPostingInfo({ posting_number: 'test-1' })
  await client.getPostingStatusHistory({ posting_number: 'test-1' })
  assert.deepEqual(calls.map((call) => call.url), [
    'https://api-delivery.ozon.ru/v1/order/checkout',
    'https://api-delivery.ozon.ru/v1/posting/info',
    'https://api-delivery.ozon.ru/v1/posting/status-history',
  ])
  assert.equal(calls[0].options.body, JSON.stringify(checkout))
})

test('client maps upstream Ozon errors without retrying auth/validation failures', async () => {
  const { impl, calls } = fakeFetch(async () => Response.json({ code: 7, message: 'method is not allowed' }, { status: 403 }))
  const client = createOzonClient({ ...baseConfig, auth: { type: 'api-key', clientId: 'id', apiKey: 'secret-key' } }, { fetchImpl: impl })
  await assert.rejects(() => client.checkDelivery('79005550100'), (error) => error instanceof OzonApiError && error.status === 403 && error.ozonCode === 7)
  assert.equal(calls.length, 1)
})

test('client retries rate limits and server errors with backoff then succeeds', async () => {
  const { impl, calls } = fakeFetch(async (url, options, attempt) => (attempt < 3 ? new Response('busy', { status: attempt === 1 ? 429 : 500 }) : Response.json({ points: [] })))
  const client = createOzonClient({ ...baseConfig, auth: { type: 'api-key', clientId: 'id', apiKey: 'key' } }, { fetchImpl: impl })
  assert.deepEqual(await client.getPickupPoints(), { points: [] })
  assert.equal(calls.length, 3)
})

test('client exhausts attempts on persistent server errors', async () => {
  const { impl, calls } = fakeFetch(async () => new Response('down', { status: 500 }))
  const client = createOzonClient({ ...baseConfig, auth: { type: 'api-key', clientId: 'id', apiKey: 'key' } }, { fetchImpl: impl })
  await assert.rejects(() => client.getPickupPoints(), (error) => error instanceof OzonApiError && error.status === 500)
  assert.equal(calls.length, 3)
})

test('client redacts secret material from upstream error messages and logs', async () => {
  const lines = []
  const { impl } = fakeFetch(async () => Response.json({ code: 3, message: 'Invalid Api-Key "top-secret-value" rejected' }, { status: 400 }))
  const client = createOzonClient({ ...baseConfig, auth: { type: 'api-key', clientId: 'id', apiKey: 'top-secret-value' } }, { fetchImpl: impl, logger: (line) => lines.push(line) })
  await assert.rejects(() => client.getPickupPoints(), (error) => {
    assert.equal(error instanceof OzonApiError, true)
    assert.match(error.message, /\[REDACTED\]/)
    assert.doesNotMatch(error.message, /top-secret-value/)
    return true
  })
  const logged = lines.join('\n')
  assert.doesNotMatch(logged, /top-secret-value/)
})

test('mutating order creation is refused by default without any network call', async () => {
  const { impl, calls } = fakeFetch(async () => Response.json({ order_number: 'x' }))
  const client = createOzonClient({ ...baseConfig, auth: { type: 'api-key', clientId: 'id', apiKey: 'key' } }, { fetchImpl: impl })
  await assert.rejects(() => client.createOrder({ splits: [] }), (error) => error instanceof OzonMutationDisabledError && error.code === 'OZON_MUTATIONS_DISABLED')
  assert.equal(calls.length, 0)
})

test('mutating order creation can be exercised only with an explicit in-memory opt-in and stable idempotency key', async () => {
  const { impl, calls } = fakeFetch(async () => Response.json({ order_number: '1000-1', postings: [] }))
  const client = createOzonClient({ ...baseConfig, allowMutations: true, auth: { type: 'api-key', clientId: 'id', apiKey: 'key' } }, { fetchImpl: impl })
  const key = '11111111-2222-4333-8444-555555555555'
  const result = await client.createOrder({ buyer: {}, delivery: {}, delivery_schema: 'MIX', recipient: {}, splits: [] }, key)
  assert.deepEqual(result, { order_number: '1000-1', postings: [] })
  assert.equal(calls[0].url, 'https://api-seller.ozon.ru/v1/order/create')
  assert.equal(calls[0].options.headers['Idempotency-Key'], key)
  assert.throws(() => client.createOrder({}, 'not-a-uuid'), /OZON_IDEMPOTENCY_KEY_INVALID/)
  assert.equal(calls.length, 1)
})

function routeRequest(body, origin = 'http://vozdooh.test', host = 'vozdooh.test') {
  return new Request('http://vozdooh.test/api/ozon/pickup-points', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, host },
    body: JSON.stringify(body),
  })
}

test('pickup points route fails closed while the feature flag is disabled', async () => {
  delete process.env.OZON_DELIVERY_ENABLED
  let fetchCalled = false
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { fetchCalled = true; return Response.json({}) }
  try {
    const response = await pickupPointsRoute.POST(routeRequest({}))
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { code: 'OZON_DELIVERY_DISABLED' })
    assert.equal(fetchCalled, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('pickup points route rejects cross-origin and malformed requests', async () => {
  process.env.OZON_DELIVERY_ENABLED = 'true'
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ points: [] })
  try {
    const crossOrigin = await pickupPointsRoute.POST(routeRequest({}, 'http://evil.example', 'vozdooh.test'))
    assert.equal(crossOrigin.status, 403)
    const wrongType = await pickupPointsRoute.POST(new Request('http://vozdooh.test/api/ozon/pickup-points', { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'http://vozdooh.test', host: 'vozdooh.test' }, body: 'x' }))
    assert.equal(wrongType.status, 415)
    const badJson = new Request('http://vozdooh.test/api/ozon/pickup-points', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://vozdooh.test', host: 'vozdooh.test' }, body: '{' })
    assert.equal((await pickupPointsRoute.POST(badJson)).status, 400)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('pickup points route reports missing secrets without exposing paths or contents', async () => {
  process.env.OZON_DELIVERY_ENABLED = 'true'
  process.env.OZON_CLIENT_ID_FILE = '/nonexistent-client-id'
  process.env.OZON_API_KEY_FILE = '/nonexistent-api-key'
  const response = await pickupPointsRoute.POST(routeRequest({}))
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.code, 'OZON_CLIENT_ID_UNAVAILABLE')
})

test('pickup points route requires OAuth client credentials when enabled', async () => {
  process.env.OZON_DELIVERY_ENABLED = 'true'
  delete process.env.OZON_OAUTH_CLIENT_ID_FILE
  delete process.env.OZON_OAUTH_CLIENT_SECRET_FILE
  const response = await pickupPointsRoute.POST(routeRequest({ query: 'Хабаровск' }))
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.match(body.code, /^OZON_/)
})
