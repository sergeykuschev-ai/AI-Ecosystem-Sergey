import { createHash, randomUUID } from 'node:crypto'
import type { OrderRequest, OrderRequestStore } from './orderRequests'
import { queueOrderMail } from './orderMail'
import { createOzonClient, type OzonClient } from '../integrations/ozon/client'
import { loadOzonOAuthClientConfig, OZON_DEFAULT_BASE_URL } from '../integrations/ozon/config'
import { exchangeClientCredentials } from '../integrations/ozon/oauth'

export type ParcelDimensions = {
  weightG: number
  lengthMm: number
  widthMm: number
  heightMm: number
}

export type OzonDeliveryQuote = {
  requestId: number
  estimatedDeliveryCostRub: number
  estimatedInsuranceCostRub: number
  totalDeliveryCostRub: number
  estimatedDeliveryDays: number | null
  cutoffAt: string | null
}

export class OzonDeliveryQuoteError extends Error {
  constructor(public code: string) { super(code) }
}

function positiveRequestId(orderId: string): number {
  const digest = createHash('sha256').update(orderId).digest()
  return (digest.readUInt32BE(0) % 2_000_000_000) + 1
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`
  if (digits.length === 10) return `+7${digits}`
  throw new OzonDeliveryQuoteError('OZON_DELIVERY_PHONE_INVALID')
}

function validateParcel(parcel: ParcelDimensions) {
  for (const [key, value] of Object.entries(parcel)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new OzonDeliveryQuoteError(`OZON_DELIVERY_${key.toUpperCase()}_INVALID`)
  }
}

function moneyAmount(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new OzonDeliveryQuoteError('OZON_DELIVERY_DECLARED_VALUE_INVALID')
  return (minor / 100).toFixed(2)
}

function parseMoney(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const amount = (value as { amount?: unknown }).amount
  const parsed = typeof amount === 'string' || typeof amount === 'number' ? Number(amount) : NaN
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}

export function buildOzonPickupCheckoutRequest(order: OrderRequest, parcel: ParcelDimensions) {
  validateParcel(parcel)
  if (order.input.delivery.method !== 'ozon-pvz') throw new OzonDeliveryQuoteError('OZON_DELIVERY_METHOD_UNSUPPORTED')
  const deliveryPointId = order.input.delivery.deliveryPointId
  const shipmentMethodId = order.input.delivery.shipmentMethodId
  if (!Number.isSafeInteger(deliveryPointId) || !deliveryPointId || deliveryPointId <= 0) throw new OzonDeliveryQuoteError('OZON_DELIVERY_POINT_MISSING')
  if (!Number.isSafeInteger(shipmentMethodId) || !shipmentMethodId || shipmentMethodId <= 0) throw new OzonDeliveryQuoteError('OZON_SHIPMENT_METHOD_MISSING')
  const requestId = positiveRequestId(order.id)
  return {
    requestId,
    body: {
      recipient: { phone_number: normalizePhone(order.input.contact.phone) },
      postings: [{
        request_id: requestId,
        shipment_method_id: shipmentMethodId,
        declared_value: { amount: moneyAmount(order.totalMinor), currency_code: 'RUB' },
        dimensions: {
          weight_g: parcel.weightG,
          length_mm: parcel.lengthMm,
          width_mm: parcel.widthMm,
          height_mm: parcel.heightMm,
        },
      }],
      delivery: { delivery_point: { delivery_point_id: deliveryPointId } },
    },
  }
}

export async function quoteOzonPickupDelivery(
  order: OrderRequest,
  parcel: ParcelDimensions,
  client?: Pick<OzonClient, 'checkoutOrder'>,
): Promise<OzonDeliveryQuote> {
  const { requestId, body } = buildOzonPickupCheckoutRequest(order, parcel)
  let api = client
  if (!api) {
    const tokens = await exchangeClientCredentials(loadOzonOAuthClientConfig())
    api = createOzonClient({
      auth: { type: 'oauth', token: tokens.access_token },
      baseUrl: process.env.OZON_API_BASE_URL ?? OZON_DEFAULT_BASE_URL,
      timeoutMs: 10_000,
      maxAttempts: 3,
      retryBaseMs: 500,
      allowMutations: false,
    })
  }
  const response = await api.checkoutOrder(body) as {
    results?: Array<{
      request_id?: unknown
      posting?: {
        estimated_delivery_cost?: unknown
        estimated_insurance_cost?: unknown
        estimated_delivery_days?: unknown
        cutoff_at?: unknown
      }
      error?: unknown
    }>
  }
  const row = Array.isArray(response.results) ? response.results.find((item) => item.request_id === requestId) : undefined
  if (!row) throw new OzonDeliveryQuoteError('OZON_DELIVERY_QUOTE_MISSING')
  if (row.error) throw new OzonDeliveryQuoteError('OZON_DELIVERY_QUOTE_REJECTED')
  const delivery = parseMoney(row.posting?.estimated_delivery_cost)
  const insurance = parseMoney(row.posting?.estimated_insurance_cost)
  const days = typeof row.posting?.estimated_delivery_days === 'number' && Number.isFinite(row.posting.estimated_delivery_days)
    ? row.posting.estimated_delivery_days
    : null
  const cutoffAt = typeof row.posting?.cutoff_at === 'string' ? row.posting.cutoff_at : null
  return {
    requestId,
    estimatedDeliveryCostRub: delivery,
    estimatedInsuranceCostRub: insurance,
    totalDeliveryCostRub: delivery + insurance,
    estimatedDeliveryDays: days,
    cutoffAt,
  }
}


export function buildOzonPickupCreateRequest(
  order: OrderRequest,
  parcel: ParcelDimensions,
  cutoffAt: string | null,
) {
  const { requestId, body } = buildOzonPickupCheckoutRequest(order, parcel)
  const posting = body.postings[0]
  const description = (order.input.delivery.comment || order.lines.map((line) => line.name).join(', ')).slice(0, 500)
  return {
    requestId,
    body: {
      order_external_id: order.id,
      recipient: {
        phone_number: body.recipient.phone_number,
        full_name: order.input.contact.name.slice(0, 200),
      },
      delivery: body.delivery,
      postings: [{
        ...posting,
        cutoff_at: cutoffAt,
        posting_external_id: order.id,
        description,
      }],
    },
  }
}

export async function createConfiguredOzonPickupDelivery(orderId: string, store: OrderRequestStore, parcel: ParcelDimensions) {
  const tokens = await exchangeClientCredentials(loadOzonOAuthClientConfig())
  const client = createOzonClient({
    auth: { type: 'oauth', token: tokens.access_token },
    baseUrl: process.env.OZON_API_BASE_URL ?? OZON_DEFAULT_BASE_URL,
    timeoutMs: 10_000, maxAttempts: 3, retryBaseMs: 500,
    allowMutations: process.env.OZON_DELIVERY_MUTATIONS_ENABLED === 'true',
  })
  return createOzonPickupDelivery(orderId, store, parcel, client)
}

export async function createOzonPickupDelivery(
  orderId: string,
  store: OrderRequestStore,
  parcel: ParcelDimensions,
  client: Pick<OzonClient, 'checkoutOrder' | 'createOrder'>,
) {
  let order = await store.findById(orderId)
  if (!order) throw new OzonDeliveryQuoteError('ORDER_NOT_FOUND')
  if (order.payment?.status !== 'PAID') throw new OzonDeliveryQuoteError('ORDER_NOT_PAID')
  if (order.deliveryOrder?.status === 'created') {
    return {
      changed: false,
      orderNumber: order.deliveryOrder.orderNumber!,
      postingNumber: order.deliveryOrder.postingNumber ?? null,
    }
  }

  if (!order.deliveryOrder) {
    order = await store.replace({
      ...order,
      deliveryOrder: {
        provider: 'ozon',
        idempotencyKey: randomUUID(),
        status: 'pending',
      },
    })
  }
  const pendingDelivery = order.deliveryOrder
  if (!pendingDelivery || pendingDelivery.provider !== 'ozon' || pendingDelivery.status !== 'pending') {
    throw new OzonDeliveryQuoteError('OZON_DELIVERY_STATE_INVALID')
  }

  const quote = await quoteOzonPickupDelivery(order, parcel, client)
  const create = buildOzonPickupCreateRequest(order, parcel, quote.cutoffAt)
  const response = await client.createOrder(create.body, pendingDelivery.idempotencyKey) as {
    order_number?: unknown
    postings?: Array<{ request_id?: unknown; posting_number?: unknown }>
  }
  const orderNumber = typeof response.order_number === 'string' ? response.order_number.trim() : ''
  if (!orderNumber) throw new OzonDeliveryQuoteError('OZON_DELIVERY_CREATE_INVALID_RESPONSE')
  const posting = Array.isArray(response.postings)
    ? response.postings.find((row) => row.request_id === create.requestId) ?? response.postings[0]
    : undefined
  const postingNumber = typeof posting?.posting_number === 'string' && posting.posting_number.trim()
    ? posting.posting_number.trim()
    : undefined

  const current = await store.findById(orderId)
  if (!current?.deliveryOrder || current.deliveryOrder.idempotencyKey !== pendingDelivery.idempotencyKey) {
    throw new OzonDeliveryQuoteError('OZON_DELIVERY_STATE_CHANGED')
  }
  const saved = await store.replace({
    ...current,
    deliveryOrder: {
      provider: 'ozon',
      idempotencyKey: current.deliveryOrder.idempotencyKey,
      status: 'created',
      orderNumber,
      ...(postingNumber ? { postingNumber } : {}),
      createdAt: new Date().toISOString(),
    },
  })
  await queueOrderMail(saved, 'delivery_created')
  return { changed: true, orderNumber, postingNumber: postingNumber ?? null, quote }
}
