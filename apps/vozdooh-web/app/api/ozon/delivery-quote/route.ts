import { resolve } from 'node:path'
import { ozonDeliveryEnabled, OzonConfigError } from '../../../../src/integrations/ozon/config'
import { OzonApiError } from '../../../../src/integrations/ozon/client'
import { localRequestStore } from '../../../../src/commerce/localRequestStore'
import { parcelForOrder, LogisticsDataError } from '../../../../src/commerce/logisticsDataset'
import { quoteOzonPickupDelivery, OzonDeliveryQuoteError } from '../../../../src/commerce/ozonDeliveryBusiness'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }

/** Read-only delivery estimate for a saved order, never creates a delivery or payment. */
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin')
    const host = request.headers.get('host') ?? new URL(request.url).host
    if (!origin || new URL(origin).origin !== origin || new URL(origin).host !== host ||
        !['https:', 'http:'].includes(new URL(origin).protocol)) {
      return Response.json({ code: 'INVALID_ORIGIN' }, { status: 403, headers })
    }
    if (!ozonDeliveryEnabled()) throw new OzonConfigError('OZON_DELIVERY_DISABLED')
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
      return Response.json({ code: 'INVALID_CONTENT_TYPE' }, { status: 415, headers })
    }
    const bodyText = await request.text()
    if (bodyText.length > 1024) return Response.json({ code: 'REQUEST_TOO_LARGE' }, { status: 413, headers })
    let body: { requestId?: unknown }
    try { body = JSON.parse(bodyText) as { requestId?: unknown } } catch {
      return Response.json({ code: 'INVALID_JSON' }, { status: 400, headers })
    }
    if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) {
      return Response.json({ code: 'INVALID_REQUEST_ID' }, { status: 422, headers })
    }
    const store = localRequestStore(resolve(/* turbopackIgnore: true */ process.env.ORDER_REQUEST_STORE_PATH ?? '.local/order-requests'))
    const order = await store.findById(body.requestId)
    if (!order) return Response.json({ code: 'REQUEST_NOT_FOUND' }, { status: 404, headers })
    if (order.input.delivery.method !== 'ozon-pvz') return Response.json({ code: 'OZON_DELIVERY_METHOD_UNSUPPORTED' }, { status: 422, headers })
    const parcel = parcelForOrder(order)
    const quote = await quoteOzonPickupDelivery(order, parcel)
    if (!Number.isFinite(quote.totalDeliveryCostRub) || quote.totalDeliveryCostRub <= 0) throw new OzonDeliveryQuoteError('OZON_DELIVERY_PRICE_UNAVAILABLE')
    return Response.json({
      estimatedDeliveryCostRub: quote.estimatedDeliveryCostRub,
      estimatedInsuranceCostRub: quote.estimatedInsuranceCostRub,
      estimatedTotalDeliveryRub: quote.totalDeliveryCostRub,
      estimatedDeliveryDays: quote.estimatedDeliveryDays,
      productTotalMinor: order.totalMinor,
      estimatedCombinedTotalMinor: order.totalMinor + Math.round(quote.totalDeliveryCostRub * 100),
      deliveryIncludedInPayment: false,
    }, { status: 200, headers })
  } catch (error) {
    if (error instanceof LogisticsDataError || error instanceof OzonDeliveryQuoteError) {
      return Response.json({ code: error.code }, { status: 422, headers })
    }
    if (error instanceof OzonApiError) return Response.json({ code: 'OZON_QUOTE_TEMPORARILY_UNAVAILABLE' }, { status: 503, headers })
    if (error instanceof OzonConfigError) return Response.json({ code: error.code }, { status: 503, headers })
    console.error('OZON_DELIVERY_QUOTE_UNAVAILABLE')
    return Response.json({ code: 'OZON_DELIVERY_QUOTE_UNAVAILABLE' }, { status: 503, headers })
  }
}
