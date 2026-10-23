import { resolve } from 'node:path'
import { localRequestStore } from '../../../../../src/commerce/localRequestStore'
import { publicPaymentStatus } from '../../../../../src/commerce/publicPaymentStatus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('requestId') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ state: 'invalid' }, { status: 400, headers })
  try {
    const store = localRequestStore(resolve(/* turbopackIgnore: true */ process.env.ORDER_REQUEST_STORE_PATH ?? '.local/order-requests'))
    const order = await store.findById(id)
    if (!order) return Response.json({ state: 'not_found' }, { status: 404, headers })
    return Response.json(publicPaymentStatus(order), { headers })
  } catch {
    return Response.json({ state: 'unavailable' }, { status: 503, headers })
  }
}
