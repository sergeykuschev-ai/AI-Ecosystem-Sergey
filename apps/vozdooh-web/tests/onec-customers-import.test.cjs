const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile, readFile, stat } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

test('1C VOZDOOH customer import normalizes phones, merges duplicates and never infers marketing consent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vozdooh-customers-'))
  const input = join(dir, 'input.json')
  const output = join(dir, 'customers-private.json')
  await writeFile(input, JSON.stringify([
    { customerId: 'a', name: 'Анна', phone: '8 (924) 111-22-33', lastPurchaseAt: '2025-01-01', totalSpendRub: 10000, ordersCount: 2 },
    { customerId: 'a2', name: 'Анна П.', phone: '+7 924 111 22 33', lastPurchaseAt: '2026-01-01', marketingConsent: true, consentSource: '1C card', consentAt: '2024-01-10' },
    { customerId: 'b', name: 'Борис', phone: '9242223344', marketingConsent: false },
    { customerId: 'bad', phone: '12345', marketingConsent: true },
  ]))

  const run = spawnSync(process.execPath, ['scripts/import-onec-customers.cjs', input, output], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const report = JSON.parse(run.stdout.trim())
  assert.deepEqual(report, {
    importedAt: report.importedAt,
    source: '1c-vozdooh',
    inputRows: 4,
    validUniqueCustomers: 2,
    invalidRows: 1,
    duplicatesMerged: 1,
    explicitMarketingConsent: 1,
    explicitMarketingRefusal: 1,
    marketingConsentUnknown: 0,
    withPurchaseHistory: 1,
  })

  const data = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(data.customers.length, 2)
  const anna = data.customers.find((x) => x.phone === '+79241112233')
  assert.equal(anna.name, 'Анна П.')
  assert.equal(anna.lastPurchaseAt, '2026-01-01T00:00:00.000Z')
  assert.equal(anna.marketingConsent, true)
  const boris = data.customers.find((x) => x.phone === '+79242223344')
  assert.equal(boris.marketingConsent, false)
  assert.equal((await stat(output)).mode & 0o777, 0o600)
})
