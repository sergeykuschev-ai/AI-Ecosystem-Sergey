import { ozonDeliveryEnabled, loadOzonClientConfig, OzonConfigError } from '../../../../src/integrations/ozon/config'
import { createOzonClient, OzonApiError } from '../../../../src/integrations/ozon/client'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }
const MAX_BODY_BYTES = 4096

/** Read-only Ozon Delivery pickup point list for the future checkout map.
 * Available only when OZON_DELIVERY_ENABLED=true; never creates or changes Ozon data. */
export async function POST(request: Request) {
  try {
    if (!ozonDeliveryEnabled()) throw new OzonConfigError('OZON_DELIVERY_DISABLED')
    // Require a same-origin browser request; never trust arbitrary forwarded host headers.
    const origin = request.headers.get('origin')
    let sameOrigin = false
    try {
      const parsedOrigin = new URL(origin ?? '')
      const host = request.headers.get('host') ?? new URL(request.url).host
      sameOrigin = parsedOrigin.origin === origin && ['http:', 'https:'].includes(parsedOrigin.protocol) && parsedOrigin.host === host
    } catch { /* Missing or malformed browser origins fail closed. */ }
    if (!sameOrigin) return Response.json({ code: 'INVALID_ORIGIN' }, { status: 403, headers })
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return Response.json({ code: 'INVALID_CONTENT_TYPE' }, { status: 415, headers })
    const reader = request.body?.getReader()
    if (!reader) return Response.json({ code: 'INVALID_REQUEST' }, { status: 400, headers })
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return Response.json({ code: 'REQUEST_TOO_LARGE' }, { status: 413, headers }) }
      chunks.push(value)
    }
    try { JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return Response.json({ code: 'INVALID_JSON' }, { status: 400, headers }) }
    const client = createOzonClient(loadOzonClientConfig())
    const result = await client.getPickupPoints()
    return Response.json(result, { status: 200, headers })
  } catch (error) {
    if (error instanceof OzonConfigError) return Response.json({ code: error.code }, { status: 503, headers })
    if (error instanceof OzonApiError) {
      if (error.status === 429) return Response.json({ code: 'OZON_RATE_LIMITED' }, { status: 429, headers })
      if (error.status === 0) return Response.json({ code: error.message }, { status: 504, headers })
      // Upstream auth/permission failures are reported as sanitized codes only.
      return Response.json({ code: 'OZON_UPSTREAM_ERROR', ozonCode: error.ozonCode }, { status: 502, headers })
    }
    // Never log request bodies, contact details, secrets or filesystem exception contents.
    console.error('OZON_PICKUP_POINTS_UNAVAILABLE')
    return Response.json({ code: 'OZON_PICKUP_POINTS_UNAVAILABLE' }, { status: 503, headers })
  }
}
