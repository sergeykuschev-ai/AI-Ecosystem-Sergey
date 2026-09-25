/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { acceptOrderRequest, parseRequest, priceMinor } = require('../src/commerce/orderRequests.ts')
const { localRequestStore } = require('../src/commerce/localRequestStore.ts')
const trade = { sku: 'synthetic-1', name: 'Synthetic fixture', price: 12.35, stock: 3 }
const input = () => ({ retryKey: randomUUID(), lines: [{ sku: trade.sku, quantity: 2, expectedPriceMinor: 1235 }], contact: { name: 'Synthetic Test', phone: '+7 000 000 00 00' }, delivery: { method: 'pickup', address: '', comment: 'SYNTHETIC TEST ONLY' }, consent: true })
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vozdooh-request-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = localRequestStore(path.join(dir, 'requests'))
  return { dir, store, readCatalog: async () => [trade] }
}
const rejects = (fn, code) => assert.rejects(fn, (error) => error.code === code)

test('valid request persists exact snapshot, totals, consent and no payment status', async (t) => {
  const dependencies = await fixture(t)
  const payload = input()
  const result = await acceptOrderRequest(payload, dependencies)
  assert.equal(result.totalMinor, 2470)
  assert.equal(result.status, 'request_received')
  assert.equal(result.currency, 'RUB')
  assert.ok(!Number.isNaN(Date.parse(result.createdAt)))
  const record = await dependencies.store.find(payload.retryKey)
  assert.deepEqual(record.lines, [{ sku: trade.sku, name: trade.name, quantity: 2, unitPriceMinor: 1235, totalMinor: 2470, stockAtRequest: 3 }])
  assert.equal(record.consentVersion, 'request-contact-v1')
  assert.equal(record.payment, undefined)
  assert.equal(result.contact, undefined)
  assert.equal((await fs.stat(path.join(dependencies.dir, 'requests', `${payload.retryKey}.json`))).mode & 0o777, 0o600)
  assert.equal((await fs.readdir(path.join(dependencies.dir, 'requests'))).length, 1)
})
test('parallel retries persist one record and same receipt; changed payload conflicts', async (t) => {
  const dependencies = await fixture(t)
  const payload = input()
  const results = await Promise.all(Array.from({ length: 12 }, () => acceptOrderRequest(payload, dependencies)))
  assert.equal(new Set(results.map((r) => r.id)).size, 1)
  assert.equal((await fs.readdir(path.join(dependencies.dir, 'requests'))).length, 1)
  assert.deepEqual(await acceptOrderRequest(payload, { ...dependencies, readCatalog: async () => { throw Error('unavailable') } }), results[0])
  await rejects(() => acceptOrderRequest({ ...payload, contact: { ...payload.contact, name: 'Changed synthetic' } }, dependencies), 'RETRY_CONFLICT')
})
test('invalid contacts, consent, delivery, quantities, duplicates and empty input fail', () => {
  for (const payload of [null, {}, { ...input(), lines: [] }, { ...input(), consent: false }, { ...input(), retryKey: '../unsafe' }, { ...input(), contact: { name: '', phone: '123' } }, { ...input(), contact: { name: 'Test', phone: 'invalid' } }, { ...input(), delivery: { method: 'courier', address: '', comment: '' } }, { ...input(), delivery: { method: 'unknown', address: '', comment: '' } }]) assert.throws(() => parseRequest(payload))
  for (const quantity of [0, -1, 0.5, 1000, Number.MAX_SAFE_INTEGER, '2']) assert.throws(() => parseRequest({ ...input(), lines: [{ sku: trade.sku, quantity, expectedPriceMinor: 1235 }] }))
  const payload = input(); payload.lines.push(payload.lines[0]); assert.throws(() => parseRequest(payload))
  const courier = input(); courier.delivery = { method: 'courier', address: 'Synthetic test address', comment: '' }; assert.equal(parseRequest(courier).delivery.address, courier.delivery.address)
})
test('current stock and price are checked afresh; no write on failure', async (t) => {
  const dependencies = await fixture(t)
  for (const stock of [null, 0, -1, 1, 1.5]) await rejects(() => acceptOrderRequest(input(), { ...dependencies, readCatalog: async () => [{ ...trade, stock }] }), 'STOCK_CHANGED')
  await rejects(() => acceptOrderRequest(input(), { ...dependencies, readCatalog: async () => [] }), 'STOCK_CHANGED')
  await rejects(() => acceptOrderRequest(input(), { ...dependencies, readCatalog: async () => [{ ...trade, price: 12.36 }] }), 'PRICE_CHANGED')
  for (const price of [null, 0, -1, 12.345]) await rejects(() => acceptOrderRequest(input(), { ...dependencies, readCatalog: async () => [{ ...trade, price }] }), 'PRICE_UNAVAILABLE')
  assert.equal((await acceptOrderRequest(input(), { ...dependencies, readCatalog: async () => [{ ...trade, stock: 2 }] })).totalMinor, 2470)
})
test('integer money and overflow boundaries', async (t) => {
  assert.equal(priceMinor(0.29), 29)
  for (const price of [Infinity, NaN, Number.MAX_SAFE_INTEGER, 0.001]) assert.throws(() => priceMinor(price))
  const dependencies = await fixture(t)
  const payload = input(); payload.lines[0].expectedPriceMinor = 5000000000000000
  await rejects(() => acceptOrderRequest(payload, { ...dependencies, readCatalog: async () => [{ ...trade, price: 50000000000000 }] }), 'TOTAL_TOO_LARGE')
})
test('corrupt and unavailable storage fail closed without replacement', async (t) => {
  const dependencies = await fixture(t)
  const payload = input()
  await fs.mkdir(path.join(dependencies.dir, 'requests'))
  const filename = path.join(dependencies.dir, 'requests', `${payload.retryKey}.json`)
  await fs.writeFile(filename, '{corrupt')
  await assert.rejects(() => acceptOrderRequest(payload, dependencies))
  assert.equal(await fs.readFile(filename, 'utf8'), '{corrupt')
  await assert.rejects(() => acceptOrderRequest(input(), { ...dependencies, store: localRequestStore(filename) }))
})

