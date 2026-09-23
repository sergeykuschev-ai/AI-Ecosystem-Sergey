/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, writeFile, rm, access } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { normalizeTrade, importCatalog } = require('../src/catalog/onec.ts')
const { importLocalFile, readLocalCatalog, assertLocalMode } = require('../src/catalog/localStore.ts')
const { mergeCatalog, createCatalogRepository, emptyEditorial } = require('../src/catalog/repository.ts')
const { catalogSource, getCatalogRepository } = require('../src/catalog/source.ts')
const { applyCatalogFilters, getRecommendations } = require('../src/catalog/filters.ts')
const { parseCatalogFilters } = require('../src/catalog/filterParams.ts')
const row = (overrides = {}) => ({ sku: 'TEST-01', name: 'INTERNAL TEST', category: 'test', ...overrides })
const payload = (...products) => ({ version: 1, products })

test('normalizes complete commerce records without inventing optional values', () => {
  const result = normalizeTrade(row({ sku: ' TEST-01 ', name: ' INTERNAL TEST ', barcode: '00001' }), 1)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.trade, { sku: 'TEST-01', name: 'INTERNAL TEST', category: 'test', brand: null, volume: null, barcode: '00001', price: null, stock: null, characteristics: {} })
  assert.equal(normalizeTrade(row({ price: 0, stock: 0.5 }), 1).trade.stock, 0.5)
})

test('rejects missing, malformed, unsupported and unsafe values with safe diagnostics', () => {
  const invalid = [null, [], {}, row({ sku: '' }), row({ sku: 123 }), row({ sku: '../bad' }), row({ name: ' ' }), row({ category: null }), row({ price: '12.5' }), row({ stock: -1 }), row({ price: Infinity }), row({ price: NaN }), row({ stock: Number.MAX_SAFE_INTEGER + 1 }), row({ barcode: 123 }), row({ brand: false }), row({ volume: '' }), row({ characteristics: null }), row({ characteristics: { x: 1 } }), row({ characteristics: JSON.parse('{"__proto__":"x"}') }), row({ name: 'bad\ntext' })]
  for (const value of invalid) assert.ok(normalizeTrade(value, 2).errors.length)
  const result = importCatalog(payload(row({ description: 'SECRET-SENTINEL', token: 'SECRET-SENTINEL' })))
  assert.equal(result.diagnostics.rejected, 1)
  assert.doesNotMatch(JSON.stringify(result.diagnostics), /SECRET-SENTINEL|token|description/)
  assert.deepEqual(result.diagnostics.errors[0], { row: 1, field: 'row', code: 'UNSUPPORTED_FIELD' })
  for (const envelope of [null, [], {}, { version: 2, products: [] }, { version: 1, products: null }, { version: 1, products: [], extra: true }]) assert.throws(() => importCatalog(envelope), /INVALID_ENVELOPE/)
})

test('upserts by case-sensitive SKU; repeats are idempotent; price and zero stock overwrite', () => {
  const first = importCatalog(payload(row({ price: 12.5, stock: 2 })))
  assert.equal(first.diagnostics.created, 1)
  const before = structuredClone(first.products)
  const repeat = importCatalog(payload(row({ price: 12.5, stock: 2 })), first.products)
  assert.equal(repeat.diagnostics.unchanged, 1)
  assert.equal(repeat.products.length, 1)
  const update = importCatalog(payload(row({ price: 0, stock: 0 })), first.products)
  assert.equal(update.diagnostics.updated, 1)
  assert.equal(update.products[0].stock, 0)
  assert.equal(update.products[0].price, 0)
  assert.deepEqual(first.products, before)
  const omitted = importCatalog(payload(row()), update.products)
  assert.equal(omitted.products[0].price, null)
  assert.equal(omitted.products[0].stock, null)
  assert.deepEqual(importCatalog(payload(), first.products).products, before)
  assert.equal(importCatalog(payload(row({ sku: 'test-01' })), first.products).products.length, 2)
})

test('all duplicate rows are rejected independently of order, preserving prior records', () => {
  const previous = importCatalog(payload(row({ stock: 7 }))).products
  const result = importCatalog(payload(row({ stock: 0 }), row({ sku: ' TEST-01 ', stock: 8 }), row({ sku: 'TEST-02' })), previous)
  assert.deepEqual(result.diagnostics, { received: 3, accepted: 1, rejected: 2, created: 1, updated: 0, unchanged: 0, errors: [{ row: 1, field: 'sku', code: 'DUPLICATE_SKU' }, { row: 2, field: 'sku', code: 'DUPLICATE_SKU' }] })
  assert.equal(result.products[0].stock, 7)
  assert.throws(() => importCatalog(payload(), [...previous, ...previous]), /INVALID_PREVIOUS_STATE/)
})

