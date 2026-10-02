import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const API = 'https://payapi.ozon.ru'
const CURRENCY = '643'

type Credentials = { accessKey: string; secretKey: string; notificationSecret: string }
type CreatePaymentInput = { extId: string; amountMinor: number; redirectUrl: string; notificationUrl?: string; ttl?: number }
export type OzonPayment = { paymentId: string; redirectUrl: string; status: string }

async function secret(env: string, fileEnv: string) {
  const direct = process.env[env]?.trim()
  if (direct) return direct
  const path = process.env[fileEnv]?.trim()
  if (!path) throw new Error('OZON_ACQUIRING_NOT_CONFIGURED')
  const value = (await readFile(path, 'utf8')).trim()
  if (!value) throw new Error('OZON_ACQUIRING_NOT_CONFIGURED')
  return value
}

export async function loadOzonCredentials(): Promise<Credentials> {
  return {
    accessKey: await secret('OZON_ACQUIRING_TOKEN_ID', 'OZON_ACQUIRING_TOKEN_ID_FILE'),
    secretKey: await secret('OZON_ACQUIRING_SECRET_KEY', 'OZON_ACQUIRING_SECRET_KEY_FILE'),
    notificationSecret: await secret('OZON_ACQUIRING_NOTIFICATION_SECRET', 'OZON_ACQUIRING_NOTIFICATION_SECRET_FILE'),
  }
}export function createPaymentSign(extId: string, accessKey: string, secretKey: string) {
  return createHash('sha256').update(`${extId}${accessKey}${secretKey}`, 'utf8').digest('hex')
}

function ozonAmount(amountMinor: number) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('INVALID_PAYMENT_AMOUNT')
  // Ozon Acquiring expects minor monetary units: kopecks for RUB.
  return String(amountMinor)
}

