import type { TradeProduct } from './contracts'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CatalogImportError, importCatalog, isRecord, MAX_CATALOG_PRODUCTS } from './onec'

const MAX_BYTES = 10 * 1024 * 1024
export function assertLocalMode(environment = process.env.NODE_ENV) {
  if (environment === 'production') throw new CatalogImportError('LOCAL_1C_FORBIDDEN_IN_PRODUCTION')
}
export async function readJsonFile(path: string): Promise<unknown> {
  const handle = await open(path, 'r')
  try {
    if ((await handle.stat()).size > MAX_BYTES) throw new CatalogImportError('FILE_TOO_LARGE')
    const data = await handle.readFile('utf8')
    if (Buffer.byteLength(data) > MAX_BYTES) throw new CatalogImportError('FILE_TOO_LARGE')
    try { return JSON.parse(data) } catch { throw new CatalogImportError('INVALID_JSON') }
  } finally { await handle.close() }
}

/** Local snapshots always carry synthetic provenance; this store is never a production backend. */
export async function readLocalCatalog(path: string) {
  assertLocalMode()
  const value = await readJsonFile(path)
  if (!isRecord(value) || value.kind !== 'internal-synthetic-1c' || value.version !== 1 ||
      Object.keys(value).some((key) => !['kind', 'version', 'products'].includes(key))) throw new CatalogImportError('INVALID_SNAPSHOT')
  const result = importCatalog({ version: 1, products: value.products })
  if (result.diagnostics.rejected) throw new CatalogImportError('INVALID_SNAPSHOT')
  return result.products
}

/** One writer, atomic publish, no partial publication when any row fails validation. */
export async function importLocalFile(input: string, destination: string) {
  assertLocalMode()
  await mkdir(dirname(destination), { recursive: true })
  let lock
  try { lock = await open(`${destination}.lock`, 'wx', 0o600) }
  catch { throw new CatalogImportError('IMPORT_LOCK_UNAVAILABLE') }
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    let previous: TradeProduct[]
    try { previous = await readLocalCatalog(destination) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      previous = []
    }
    const result = importCatalog(await readJsonFile(input), previous)
    if (result.diagnostics.rejected) return { ...result.diagnostics, committed: false }
    const serialized = JSON.stringify({ kind: 'internal-synthetic-1c', version: 1, products: result.products }, null, 2) + '\n'
    if (result.products.length > MAX_CATALOG_PRODUCTS || Buffer.byteLength(serialized) > MAX_BYTES) {
      throw new CatalogImportError('SNAPSHOT_TOO_LARGE')
    }
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(serialized)
      await file.sync()
    } finally { await file.close() }
    await rename(temporary, destination)
    return { ...result.diagnostics, committed: true }
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
    await lock.close()
    await unlink(`${destination}.lock`)
  }
}
