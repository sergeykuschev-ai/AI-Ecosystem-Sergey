/**
 * Analytics readiness layer for VOZDOOH.
 *
 * Yandex Metrica loads only when NEXT_PUBLIC_YANDEX_METRICA_ID is configured.
 * Ecommerce events use the official window.dataLayer format and never include
 * personal contact/order fields.
 */

export type AnalyticsEvent =
  | 'view_item'
  | 'select_item'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'view_cart'
  | 'begin_checkout'
  | 'submit_order'
  | 'view_brand'
  | 'view_collection'
  | 'filter_use'
  | 'scent_finder'

export type AnalyticsParams = Record<string, unknown>
type PendingEvent = { event: AnalyticsEvent; params: AnalyticsParams }
type EcommerceProduct = {
  id?: string
  name?: string
  brand?: string
  category?: string
  price?: number
  quantity?: number
}

declare global {
  interface Window {
    ym?: (id: number, method: string, data?: unknown) => void
    dataLayer?: unknown[]
    __vozdoohAnalyticsId?: number
    __vozdoohAnalyticsPending?: PendingEvent[]
  }
}

export function analyticsEnabled(): boolean {
  return typeof window !== 'undefined' && typeof window.__vozdoohAnalyticsId === 'number' && typeof window.ym === 'function'
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function ecommerceProduct(params: AnalyticsParams): EcommerceProduct | null {
  const product: EcommerceProduct = {
    id: stringValue(params.item_id),
    name: stringValue(params.item_name),
    brand: stringValue(params.item_brand),
    category: stringValue(params.item_category),
    price: numberValue(params.price),
    quantity: numberValue(params.quantity),
  }
  if (!product.id && !product.name) return null
  return Object.fromEntries(Object.entries(product).filter(([, value]) => value !== undefined)) as EcommerceProduct
}

function pushEcommerce(event: AnalyticsEvent, params: AnalyticsParams): void {
  const product = ecommerceProduct(params)
  if (!product || typeof window === 'undefined') return
  const action = event === 'view_item' ? 'detail' : event === 'add_to_cart' ? 'add' : event === 'remove_from_cart' ? 'remove' : null
  if (!action) return
  window.dataLayer ??= []
  window.dataLayer.push({ ecommerce: { currencyCode: 'RUB', [action]: { products: [product] } } })
}

function dispatchEvent(event: AnalyticsEvent, params: AnalyticsParams): void {
  if (!analyticsEnabled()) return
  window.ym!(window.__vozdoohAnalyticsId!, 'params', { event, ...params })
  pushEcommerce(event, params)
}

export function flushPendingEvents(): void {
  if (!analyticsEnabled()) return
  const pending = window.__vozdoohAnalyticsPending?.splice(0) ?? []
  for (const item of pending) dispatchEvent(item.event, item.params)
}

export function trackEvent(event: AnalyticsEvent, params: AnalyticsParams = {}): void {
  if (typeof window === 'undefined') return
  if (!analyticsEnabled()) {
    ;(window.__vozdoohAnalyticsPending ??= []).push({ event, params })
    return
  }
  dispatchEvent(event, params)
}

/** Product-scoped payload limited to non-personal catalog facts. */
export function productPayload(product: {
  trade: { sku: string; name?: string; brand: string | null; category: string; price: number | null }
  editorial: { slug: string }
}): Record<string, unknown> {
  return {
    item_id: product.trade.sku,
    ...(product.trade.name ? { item_name: product.trade.name } : {}),
    item_brand: product.trade.brand,
    item_category: product.trade.category,
    price: product.trade.price,
    slug: product.editorial.slug,
  }
}
