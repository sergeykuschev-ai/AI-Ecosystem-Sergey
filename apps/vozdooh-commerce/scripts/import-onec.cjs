/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node tooling. */
require('./register-typescript.cjs')
const { resolve } = require('node:path')
const { importLocalFile } = require('../src/catalog/localStore.ts')
const { CatalogImportError } = require('../src/catalog/onec.ts')
const input = process.argv[2]
if (!input || process.argv.length > 4) {
  console.error('Usage: npm run catalog:import -- input.json [snapshot.json]')
  process.exitCode = 1
} else {
  importLocalFile(resolve(input), resolve(process.argv[3] ?? process.env.ONEC_LOCAL_CATALOG_PATH ?? '.local/onec-catalog.json'))
    .then((diagnostics) => {
      console.log(JSON.stringify(diagnostics))
      if (!diagnostics.committed) process.exitCode = 1
    })
    .catch((error) => {
      console.error(JSON.stringify({ code: error instanceof CatalogImportError ? error.code : 'LOCAL_IMPORT_IO_ERROR' }))
      process.exitCode = 1
    })
}