test('characteristic key ordering does not cause spurious updates', () => {
  const first = importCatalog(payload(row({ characteristics: { b: 'B', a: 'A' } })))
  assert.equal(importCatalog(payload(row({ characteristics: { a: 'A', b: 'B' } })), first.products).diagnostics.unchanged, 1)
})

test('editorial merge stays independent and repository exposes safe snapshots and stock=0', async () => {
  const trades = importCatalog(payload(row({ stock: 0 }))).products
  const content = { ...emptyEditorial('TEST-01'), slug: 'approved-slug', description: 'Approved editorial', scentFamily: 'woody', room: 'study' }
  const editorial = { 'TEST-01': content }
  const products = mergeCatalog(trades, editorial)
  const repository = createCatalogRepository(products)
  assert.equal(await repository.getAvailableQuantity('TEST-01'), 0)
  assert.equal(await repository.getAvailableQuantity('absent'), null)
  assert.equal((await repository.getBySlug('approved-slug')).trade.sku, 'TEST-01')
  assert.equal(await repository.getBySku('absent'), null)
  const copy = await repository.list(); copy[0].trade.name = 'MUTATED'
  assert.equal((await repository.list())[0].trade.name, 'INTERNAL TEST')
  const changed = importCatalog(payload(row({ price: 9 })), trades).products
  assert.deepEqual(mergeCatalog(changed, editorial)[0].editorial, content)
  assert.deepEqual(mergeCatalog(trades)[0].editorial, emptyEditorial('TEST-01'))
  for (const field of ['description', 'images', 'scentFamily', 'mood', 'room', 'recommendations', 'seo', 'editorial']) assert.equal(importCatalog(payload(row({ [field]: 'not allowed' }))).diagnostics.rejected, 1)
  assert.equal(applyCatalogFilters(products, { category: 'test', family: 'woody', mood: null, room: 'study' }).length, 1)
  assert.equal(applyCatalogFilters(mergeCatalog(trades), { category: null, family: 'woody', mood: null, room: null }).length, 0)
  assert.deepEqual(parseCatalogFilters({ category: 'test' }, { test: 'test' }).category, 'test')
  assert.deepEqual(getRecommendations(mergeCatalog(trades), mergeCatalog(trades)[0]), [])
  assert.throws(() => mergeCatalog([...trades, { ...trades[0], sku: 'TEST-02' }], { ...editorial, 'TEST-02': content }), /INVALID_EDITORIAL_SLUG/)
})

test('explicit source selection, demo compatibility and production safeguards', async () => {
  assert.equal(catalogSource('stub'), 'demo')
  assert.equal(catalogSource('demo'), 'demo')
  assert.equal(catalogSource('local-1c'), 'local-1c')
  assert.equal(catalogSource('1c'), '1c')
  assert.throws(() => catalogSource('unknown'), /INVALID_CATALOG_PROVIDER/)
  assert.throws(() => assertLocalMode('production'), /LOCAL_1C_FORBIDDEN/)
  const previous = process.env.CATALOG_PROVIDER
  try {
    process.env.CATALOG_PROVIDER = '1c'
    await assert.rejects(getCatalogRepository(), /ONEC_LIVE_NOT_CONFIGURED/)
    process.env.CATALOG_PROVIDER = 'demo'
    const repository = await getCatalogRepository()
    assert.equal((await repository.list()).length, 8)
    assert.equal((await repository.getBySlug('demo-01')).trade.sku, 'DEMO-01')
  } finally {
    if (previous === undefined) delete process.env.CATALOG_PROVIDER
    else process.env.CATALOG_PROVIDER = previous
  }
})

