import { resolve } from 'node:path'
import { localRequestStore } from '../../../../../src/commerce/localRequestStore'
import { beginOzonPayment, PaymentError } from '../../../../../src/commerce/orderPayment'
import { requireFreshOnecInventory } from '../../../../../src/commerce/inventoryFreshness'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin')
    const host = request.headers.get('host') ?? new URL(request.url).host
    if (!origin || new URL(origin).host !== host) throw new PaymentError('INVALID_ORIGIN', 403)
    const body = await request.json() as { requestId?: unknown }
    if (typeof body.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.requestId)) throw new PaymentError('INVALID_REQUEST_ID')
    const store = localRequestStore(resolve(/* turbopackIgnore: true */ process.env.ORDER_REQUEST_STORE_PATH ?? '.local/order-requests'))
    const result = await beginOzonPayment(body.requestId, store, undefined, async () => {
      try { await requireFreshOnecInventory() } catch { throw new PaymentError('INVENTORY_STALE', 503) }
    })
    return Response.json(result, { status: 201, headers })
  } catch (error) {
    if (error instanceof PaymentError) return Response.json({ code: error.code }, { status: error.status, headers })
    const safe = error instanceof Error ? { name: error.name, message: error.message } : { name: typeof error, message: 'non_error_throw' }
    console.error('OZON_PAYMENT_CREATE_UNAVAILABLE', safe)
    return Response.json({ code: 'PAYMENT_UNAVAILABLE' }, { status: 503, headers })
  }
}
