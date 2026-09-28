export class RequestError extends Error {
  constructor(public code: string, public status = 422) { super(code) }
}

export type RequestInput = {
  retryKey: string
  lines: { sku: string; quantity: number; expectedPriceMinor: number }[]
  contact: { name: string; phone: string }
  delivery: { method: 'pickup' | 'courier'; address: string; comment: string }
  consent: true
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('INVALID_REQUEST')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, required = false, multiline = false): string {
  if (typeof value !== 'string' || value.length > max || (multiline ? /[\x00-\x09\x0b-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) throw new RequestError('INVALID_CONTACT_OR_DELIVERY')
  const result = value.trim()
  if (required && !result) throw new RequestError('INVALID_CONTACT_OR_DELIVERY')
  return result
}
/** RUB to kopecks. Unsupported sub-kopeck prices fail instead of silently rounding. */
export function priceMinor(price: number | null): number {
  if (price === null || !Number.isFinite(price) || price <= 0) throw new RequestError('PRICE_UNAVAILABLE', 409)
  const minor = Math.round(price * 100)
  if (!Number.isSafeInteger(minor) || Math.abs(price * 100 - minor) > 0.000001) throw new RequestError('PRICE_UNAVAILABLE', 409)
  return minor
}
export function parseRequest(value: unknown): RequestInput {
  const raw = object(value)
  if (typeof raw.retryKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.retryKey)) throw new RequestError('INVALID_RETRY_KEY')
  if (raw.consent !== true) throw new RequestError('CONSENT_REQUIRED')
  const contact = object(raw.contact)
  const name = text(contact.name, 100, true)
  const phone = text(contact.phone, 32, true)
  if (!/^\+?[0-9 ()-]+$/.test(phone) || !/^\d{10,15}$/.test(phone.replace(/\D/g, ''))) throw new RequestError('INVALID_PHONE')
  const delivery = object(raw.delivery)
  if (delivery.method !== 'pickup' && delivery.method !== 'courier') throw new RequestError('INVALID_DELIVERY')
  const address = text(delivery.address, 500, delivery.method === 'courier')
  const comment = text(typeof delivery.comment === 'string' ? delivery.comment.replace(/\r\n/g, '\n') : delivery.comment, 1000, false, true)
  if (!Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 100) throw new RequestError('INVALID_CART')
  const seen = new Set<string>()
  const lines = raw.lines.map((value) => {
    const line = object(value)
    if (typeof line.sku !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(line.sku) || seen.has(line.sku)) throw new RequestError('INVALID_CART')
    seen.add(line.sku)
    if (!Number.isSafeInteger(line.quantity) || (line.quantity as number) < 1 || (line.quantity as number) > 999) throw new RequestError('INVALID_QUANTITY')
    if (!Number.isSafeInteger(line.expectedPriceMinor) || (line.expectedPriceMinor as number) <= 0) throw new RequestError('PRICE_UNAVAILABLE', 409)
    return { sku: line.sku, quantity: line.quantity as number, expectedPriceMinor: line.expectedPriceMinor as number }
  }).sort((a, b) => a.sku.localeCompare(b.sku))
  return { retryKey: raw.retryKey.toLowerCase(), lines, contact: { name, phone }, delivery: { method: delivery.method, address: delivery.method === 'courier' ? address : '', comment }, consent: true }
}
