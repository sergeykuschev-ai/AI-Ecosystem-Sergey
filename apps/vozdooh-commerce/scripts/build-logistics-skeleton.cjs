/* eslint-disable @typescript-eslint/no-require-imports -- Node research CLI. */
const fs = require('node:fs')
const path = require('node:path')
require('./register-typescript.cjs')
const { stagedTrade, stagedEditorial } = require('../src/catalog/stagedEditorial.ts')
const { mergeCatalog } = require('../src/catalog/repository.ts')
const { storefrontProducts } = require('../src/catalog/presentation.ts')
const { withValidImages } = require('../src/catalog/validImages.ts')

const sourcePath = process.env.ONEC_LOCAL_CATALOG_PATH || '/opt/vozdooh/data/catalog-staged.json'
const outPath = path.resolve('research/data/logistics-dataset-real.json')
const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
if (raw.kind !== 'staged-real-1c' || raw.version !== 1 || !Array.isArray(raw.products)) throw new Error('INVALID_STAGED_SNAPSHOT')

async function main() {
  const positiveTrades = raw.products.filter((row) => Number(row.stock || 0) > 0).map(stagedTrade)
  const catalog = mergeCatalog(positiveTrades, stagedEditorial(positiveTrades))
  const visibleSkus = new Set(storefrontProducts(await withValidImages(catalog)).map((product) => product.trade.sku))
  const previous = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : { records: [] }
  const previousBySku = new Map((previous.records || []).map((record) => [record.sku, record]))

  const records = raw.products
    .filter((row) => Number(row.stock || 0) > 0 && visibleSkus.has(stagedTrade(row).sku))
    .map((row) => {
      const trade = stagedTrade(row)
      const old = previousBySku.get(trade.sku)
      return {
        sku: trade.sku, name: trade.name, brand: trade.brand, category: trade.category,
        volume: trade.volume, barcode: trade.barcode, declaredValueRub: trade.price, stock: trade.stock,
        status: old?.status || 'NEEDS_SOURCE',
        shipping: old?.shipping || { weightG: null, lengthMm: null, widthMm: null, heightMm: null, diameterMm: null },
        evidence: old?.evidence || [], notes: old?.notes || [],
      }
    })
    .sort((a, b) => (a.brand || '').localeCompare(b.brand || '', 'ru') || a.name.localeCompare(b.name, 'ru'))

  const statusCounts = records.reduce((acc, record) => ((acc[record.status] = (acc[record.status] || 0) + 1), acc), {})
  const dataset = {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    source: { kind: raw.kind, path: sourcePath, eligibilityRule: 'stock > 0 AND storefront-visible (not excluded, valid local image)' },
    rules: previous.rules || {
      identity: 'Exact SKU/product identity only; no family-level dimensions unless a source explicitly states shared packaging.',
      noVolumeToWeight: true, noMissingDimensionInference: true,
      sourcePriority: ['official-manufacturer', 'official-distributor', 'specialist-retailer'],
    },
    counts: {
      eligible: records.length, verified: statusCounts.VERIFIED || 0, partial: statusCounts.PARTIAL || 0,
      conflict: statusCounts.CONFLICT || 0, needsSource: statusCounts.NEEDS_SOURCE || 0,
    },
    records,
  }
  fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2) + '\n')
  console.log(JSON.stringify(dataset.counts))
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
