import { createHash, randomUUID } from 'node:crypto'
import type { TradeProduct } from '../catalog/contracts'

import { parseRequest, priceMinor, RequestError, type RequestInput } from './requestValidation'
export { parseRequest, priceMinor, RequestError } from './requestValidation'
export type { RequestInput } from './requestValidation'

export type OrderRequest = {
  version: 1
  id: string
  createdAt: string
  fingerprint: string
  input: RequestInput
  catalogSource: 'staged-1c'
  lines: { sku: string; name: string; quantity: number; unitPriceMinor: number; totalMinor: number; stockAtRequest: number }[]
  totalMinor: number
  currency: 'RUB'
  status: 'request_received'
  payment?: { provider: 'ozon'; paymentId: string; extId: string; redirectUrl: string; createdAt: string; status: 'PAYMENT_NEW' | 'PAID'; paidAt?: string }
  deliveryOrder?: { provider: 'ozon'; idempotencyKey: string; status: 'pending' | 'created'; orderNumber?: string; postingNumber?: string; createdAt?: string }
  consentVersion: 'request-contact-v1'
  marketingConsentVersion?: 'email-marketing-v1'
}
export interface OrderRequestStore {
  find(key: string): Promise<OrderRequest | null>
  save(request: OrderRequest): Promise<OrderRequest>
  findById(id: string): Promise<OrderRequest | null>
  replace(request: OrderRequest): Promise<OrderRequest>
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('INVALID_REQUEST')
  return value as Record<string, unknown>
}
/** Validate persisted receipts before replay; corruption must never look like acceptance. */
export function validateStoredRequest(value: unknown, key: string): OrderRequest {
  try {
    const record = object(value)
    const input = parseRequest(record.input)
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    if (record.version !== 1 || input.retryKey !== key || record.fingerprint !== fingerprint ||
        record.catalogSource !== 'staged-1c' || record.status !== 'request_received' ||
        record.currency !== 'RUB' || record.consentVersion !== 'request-contact-v1' ||
        (record.marketingConsentVersion !== undefined && record.marketingConsentVersion !== 'email-marketing-v1') ||
        (input.marketingConsent === true) !== (record.marketingConsentVersion === 'email-marketing-v1') ||
        typeof record.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id) ||
        typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) ||
        !Array.isArray(record.lines) || record.lines.length !== input.lines.length) throw new Error()
    let total = 0
    record.lines.forEach((value, index) => {
      const line = object(value)
      const expected = input.lines[index]
      if (line.sku !== expected.sku || line.quantity !== expected.quantity ||
          line.unitPriceMinor !== expected.expectedPriceMinor ||
          typeof line.name !== 'string' || !line.name.trim() ||
          typeof line.stockAtRequest !== 'number' || !Number.isFinite(line.stockAtRequest) || line.stockAtRequest < expected.quantity ||
          line.totalMinor !== expected.quantity * expected.expectedPriceMinor || !Number.isSafeInteger(line.totalMinor)) throw new Error()
      total += line.totalMinor as number
    })
    if (!Number.isSafeInteger(total) || total !== record.totalMinor) throw new Error()
    if (record.deliveryOrder !== undefined) {
      const delivery = object(record.deliveryOrder)
      if (delivery.provider !== 'ozon' || !['pending', 'created'].includes(String(delivery.status)) ||
          typeof delivery.idempotencyKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(delivery.idempotencyKey) ||
          (delivery.postingNumber !== undefined && (typeof delivery.postingNumber !== 'string' || !delivery.postingNumber)) ||
          (delivery.createdAt !== undefined && (typeof delivery.createdAt !== 'string' || !Number.isFinite(Date.parse(delivery.createdAt)))) ||
          (delivery.status === 'created' && (typeof delivery.orderNumber !== 'string' || !delivery.orderNumber || typeof delivery.createdAt !== 'string'))) throw new Error()
    }
    if (record.payment !== undefined) {
      const payment = object(record.payment)
      if (payment.provider !== 'ozon' || !['PAYMENT_NEW', 'PAID'].includes(String(payment.status)) ||
          typeof payment.paymentId !== 'string' || !payment.paymentId || typeof payment.extId !== 'string' || !payment.extId ||
          typeof payment.redirectUrl !== 'string' || !/^https:\/\//.test(payment.redirectUrl) ||
          typeof payment.createdAt !== 'string' || !Number.isFinite(Date.parse(payment.createdAt)) ||
          (payment.status === 'PAID' && (typeof payment.paidAt !== 'string' || !Number.isFinite(Date.parse(payment.paidAt))))) throw new Error()
    }
    return record as OrderRequest
  } catch {
    // Do not include stored contact fields or parsing errors in diagnostics.
    throw new Error('CORRUPT_REQUEST_STORE')
  }
}
export function receipt(request: OrderRequest) {
  return { id: request.id, createdAt: request.createdAt, totalMinor: request.totalMinor, currency: request.currency, status: request.status }
}
/** A retry of an accepted request returns its original receipt, even after catalog changes. */
export async function acceptOrderRequest(value: unknown, dependencies: {
  readCatalog: () => Promise<TradeProduct[]>
  store: OrderRequestStore
  ensureFreshInventory?: () => Promise<void>
}) {
  const input = parseRequest(value)
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  const existing = await dependencies.store.find(input.retryKey)
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new RequestError('RETRY_CONFLICT', 409)
    return receipt(existing)
  }
  if (dependencies.ensureFreshInventory) await dependencies.ensureFreshInventory()
  const catalog = new Map((await dependencies.readCatalog()).map((trade) => [trade.sku, trade]))
  const lines = input.lines.map((line) => {
    const trade = catalog.get(line.sku)
    if (!trade || trade.stock === null || !Number.isFinite(trade.stock) || trade.stock < line.quantity) throw new RequestError('STOCK_CHANGED', 409)
    const unitPriceMinor = priceMinor(trade.price)
    if (unitPriceMinor !== line.expectedPriceMinor) throw new RequestError('PRICE_CHANGED', 409)
    const totalMinor = unitPriceMinor * line.quantity
    if (!Number.isSafeInteger(totalMinor)) throw new RequestError('TOTAL_TOO_LARGE')
    return { sku: trade.sku, name: trade.name, quantity: line.quantity, unitPriceMinor, totalMinor, stockAtRequest: trade.stock }
  })
  const totalMinor = lines.reduce((sum, line) => sum + line.totalMinor, 0)
  if (!Number.isSafeInteger(totalMinor)) throw new RequestError('TOTAL_TOO_LARGE')
  const request: OrderRequest = { version: 1, id: randomUUID(), createdAt: new Date().toISOString(), fingerprint, input, catalogSource: 'staged-1c', lines, totalMinor, currency: 'RUB', status: 'request_received', consentVersion: 'request-contact-v1', ...(input.marketingConsent === true ? { marketingConsentVersion: 'email-marketing-v1' as const } : {}) }
  return receipt(await dependencies.store.save(request))
}