export async function createOzonPayment(input: CreatePaymentInput, fetcher: typeof fetch = fetch): Promise<OzonPayment> {
  const { accessKey, secretKey } = await loadOzonCredentials()
  if (!/^[0-9a-f-]{36}$/i.test(input.extId)) throw new Error('INVALID_PAYMENT_ID')
  const body = {
    accessKey,
    amount: { currencyCode: CURRENCY, value: ozonAmount(input.amountMinor) },
    extId: input.extId,
    payType: 'SBP',
    redirectUrl: input.redirectUrl,
    ...(input.notificationUrl ? { notificationUrl: input.notificationUrl } : {}),
    ...(input.ttl ? { ttl: input.ttl } : {}),
    requestSign: createPaymentSign(input.extId, accessKey, secretKey),
  }
  const response = await fetcher(`${API}/v1/createPayment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
  const raw = await response.text()
  let data: { redirectUrl?: unknown; order?: { payLink?: unknown; item?: { payLink?: unknown } }; paymentDetails?: { paymentId?: unknown; status?: unknown; sbp?: Record<string, unknown> }; code?: unknown; message?: unknown } | null = null
  try { data = JSON.parse(raw) } catch {}
  if (!response.ok || !data) {
    const code = data && typeof data.code === 'string' ? data.code : ''
    const message = data && typeof data.message === 'string' ? data.message.replace(/[\r\n]/g, ' ').slice(0, 240) : raw.replace(/[\r\n]/g, ' ').slice(0, 240)
    console.error('OZON_CREATE_PAYMENT_FAILED', { status: response.status, code, message })
    throw new Error(`OZON_PAYMENT_HTTP_${response.status}`)
  }
  const paymentId = data.paymentDetails?.paymentId
  const sbpPayload = data.paymentDetails?.sbp?.payload
  const redirectUrl = data.redirectUrl ?? data.order?.item?.payLink ?? data.order?.payLink ?? sbpPayload
  if (typeof paymentId !== 'string' || typeof redirectUrl !== 'string' || !redirectUrl.startsWith('https://')) {
    console.error('OZON_PAYMENT_INVALID_RESPONSE_SHAPE', { status: response.status, keys: Object.keys(data), paymentDetailsKeys: data.paymentDetails && typeof data.paymentDetails === 'object' ? Object.keys(data.paymentDetails) : [], sbpKeys: data.paymentDetails && typeof data.paymentDetails === 'object' && data.paymentDetails.sbp && typeof data.paymentDetails.sbp === 'object' ? Object.keys(data.paymentDetails.sbp) : [], orderKeys: data.order && typeof data.order === 'object' ? Object.keys(data.order) : [], hasRedirectUrl: typeof data.redirectUrl === 'string', hasOrderPayLink: typeof data.order?.payLink === 'string', hasItemPayLink: typeof data.order?.item?.payLink === 'string', hasSbpPayload: typeof sbpPayload === 'string' })
    throw new Error('OZON_PAYMENT_INVALID_RESPONSE')
  }
  return { paymentId, redirectUrl, status: String(data.paymentDetails?.status ?? 'PAYMENT_NEW') }
}export type OzonNotification = {
  accessKey?: string; orderID?: string | null; transactionID?: string | number | null
  transactionUid?: string | null; extOrderID?: string | null; extTransactionID?: string | null
  amount?: string | number; currencyCode?: string | number; requestSign?: string
  [key: string]: unknown
}

export function verifyOzonNotification(body: OzonNotification, secretKey: string) {
  const transaction = body.transactionID ?? body.transactionUid ?? ''
  const external = body.orderID ? (body.extOrderID ?? '') : (body.extTransactionID ?? '')
  const raw = `${body.accessKey ?? ''}|${body.orderID ?? ''}|${transaction}|${external}|${body.amount ?? ''}|${body.currencyCode ?? ''}|${secretKey}`
  const expected = createHash('sha256').update(raw, 'utf8').digest('hex')
  const actual = String(body.requestSign ?? '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(actual)) return false
  return timingSafeEqual(Buffer.from(actual, 'ascii'), Buffer.from(expected, 'ascii'))
}
export function createOrderSign(input: { accessKey: string; expiresAt?: string; extId: string; fiscalizationType?: string; paymentAlgorithm: string; currencyCode: string; amountValue: string; secretKey: string }) {
  return createHash('sha256').update(`${input.accessKey}${input.expiresAt ?? ''}${input.extId}${input.fiscalizationType ?? ''}${input.paymentAlgorithm}${input.currencyCode}${input.amountValue}${input.secretKey}`).digest('hex')
}

export async function createOzonOrder(input: { extId: string; amountMinor: number; items: { extId: string; name: string; quantity: number; unitPriceMinor: number }[]; successUrl: string; failUrl: string; notificationUrl?: string }, fetcher: typeof fetch = fetch) {
  const accessKey = await secret('OZON_ACQUIRING_TOKEN_ID', 'OZON_ACQUIRING_TOKEN_ID_FILE')
  const secretKey = await secret('OZON_ACQUIRING_SECRET_KEY', 'OZON_ACQUIRING_SECRET_KEY_FILE')
  const amountValue = ozonAmount(input.amountMinor)
  const paymentAlgorithm = 'PAY_ALGO_SMS'
  const body = {
    accessKey,
    amount: { currencyCode: '643', value: amountValue },
    extId: input.extId,
    mode: 'MODE_FULL',
    items: input.items.map(item => ({ extId: item.extId, name: item.name, quantity: item.quantity, price: { currencyCode: '643', value: ozonAmount(item.unitPriceMinor) }, type: 'TYPE_PRODUCT', vat: 'VAT_20', needMark: false })),
    paymentAlgorithm,
    successUrl: input.successUrl,
    failUrl: input.failUrl,
    ...(input.notificationUrl ? { notificationUrl: input.notificationUrl } : {}),
    requestSign: createOrderSign({ accessKey, extId: input.extId, paymentAlgorithm, currencyCode: '643', amountValue, secretKey }),
  }
  const response = await fetcher(`${API}/v1/createOrder`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
  const text = await response.text()
  let data: { order?: { id?: unknown; payLink?: unknown; status?: unknown }; code?: unknown; message?: unknown } | null = null
  try { data = JSON.parse(text) } catch { /* handled below */ }
  if (!response.ok || !data) {
    console.error('OZON_CREATE_ORDER_FAILED', { status: response.status, body: text.slice(0, 1000) })
    throw new Error('OZON_CREATE_ORDER_FAILED')
  }
  const orderId = data.order?.id
  const payLink = data.order?.payLink
  if (typeof orderId !== 'string' || typeof payLink !== 'string' || !payLink.startsWith('https://')) {
    console.error('OZON_ORDER_INVALID_RESPONSE_SHAPE', { status: response.status, keys: Object.keys(data), orderKeys: data.order && typeof data.order === 'object' ? Object.keys(data.order) : [], hasPayLink: typeof payLink === 'string' })
    throw new Error('OZON_ORDER_INVALID_RESPONSE')
  }
  return { paymentId: orderId, redirectUrl: payLink, status: String(data.order?.status ?? 'STATUS_NEW') }
}

export async function getOzonOrderDetails(input: { id: string; extId: string }, fetcher: typeof fetch = fetch) {
  const accessKey = await secret('OZON_ACQUIRING_TOKEN_ID', 'OZON_ACQUIRING_TOKEN_ID_FILE')
  const secretKey = await secret('OZON_ACQUIRING_SECRET_KEY', 'OZON_ACQUIRING_SECRET_KEY_FILE')
  const requestSign = createHash('sha256').update(`${input.id}${input.extId}${accessKey}${secretKey}`).digest('hex')
  const response = await fetcher(`${API}/v1/getOrderDetails`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: input.id, extId: input.extId, accessKey, requestSign }), signal: AbortSignal.timeout(10_000) })
  const data = await response.json() as unknown
  if (!data || typeof data !== 'object') throw new Error('OZON_ORDER_DETAILS_INVALID_RESPONSE')
  if (!response.ok) throw new Error(`OZON_ORDER_DETAILS_HTTP_${response.status}`)
  const root = data as Record<string, unknown>
  const candidate = root.item ?? root.order ?? root
  const order = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {}
  const operations = Array.isArray(order.operations) ? order.operations : []
  return { status: order.status ?? null, mode: order.mode ?? null, paymentAlgorithm: order.paymentAlgorithm ?? null, operations: operations.map((value) => {
    const op = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const paymentData = op.paymentData && typeof op.paymentData === 'object' ? op.paymentData as Record<string, unknown> : {}
    const bankCard = paymentData.bankCard && typeof paymentData.bankCard === 'object' ? paymentData.bankCard as Record<string, unknown> : {}
    return { status: op.status ?? null, operationType: op.operationType ?? null, paymentType: paymentData.paymentType ?? null, paySystem: bankCard.paySystem ?? null }
  }) }
}
