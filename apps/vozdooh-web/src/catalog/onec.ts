import type { TradeProduct } from './contracts'

export type RowError = { row: number; field: string; code: string }
export type ImportDiagnostics = {
  received: number; accepted: number; rejected: number
  created: number; updated: number; unchanged: number; errors: RowError[]
}
export class CatalogImportError extends Error {
  constructor(public readonly code: string) { super(code) }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export const MAX_CATALOG_PRODUCTS = 10000

const fields = new Set(['sku', 'name', 'brand', 'category', 'volume', 'price', 'stock', 'barcode', 'characteristics'])
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])
function cleanString(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
}

/** Validate one complete trade record. Never coerce prices, identifiers or editorial data. */
export function normalizeTrade(value: unknown, row: number): { trade?: TradeProduct; errors: RowError[] } {
  const errors: RowError[] = []
  const reject = (field: string, code: string) => { errors.push({ row, field, code }) }
  if (!isRecord(value)) return { errors: [{ row, field: 'row', code: 'EXPECTED_OBJECT' }] }
  if (Object.keys(value).some((key) => !fields.has(key))) reject('row', 'UNSUPPORTED_FIELD')
  for (const field of ['sku', 'name', 'category'] as const) {
    if (!cleanString(value[field], field === 'sku' ? 128 : 500)) reject(field, 'REQUIRED_TEXT')
  }
  if (typeof value.sku === 'string' && (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.sku.trim()))) reject('sku', 'INVALID_SKU')
  for (const field of ['brand', 'volume', 'barcode'] as const) {
    if (value[field] != null && !cleanString(value[field])) reject(field, 'INVALID_TEXT')
  }
  for (const field of ['price', 'stock'] as const) {
    const number = value[field]
    if (number != null && (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER)) reject(field, 'INVALID_NONNEGATIVE_NUMBER')
  }
  const characteristics: Record<string, string> = {}
  if (value.characteristics !== undefined) {
    if (!isRecord(value.characteristics) || Object.keys(value.characteristics).length > 100) reject('characteristics', 'INVALID_CHARACTERISTICS')
    else for (const [key, item] of Object.entries(value.characteristics).sort(([a], [b]) => a.localeCompare(b))) {
      if (!cleanString(key, 100) || unsafeKeys.has(key) || !cleanString(item)) reject('characteristics', 'INVALID_CHARACTERISTIC')
      else characteristics[key] = item.trim()
    }
  }
  if (errors.length) return { errors }
  return { errors, trade: {
    sku: (value.sku as string).trim(), name: (value.name as string).trim(), category: (value.category as string).trim(),
    brand: value.brand == null ? null : (value.brand as string).trim(),
    volume: value.volume == null ? null : (value.volume as string).trim(),
    barcode: value.barcode == null ? null : (value.barcode as string).trim(),
    price: value.price == null ? null : value.price as number,
    stock: value.stock == null ? null : value.stock as number,
    characteristics,
  } }
}

/** Delta batch of complete records: absent SKUs are retained, absent optional fields become unknown. */
export function importCatalog(payload: unknown, previous: readonly TradeProduct[] = []) {
  if (!isRecord(payload) || payload.version !== 1 || !Array.isArray(payload.products) ||
      Object.keys(payload).some((key) => !['version', 'products'].includes(key)) || payload.products.length > MAX_CATALOG_PRODUCTS) {
    throw new CatalogImportError('INVALID_ENVELOPE')
  }
  const current = new Map<string, TradeProduct>()
  for (const row of previous) {
    const normalized = normalizeTrade(row, 0)
    if (!normalized.trade || current.has(normalized.trade.sku)) throw new CatalogImportError('INVALID_PREVIOUS_STATE')
    current.set(normalized.trade.sku, normalized.trade)
  }
  const counts = new Map<string, number>()
  for (const row of payload.products) {
    if (isRecord(row) && typeof row.sku === 'string') {
      const sku = row.sku.trim()
      counts.set(sku, (counts.get(sku) ?? 0) + 1)
    }
  }
  const diagnostics: ImportDiagnostics = { received: payload.products.length, accepted: 0, rejected: 0, created: 0, updated: 0, unchanged: 0, errors: [] }
  payload.products.forEach((row, index) => {
    const result = normalizeTrade(row, index + 1)
    if (isRecord(row) && typeof row.sku === 'string' && (counts.get(row.sku.trim()) ?? 0) > 1) {
      result.errors.push({ row: index + 1, field: 'sku', code: 'DUPLICATE_SKU' })
    }
    if (result.errors.length || !result.trade) {
      diagnostics.rejected++
      diagnostics.errors.push(...result.errors)
      return
    }
    const trade = result.trade
    const existing = current.get(trade.sku)
    diagnostics.accepted++
    if (!existing) diagnostics.created++
    else if (JSON.stringify(existing) === JSON.stringify(trade)) diagnostics.unchanged++
    else diagnostics.updated++
    current.set(trade.sku, trade)
  })
  return { products: [...current.values()].map((trade) => structuredClone(trade)), diagnostics }
}
