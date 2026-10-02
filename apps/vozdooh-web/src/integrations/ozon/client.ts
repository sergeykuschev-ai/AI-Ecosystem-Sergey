/** Server-only Ozon Seller API client for the VOZDOOH Ozon Delivery integration.
 * Read methods mirror the current official Ozon Delivery / posting contracts.
 * Mutating methods are refused unless the caller explicitly opts in in-memory;
 * no route, environment variable or feature flag enables them today.
 */

import type { OzonAuthConfig, OzonClientConfig } from './config'

export class OzonApiError extends Error {
  constructor(public status: number, public ozonCode: number | null, message: string) { super(message) }
}

export class OzonMutationDisabledError extends Error {
  readonly code = 'OZON_MUTATIONS_DISABLED'
  constructor() { super('OZON_MUTATIONS_DISABLED') }
}

type FetchArguments = [string, { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect?: RequestRedirect }]
export type OzonFetch = (...args: FetchArguments) => Promise<Response>
export type OzonLogger = (line: string) => void

export type DeliveryVariantRequest = {
  buyer_phone: string
  delivery_schema: 'MIX' | 'FBO' | 'FBS'
  delivery_type: {
    courier?: { coordinates: { latitude: number; longitude: number } }
    pick_up?: { map_point_id: number | string }
  }
  items: { offer_id: string; quantity: number; sku?: number }[]
}

