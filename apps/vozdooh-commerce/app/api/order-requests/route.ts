import { resolve } from 'node:path'
import { catalogSource } from '../../../src/catalog/source'
import { readStagedCatalog } from '../../../src/catalog/localStore'
import { acceptOrderRequest, parseRequest, RequestError } from '../../../src/commerce/orderRequests'
import { localRequestStore } from '../../../src/commerce/localRequestStore'
import { queueOrderMail } from '../../../src/commerce/orderMail'
import { requireFreshOnecInventory } from '../../../src/commerce/inventoryFreshness'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }
const MAX_BODY_BYTES = 32_768

export async function POST(request: Request) {
  try {
    if (catalogSource() !== 'staged-1c') throw new RequestError('REQUESTS_UNAVAILABLE', 503)
    // Require a same-origin browser request; never trust arbitrary forwarded host headers.
    const origin = request.headers.get('origin')
    let sameOrigin = false
    try {
      const parsedOrigin = new URL(origin ?? '')
      // Next may construct request.url using its internal listening hostname.
      const host = request.headers.get('host') ?? new URL(request.url).host
      sameOrigin = parsedOrigin.origin === origin && ['http:', 'https:'].includes(parsedOrigin.protocol) && parsedOrigin.host === host
    } catch { /* Missing or malformed browser origins fail closed. */ }
    if (!sameOrigin) throw new RequestError('INVALID_ORIGIN', 403)
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new RequestError('INVALID_CONTENT_TYPE', 415)
    const reader = request.body?.getReader()
    if (!reader) throw new RequestError('INVALID_REQUEST', 400)
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new RequestError('REQUEST_TOO_LARGE', 413) }
      chunks.push(value)
    }
    let value: unknown
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { throw new RequestError('INVALID_JSON', 400) }
    parseRequest(value, { requireEmail: true })
    const store = localRequestStore(resolve(/* turbopackIgnore: true */ process.env.ORDER_REQUEST_STORE_PATH ?? '.local/order-requests'))
    const result = await acceptOrderRequest(value, {
      readCatalog: () => readStagedCatalog(resolve(/* turbopackIgnore: true */ process.env.ONEC_LOCAL_CATALOG_PATH ?? '.local/onec-catalog.json')),
      store,
      ensureFreshInventory: async () => {
        try { await requireFreshOnecInventory() } catch { throw new RequestError('INVENTORY_STALE', 503) }
      },
    })
    const order = await store.findById(result.id)
    if (order) await queueOrderMail(order, 'request_received').catch(() => console.error('ORDER_MAIL_QUEUE_FAILED'))
    return Response.json(result, { status: 201, headers })
  } catch (error) {
    if (error instanceof RequestError) return Response.json({ code: error.code }, { status: error.status, headers })
    // Never log request bodies, contact details, or filesystem exception contents.
    console.error('ORDER_REQUEST_UNAVAILABLE')
    return Response.json({ code: 'REQUESTS_UNAVAILABLE' }, { status: 503, headers })
  }
}
