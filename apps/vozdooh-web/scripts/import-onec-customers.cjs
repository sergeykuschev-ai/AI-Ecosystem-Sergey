const { readFile, mkdir, writeFile, rename, chmod } = require('node:fs/promises')
const { resolve, dirname } = require('node:path')
const { randomUUID } = require('node:crypto')

const inputPath = process.argv[2]
const outputPath = resolve(process.argv[3] ?? process.env.ONEC_CUSTOMERS_PRIVATE_PATH ?? '/opt/vozdooh/data/crm/customers-private.json')

if (!inputPath || process.argv.length > 4) {
  console.error('Usage: node scripts/import-onec-customers.cjs input.json [output.json]')
  process.exit(2)
}

function normalizePhone(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  let digits = String(value).replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1)
  if (digits.length === 10) digits = '7' + digits
  if (digits.length !== 11 || !digits.startsWith('7')) return null
  return '+' + digits
}

function isoOrNull(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function normalizeCustomer(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const phone = normalizePhone(row.phone)
  if (!phone) return null

  const name = typeof row.name === 'string' ? row.name.trim().slice(0, 200) : ''
  const marketingConsent = row.marketingConsent === true ? true : row.marketingConsent === false ? false : null

  return {
    source: '1c-vozdooh',
    customerId: typeof row.customerId === 'string' && row.customerId.trim() ? row.customerId.trim().slice(0, 200) : null,
    name: name || null,
    phone,
    lastPurchaseAt: isoOrNull(row.lastPurchaseAt),
    totalSpendRub: finiteNumberOrNull(row.totalSpendRub),
    ordersCount: Number.isSafeInteger(Number(row.ordersCount)) && Number(row.ordersCount) >= 0 ? Number(row.ordersCount) : null,
    marketingConsent,
    consentSource: marketingConsent === true && typeof row.consentSource === 'string' && row.consentSource.trim()
      ? row.consentSource.trim().slice(0, 200)
      : null,
    consentAt: marketingConsent === true ? isoOrNull(row.consentAt) : null,
  }
}

function mergeCustomer(existing, next) {
  return {
    ...existing,
    customerId: next.customerId ?? existing.customerId,
    name: next.name ?? existing.name,
    lastPurchaseAt: [existing.lastPurchaseAt, next.lastPurchaseAt].filter(Boolean).sort().at(-1) ?? null,
    totalSpendRub: next.totalSpendRub ?? existing.totalSpendRub,
    ordersCount: next.ordersCount ?? existing.ordersCount,
    marketingConsent: next.marketingConsent ?? existing.marketingConsent,
    consentSource: next.marketingConsent === true ? next.consentSource : existing.consentSource,
    consentAt: next.marketingConsent === true ? next.consentAt : existing.consentAt,
  }
}

async function main() {
  const raw = JSON.parse(await readFile(resolve(inputPath), 'utf8'))
  const rows = Array.isArray(raw) ? raw : raw?.customers
  if (!Array.isArray(rows)) throw new Error('INPUT_MUST_BE_ARRAY_OR_CUSTOMERS_ARRAY')

  const byPhone = new Map()
  let invalid = 0
  for (const row of rows) {
    const customer = normalizeCustomer(row)
    if (!customer) {
      invalid += 1
      continue
    }
    byPhone.set(customer.phone, byPhone.has(customer.phone) ? mergeCustomer(byPhone.get(customer.phone), customer) : customer)
  }

  const customers = [...byPhone.values()].sort((a, b) => a.phone.localeCompare(b.phone))
  const report = {
    importedAt: new Date().toISOString(),
    source: '1c-vozdooh',
    inputRows: rows.length,
    validUniqueCustomers: customers.length,
    invalidRows: invalid,
    duplicatesMerged: rows.length - invalid - customers.length,
    explicitMarketingConsent: customers.filter((x) => x.marketingConsent === true).length,
    explicitMarketingRefusal: customers.filter((x) => x.marketingConsent === false).length,
    marketingConsentUnknown: customers.filter((x) => x.marketingConsent === null).length,
    withPurchaseHistory: customers.filter((x) => x.lastPurchaseAt || x.totalSpendRub !== null || x.ordersCount !== null).length,
  }

  const document = { version: 1, ...report, customers }
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
  const temp = outputPath + '.' + randomUUID() + '.tmp'
  await writeFile(temp, JSON.stringify(document), { mode: 0o600 })
  await rename(temp, outputPath)
  await chmod(outputPath, 0o600)
  console.log(JSON.stringify(report))
}

main().catch((error) => {
  console.error(JSON.stringify({ code: error instanceof Error ? error.message : 'CUSTOMER_IMPORT_ERROR' }))
  process.exitCode = 1
})