export type PostingListFilter = { since: string; to: string }

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createOzonClient(config: OzonClientConfig, options: { fetchImpl?: OzonFetch; logger?: OzonLogger } = {}) {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as OzonFetch)
  const logger = options.logger
  const secrets = config.auth.type === 'api-key' ? [config.auth.apiKey] : [config.auth.token]

  const redact = (text: string): string => {
    let result = text
    for (const secret of secrets) if (secret) result = result.split(secret).join('[REDACTED]')
    return result
  }

  const headers = (): Record<string, string> => {
    const base = { 'Content-Type': 'application/json' }
    if (config.auth.type === 'api-key') return { ...base, 'Client-Id': config.auth.clientId, 'Api-Key': config.auth.apiKey }
    return { ...base, Authorization: `Bearer ${config.auth.token}` }
  }

  const parseUpstreamError = (status: number, text: string): OzonApiError => {
    let ozonCode: number | null = null
    let message = `HTTP ${status}`
    try {
      const parsed = JSON.parse(text) as { code?: unknown; message?: unknown }
      if (typeof parsed.code === 'number') ozonCode = parsed.code
      if (typeof parsed.message === 'string' && parsed.message) message = parsed.message
    } catch { /* Non-JSON upstream bodies keep the generic message. */ }
    return new OzonApiError(status, ozonCode, redact(message))
  }

  async function call(path: string, body: unknown, kind: 'read' | 'mutating'): Promise<unknown> {
    if (kind === 'mutating' && !config.allowMutations) throw new OzonMutationDisabledError()
    const payload = JSON.stringify(body)
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.timeoutMs)
      try {
        const url = `${config.baseUrl}${path}`
        let requestHeaders = headers()
        let response = await fetchImpl(url, {
          method: 'POST', headers: requestHeaders, body: payload, signal: controller.signal, redirect: 'manual',
        })
        if (response.status === 302 || response.status === 307) {
          const location = response.headers.get('location')
          const setCookie = response.headers.get('set-cookie')
          if (!location || !setCookie) throw new OzonApiError(response.status, null, 'OZON_REDIRECT_INVALID')
          const next = new URL(location, url)
          const origin = new URL(config.baseUrl).origin
          if (next.origin !== origin) throw new OzonApiError(response.status, null, 'OZON_REDIRECT_ORIGIN_REJECTED')
          const cookie = setCookie.split(';', 1)[0]
          requestHeaders = { ...requestHeaders, Cookie: cookie }
          response = await fetchImpl(next.toString(), {
            method: 'POST', headers: requestHeaders, body: payload, signal: controller.signal, redirect: 'manual',
          })
          if (response.status === 302 || response.status === 307) throw new OzonApiError(response.status, null, 'OZON_REDIRECT_LOOP')
        }
        if ((response.status === 429 || response.status >= 500) && attempt < config.maxAttempts) {
          logger?.(`ozon ${path} http=${response.status} attempt=${attempt} retry`)
          await delay(config.retryBaseMs * 2 ** (attempt - 1))
          continue
        }
        const text = await response.text()
        if (!response.ok) throw parseUpstreamError(response.status, text)
        try {
          return text ? JSON.parse(text) : {}
        } catch {
          throw new OzonApiError(response.status, null, 'OZON_INVALID_RESPONSE')
        }
      } catch (error) {
        if (error instanceof OzonApiError) throw error
        const timedOut = controller.signal.aborted
        const retryNetwork = kind === 'read' && attempt < config.maxAttempts
        logger?.(`ozon ${path} ${timedOut ? 'timeout' : 'network-error'} attempt=${attempt}${retryNetwork ? ' retry' : ''}`)
        if (!retryNetwork) throw new OzonApiError(0, null, timedOut ? 'OZON_REQUEST_TIMEOUT' : 'OZON_NETWORK_ERROR')
        await delay(config.retryBaseMs * 2 ** (attempt - 1))
      } finally {
        clearTimeout(timer)
      }
    }
    throw new OzonApiError(0, null, 'OZON_NETWORK_ERROR')
  }

  return {
    /** Ozon Delivery section: check whether Ozon delivery is available for a buyer phone. */
    checkDelivery(clientPhone: string): Promise<unknown> {
      return call('/v1/delivery/check', { client_phone: clientPhone }, 'read')
    },
    /** Ozon Delivery section: delivery variants, timeslots and availability for a cart. */
    getDeliveryVariants(request: DeliveryVariantRequest): Promise<unknown> {
      return call('/v2/delivery/checkout', request, 'read')
    },
    /** Ozon Delivery section: all pickup points (coordinates and map point ids only). */
    getPickupPoints(cursor: string | null = null, limit = 100): Promise<unknown> {
      return call('/v1/delivery-point/list', { pagination: { cursor, limit } }, 'read')
    },
    /** Detailed pickup-point metadata for up to 100 point ids. */
    getPickupPointInfo(deliveryPointIds: number[]): Promise<unknown> {
      return call('/v1/delivery-point/info', { delivery_point_ids: deliveryPointIds }, 'read')
    },
    /** Marketplace posting status reads shared by the Ozon Delivery order flow. */
    listFboPostings(filter: PostingListFilter): Promise<unknown> {
      return call('/v2/posting/fbo/list', { dir: 'ASC', filter: { since: filter.since, to: filter.to }, limit: 100 }, 'read')
    },
    listFbsPostings(filter: PostingListFilter): Promise<unknown> {
      return call('/v3/posting/fbs/list', { dir: 'ASC', filter: { since: filter.since, to: filter.to }, limit: 100 }, 'read')
    },
    /** Ozon Delivery for Business: side-effect-free checkout quote for a prepared parcel/order. */
    checkoutOrder(request: unknown): Promise<unknown> {
      return call('/v1/order/checkout', request, 'read')
    },
    /** Ozon Delivery for Business: posting details and status history. */
    getPostingInfo(request: unknown): Promise<unknown> {
      return call('/v1/posting/info', request, 'read')
    },
    getPostingStatusHistory(request: unknown): Promise<unknown> {
      return call('/v1/posting/status-history', request, 'read')
    },
    /** Ozon Delivery order creation. Refused by default; never exposed over HTTP. */
    createOrder(request: unknown): Promise<unknown> {
      return call('/v1/order/create', request, 'mutating')
    },
  }
}

export type OzonClient = ReturnType<typeof createOzonClient>
export type { OzonAuthConfig, OzonClientConfig }
