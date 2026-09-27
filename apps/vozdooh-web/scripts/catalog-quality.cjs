/* eslint-disable @typescript-eslint/no-require-imports -- Read-only Node audit. */
require('./register-typescript.cjs')
const { readStagedCatalog } = require('../src/catalog/localStore.ts')
const { stagedTrade, stagedEditorial } = require('../src/catalog/stagedEditorial.ts')
const { mergeCatalog } = require('../src/catalog/repository.ts')
const { withValidImages } = require('../src/catalog/validImages.ts')
const { storefrontProducts, productPresentation } = require('../src/catalog/presentation.ts')

function titleAnomalies(text) {
  return [
    [/\s{2,}/u, 'doubled whitespace'],
    [/^[\s,./·:;]|[\s,/·:;]$/u, 'dangling punctuation/whitespace'],
    [/(?:^|\s)(?:для|с|со|в|во|из|на|и|а)$/iu, 'isolated trailing preposition/conjunction'],
    [/(?:^|\s)для а(?:\s|$)/iu, 'partial-word remnant'],
  ].filter(([pattern]) => pattern.test(text)).map(([, reason]) => reason)
}
async function audit(path) {
  const trades = (await readStagedCatalog(path)).filter((p) => (p.stock ?? 0) > 0).map(stagedTrade)
  const checked = await withValidImages(mergeCatalog(trades, stagedEditorial(trades)))
  const visible = storefrontProducts(checked)
  const missing = (field) => visible.filter((p) => !p.editorial[field]).length
  const rows = visible.map((p) => {
    const display = productPresentation(p)
    return { sku: p.trade.sku, source: p.trade.name, ...display, anomalies: [...titleAnomalies(display.title), ...titleAnomalies(display.subtitle)] }
  })
  return {
    visible: visible.length,
    missingOptional: Object.fromEntries(['description', 'scentFamily', 'mood', 'room'].map((field) => [field, missing(field)])),
    missingVolume: visible.filter((p) => !p.trade.volume).length,
    explicitRecommendations: visible.filter((p) => p.editorial.recommendations.length > 0).length,
    missingExplicitRecommendations: visible.filter((p) => p.editorial.recommendations.length === 0).length,
    positivePrice: visible.filter((p) => (p.trade.price ?? 0) > 0).length,
    missingPositivePrice: visible.filter((p) => !(p.trade.price > 0)).length,
    verifiedImages: visible.length,
    hiddenWithoutVerifiedImage: checked.length - visible.length,
    titleAnomalyCount: rows.filter((row) => row.anomalies.length).length,
    titleAnomalies: rows.filter((row) => row.anomalies.length),
    ...(process.argv.includes('--titles') ? { titles: rows } : {}),
  }
}
module.exports = { titleAnomalies, audit }
if (require.main === module) {
  const path = process.argv[2]
  if (!path || path.startsWith('--')) throw new Error('Usage: node scripts/catalog-quality.cjs /path/to/catalog-staged.json [--titles]')
  audit(path).then((report) => console.log(JSON.stringify(report, null, 2))).catch((error) => { console.error(error); process.exitCode = 1 })
}