test('local ingestion is atomic, persistent, idempotent, locked and fails closed on corrupt state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vozdooh-onec-test-'))
  const input = join(directory, 'input.json'), output = join(directory, 'snapshot.json')
  try {
    await writeFile(input, JSON.stringify(payload(row({ price: 12.5, stock: 2 }))))
    assert.equal((await importLocalFile(input, output)).created, 1)
    assert.equal((await importLocalFile(input, output)).unchanged, 1)
    await writeFile(input, JSON.stringify(payload(row({ price: 14.75, stock: 0 }))))
    assert.equal((await importLocalFile(input, output)).updated, 1)
    assert.equal((await readLocalCatalog(output))[0].stock, 0)
    assert.equal((await readLocalCatalog(output))[0].price, 14.75)
    const before = await readFile(output, 'utf8')
    await writeFile(input, JSON.stringify(payload(row({ price: -1 }), row({ sku: 'TEST-02' }))))
    assert.equal((await importLocalFile(input, output)).committed, false)
    assert.equal(await readFile(output, 'utf8'), before)
    await writeFile(input, '{broken')
    await assert.rejects(importLocalFile(input, output), /INVALID_JSON/)
    assert.equal(await readFile(output, 'utf8'), before)
    await writeFile(`${output}.lock`, '')
    await assert.rejects(importLocalFile(input, output), /IMPORT_LOCK_UNAVAILABLE/)
    await rm(`${output}.lock`)
    await writeFile(output, '{}')
    await assert.rejects(importLocalFile(input, output), /INVALID_SNAPSHOT/)
    await assert.rejects(access(`${output}.lock`))
    const production = spawnSync(process.execPath, ['scripts/import-onec.cjs', resolve('tests/fixtures/onec-synthetic.json'), output], { env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' })
    assert.equal(production.status, 1)
    assert.match(production.stderr, /LOCAL_1C_FORBIDDEN_IN_PRODUCTION/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('local snapshot limits cannot publish state that the reader rejects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vozdooh-onec-limits-'))
  const input = join(directory, 'input.json'), output = join(directory, 'snapshot.json')
  try {
    const products = Array.from({ length: 10000 }, (_, index) => row({ sku: `TEST-${index}` }))
    await writeFile(input, JSON.stringify(payload(...products)))
    assert.equal((await importLocalFile(input, output)).created, 10000)
    const before = await readFile(output, 'utf8')
    await writeFile(input, JSON.stringify(payload(row({ sku: 'EXTRA' }))))
    await assert.rejects(importLocalFile(input, output), /SNAPSHOT_TOO_LARGE/)
    assert.equal(await readFile(output, 'utf8'), before)
    assert.equal((await readLocalCatalog(output)).length, 10000)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('validation boundaries preserve fractional values and reject oversized fields/batches', () => {
  for (const number of [0, 0.001, 1.5, Number.MAX_SAFE_INTEGER]) {
    const normalized = normalizeTrade(row({ price: number, stock: number }), 1)
    assert.equal(normalized.trade.price, number)
    assert.equal(normalized.trade.stock, number)
  }
  assert.ok(normalizeTrade(row({ sku: 'A'.repeat(128), name: 'N'.repeat(500) }), 1).trade)
  for (const invalid of [row({ sku: 'A'.repeat(129) }), row({ name: 'N'.repeat(501) }), row({ characteristics: { ['K'.repeat(101)]: 'V' } }), row({ characteristics: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, 'v'])) })]) {
    assert.ok(normalizeTrade(invalid, 1).errors.length)
  }
  assert.throws(() => importCatalog({ version: 1, products: Array(10001).fill(row()) }), /INVALID_ENVELOPE/)
  assert.throws(() => importCatalog(payload(), [row({ price: -1 })]), /INVALID_PREVIOUS_STATE/)
})

test('local source reads imports and updates, with no demo fallback on missing/corrupt state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vozdooh-onec-source-'))
  const input = join(directory, 'input.json'), output = join(directory, 'snapshot.json')
  const saved = { CATALOG_PROVIDER: process.env.CATALOG_PROVIDER, ONEC_LOCAL_CATALOG_PATH: process.env.ONEC_LOCAL_CATALOG_PATH, NODE_ENV: process.env.NODE_ENV }
  try {
    process.env.NODE_ENV = 'test'
    process.env.CATALOG_PROVIDER = 'local-1c'
    process.env.ONEC_LOCAL_CATALOG_PATH = output
    await assert.rejects(getCatalogRepository(), { code: 'ENOENT' })
    await writeFile(input, JSON.stringify(payload(row({ stock: 0, price: 0 }))))
    await importLocalFile(input, output)
    const repository = await getCatalogRepository()
    assert.equal((await repository.list()).length, 1)
    assert.equal((await repository.getBySku('TEST-01')).trade.price, 0)
    assert.equal(await repository.getBySlug('demo-01'), null)
    const slug = (await repository.list())[0].editorial.slug
    await writeFile(input, JSON.stringify(payload(row({ stock: 2, price: 19.75 }))))
    await importLocalFile(input, output)
    assert.equal((await (await getCatalogRepository()).getBySlug(slug)).trade.price, 19.75)
    assert.equal((await repository.getBySlug(slug)).trade.price, 0)
    process.env.NODE_ENV = 'production'
    await assert.rejects(getCatalogRepository(), /LOCAL_1C_FORBIDDEN_IN_PRODUCTION/)
    process.env.NODE_ENV = 'test'
    await writeFile(output, '{}')
    await assert.rejects(getCatalogRepository(), /INVALID_SNAPSHOT/)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test('CLI imports the synthetic fixture, reports repeats, and rejects invalid input safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vozdooh-onec-cli-'))
  const output = join(directory, 'snapshot.json'), input = join(directory, 'invalid.json')
  const run = (...args) => spawnSync(process.execPath, ['scripts/import-onec.cjs', ...args], { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8' })
  try {
    const fixture = resolve('tests/fixtures/onec-synthetic.json')
    const first = run(fixture, output)
    assert.equal(first.status, 0, first.stderr)
    assert.equal(JSON.parse(first.stdout).created, 1)
    assert.equal(JSON.parse(run(fixture, output).stdout).unchanged, 1)
    const before = await readFile(output, 'utf8')
    await writeFile(input, JSON.stringify(payload(row({ stock: -1 }))))
    const invalid = run(input, output)
    assert.equal(invalid.status, 1)
    assert.equal(JSON.parse(invalid.stdout).committed, false)
    assert.equal(await readFile(output, 'utf8'), before)
    assert.equal(run().status, 1)
    assert.equal(run(join(directory, 'missing.json'), output).status, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('serialized snapshot byte limit preserves previous state and releases the lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vozdooh-onec-bytes-'))
  const input = join(directory, 'input.json'), output = join(directory, 'snapshot.json')
  try {
    await writeFile(input, JSON.stringify(payload(row())))
    await importLocalFile(input, output)
    const before = await readFile(output, 'utf8')
    // Compact input fits 10 MiB, but pretty-printed normalized snapshot does not.
    const characteristics = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key${i}`, 'x'.repeat(500)]))
    const products = Array.from({ length: 202 }, (_, i) => row({ sku: `LARGE-${i}`, characteristics }))
    await writeFile(input, JSON.stringify(payload(...products)))
    await assert.rejects(importLocalFile(input, output), /SNAPSHOT_TOO_LARGE/)
    assert.equal(await readFile(output, 'utf8'), before)
    await assert.rejects(access(`${output}.lock`))
    await writeFile(input, ' '.repeat(10 * 1024 * 1024 + 1))
    await assert.rejects(importLocalFile(input, output), /FILE_TOO_LARGE/)
    assert.equal(await readFile(output, 'utf8'), before)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('filters handle nulls, URL encoding and unknown values; recommendations need editorial approval', async () => {
  const { catalogHref } = require('../src/catalog/filterParams.ts')
  const filters = parseCatalogFilters({ category: ['test & space', 'ignored'], family: 'woody', mood: 'invalid', room: '__proto__' }, { 'test & space': 'test' })
  assert.deepEqual(filters, { category: 'test & space', family: 'woody', mood: null, room: null })
  assert.equal(catalogHref(filters, 'family', null), '/catalog?category=test%20%26%20space')
  const trades = importCatalog(payload(row(), row({ sku: 'SECOND' }))).products
  const products = mergeCatalog(trades, {
    'TEST-01': { ...emptyEditorial('TEST-01'), scentFamily: 'woody', recommendations: ['second'] },
    SECOND: { ...emptyEditorial('SECOND'), slug: 'second', scentFamily: 'woody' },
  })
  assert.deepEqual(getRecommendations(products, products[0]).map(p => p.trade.sku), ['SECOND'])
  assert.deepEqual(getRecommendations(products, products[1]), [])
  assert.equal(getRecommendations(products, products[1], true).length, 1)
  assert.equal((await createCatalogRepository([{ ...products[0], isActive: false }]).list()).length, 0)
  assert.throws(() => mergeCatalog(trades, { 'TEST-01': { ...emptyEditorial('TEST-01'), slug: '../unsafe' } }), /INVALID_EDITORIAL_SLUG/)
})