test('HTTP boundary rejects demo, cross-origin, malformed and oversized bodies', async () => {
  const { POST } = require('../app/api/order-requests/route.ts')
  const previous = process.env.CATALOG_PROVIDER
  try {
    process.env.CATALOG_PROVIDER = 'demo'
    const request = (body, headers = {}) => new Request('http://127.0.0.1:3411/api/order-requests', { method: 'POST', headers: { origin: 'http://127.0.0.1:3411', 'content-type': 'application/json', ...headers }, body })
    assert.equal((await POST(request('{}'))).status, 503)
    process.env.CATALOG_PROVIDER = 'staged-1c'
    assert.equal((await POST(request('{}', { origin: 'https://other.invalid' }))).status, 403)
    assert.equal((await POST(request('{}', { 'content-type': 'text/plain' }))).status, 415)
    assert.equal((await POST(request('{'))).status, 400)
    // Next's internal URL may differ from the original browser Host header.
    assert.equal((await POST(request('{', { origin: 'https://preview.example', host: 'preview.example' }))).status, 400)
    assert.equal((await POST(request('{', { origin: 'https://other.invalid', host: 'preview.example', 'x-forwarded-host': 'other.invalid' }))).status, 403)
    assert.equal((await POST(request('{', { origin: 'null' }))).status, 403)
    assert.equal((await POST(request(' '.repeat(32769)))).status, 413)
    const invalid = await POST(request('{}'))
    assert.equal(invalid.status, 422)
    assert.equal(invalid.headers.get('cache-control'), 'no-store')
    assert.match(invalid.headers.get('x-robots-tag'), /noindex/)
  } finally { if (previous === undefined) delete process.env.CATALOG_PROVIDER; else process.env.CATALOG_PROVIDER = previous }
})
