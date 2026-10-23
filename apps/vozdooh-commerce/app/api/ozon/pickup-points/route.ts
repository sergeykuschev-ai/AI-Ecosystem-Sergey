import { ozonDeliveryEnabled, loadOzonOAuthClientConfig, OzonConfigError, OZON_DEFAULT_BASE_URL } from '../../../../src/integrations/ozon/config'
import { exchangeClientCredentials } from '../../../../src/integrations/ozon/oauth'
import { createOzonClient, OzonApiError } from '../../../../src/integrations/ozon/client'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }
const MAX_BODY_BYTES = 4096
const CACHE_TTL_MS = 15 * 60 * 1000
type PickupPoint = Record<string, unknown> & { delivery_point_id: number; shipment_method_ids: number[] }
let pointCache: { expiresAt: number; points: PickupPoint[] } | null = null
let refreshPromise: Promise<PickupPoint[]> | null = null

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
    let body: { query?: unknown }
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query?: unknown } } catch { return Response.json({ code: 'INVALID_JSON' }, { status: 400, headers }) }
    const query = typeof body.query === 'string' ? body.query.trim().toLocaleLowerCase('ru-RU') : ''
    if (query.length > 120) return Response.json({ code: 'INVALID_QUERY' }, { status: 400, headers })
    let points = pointCache && pointCache.expiresAt > Date.now() ? pointCache.points : null
    if (!points) {
      refreshPromise ??= (async () => {
        const tokens = await exchangeClientCredentials(loadOzonOAuthClientConfig())
        const client = createOzonClient({ auth: { type: 'oauth', token: tokens.access_token }, baseUrl: process.env.OZON_API_BASE_URL ?? OZON_DEFAULT_BASE_URL, timeoutMs: 10_000, maxAttempts: 3, retryBaseMs: 500, allowMutations: false })
        const summaries: Array<{ delivery_point_id: number; shipment_method_ids: number[] }> = []
        let cursor: string | null = null
        for (let page = 0; page < 50 && summaries.length < 5000; page++) {
          const result = await client.getPickupPoints(cursor, 100) as { delivery_points?: unknown; next_cursor?: unknown }
          if (!Array.isArray(result.delivery_points)) throw new OzonApiError(502, null, 'OZON_INVALID_RESPONSE')
          for (const row of result.delivery_points) {
            if (!row || typeof row !== 'object') continue
            const item = row as { delivery_point_id?: unknown; shipment_method_ids?: unknown }
            if (typeof item.delivery_point_id === 'number' && Array.isArray(item.shipment_method_ids)) summaries.push({ delivery_point_id: item.delivery_point_id, shipment_method_ids: item.shipment_method_ids.filter((id): id is number => typeof id === 'number') })
          }
          cursor = typeof result.next_cursor === 'string' && result.next_cursor ? result.next_cursor : null
          if (!cursor) break
        }
        const details: unknown[] = []
        for (let i = 0; i < summaries.length; i += 100) {
          const info = await client.getPickupPointInfo(summaries.slice(i, i + 100).map((row) => row.delivery_point_id)) as { delivery_points?: unknown }
          if (Array.isArray(info.delivery_points)) details.push(...info.delivery_points)
        }
        const methods = new Map(summaries.map((row) => [row.delivery_point_id, row.shipment_method_ids]))
        const enriched: PickupPoint[] = details.flatMap((point) => {
          if (!point || typeof point !== 'object') return []
          const row = point as Record<string, unknown> & { delivery_point_id?: unknown; is_active?: unknown }
          if (typeof row.delivery_point_id !== 'number' || row.is_active === false) return []
          return [{ ...row, delivery_point_id: row.delivery_point_id, shipment_method_ids: methods.get(row.delivery_point_id) ?? [] }]
        })
        pointCache = { expiresAt: Date.now() + CACHE_TTL_MS, points: enriched }
        return enriched
      })().finally(() => { refreshPromise = null })
      points = await refreshPromise
    }
    const filtered = query.length >= 2 ? points.filter((point) => `${String(point.name ?? '')} ${String(point.full_address ?? '')}`.toLocaleLowerCase('ru-RU').includes(query)).slice(0, 30) : []
    return Response.json({ delivery_points: filtered }, { status: 200, headers: { ...headers, 'X-PVZ-Cache': pointCache && pointCache.expiresAt > Date.now() ? 'HIT' : 'MISS' } })
  } catch (error) {
    if (error instanceof OzonConfigError) return Response.json({ code: error.code }, { status: 503, headers })
    if (error instanceof OzonApiError) {
      if (error.status === 429) return Response.json({ code: 'OZON_RATE_LIMITED' }, { status: 429, headers })
      if (error.status === 0) return Response.json({ code: error.message }, { status: 504, headers })
      // Upstream auth/permission failures are reported as sanitized codes only.
      return Response.json({ code: 'OZON_UPSTREAM_ERROR', ozonCode: error.ozonCode, ozonMessage: error.message.slice(0, 240) }, { status: 502, headers })
    }
    // Never log request bodies, contact details, secrets or filesystem exception contents.
    console.error('OZON_PICKUP_POINTS_UNAVAILABLE')
    return Response.json({ code: 'OZON_PICKUP_POINTS_UNAVAILABLE' }, { status: 503, headers })
  }
}
