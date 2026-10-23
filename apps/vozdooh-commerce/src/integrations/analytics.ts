/**
 * Analytics readiness layer for VOZDOOH.
 *
 * Yandex Metrica loads only when NEXT_PUBLIC_YANDEX_METRICA_ID is configured.
 * Ecommerce events use the official window.dataLayer format and never include
 * personal contact/order fields.
 */

export type AnalyticsEvent =
  | 'view_merch_section'
  | 'select_merch_item'
  | 'view_item'
  | 'select_item'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'view_cart'
  | 'begin_checkout'
  | 'submit_order'
  | 'purchase'
  | 'view_brand'
  | 'view_collection'
  | 'filter_use'
  | 'scent_finder'

export type AnalyticsParams = Record<string, unknown>
type PendingEvent = { event: AnalyticsEvent; params: AnalyticsParams; paidRevenue?: number }
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
    ym?: (id: number, method: string, data?: unknown, params?: unknown) => void
    dataLayer?: unknown[]
    __vozdoohAnalyticsId?: number
    __vozdoohAnalyticsPending?: PendingEvent[]
    __vozdoohAnalyticsPathname?: string
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

/** Only pathnames from usePathname; never queue hits while the counter is disabled. */
export function trackPathname(pathname: string | null): void {
  if (!analyticsEnabled() || !pathname || !pathname.startsWith('/') || pathname.startsWith('//') || /[?#]/.test(pathname)) return
  const previous = window.__vozdoohAnalyticsPathname
  if (previous === pathname) return
  window.__vozdoohAnalyticsPathname = pathname
  if (previous !== undefined) window.ym!(window.__vozdoohAnalyticsId!, 'hit', pathname)
}

function dispatchEvent(event: AnalyticsEvent, params: AnalyticsParams, paidRevenue?: number): void {
  if (!analyticsEnabled()) return
  window.ym!(window.__vozdoohAnalyticsId!, 'params', { event, ...params })
  pushEcommerce(event, params)
  if (process.env.NEXT_PUBLIC_METRICA_GOALS_ENABLED !== 'true') return
  const goal = event === 'add_to_cart' ? 'vz_add_to_cart'
    : event === 'begin_checkout' ? 'vz_begin_checkout'
    : event === 'submit_order' ? 'vz_submit_order'
    : event === 'purchase' && paidRevenue !== undefined && Number.isFinite(paidRevenue) && paidRevenue > 0 ? 'vz_paid_purchase' : null
  if (!goal) return
  if (goal === 'vz_paid_purchase') {
    window.ym!(window.__vozdoohAnalyticsId!, 'reachGoal', goal, { order_price: paidRevenue, currency: 'RUB' })
  } else {
    window.ym!(window.__vozdoohAnalyticsId!, 'reachGoal', goal)
  }
}

export function flushPendingEvents(): void {
  if (!analyticsEnabled()) return
  const pending = window.__vozdoohAnalyticsPending?.splice(0) ?? []
  for (const item of pending) dispatchEvent(item.event, item.params, item.paidRevenue)
}

export function trackEvent(event: AnalyticsEvent, params: AnalyticsParams = {}): void {
  if (typeof window === 'undefined') return
  if (event === 'view_merch_section' || event === 'select_merch_item') {
    params = { section_id: stringValue(params.section_id), ...(event === 'select_merch_item' ? { item_id: stringValue(params.item_id) } : {}) }
    if (!params.section_id || (event === 'select_merch_item' && !params.item_id)) return
    if (!window.__vozdoohAnalyticsId && !process.env.NEXT_PUBLIC_YANDEX_METRICA_ID) return
  }
  if (!analyticsEnabled()) {
    ;(window.__vozdoohAnalyticsPending ??= []).push({ event, params })
    return
  }
  dispatchEvent(event, params)
}


export type PurchaseItem = {
  id: string
  name: string
  price: number
  quantity: number
}

/** Sends a provider-confirmed paid order to Yandex ecommerce. No customer data is included. */
export function trackPurchase(input: { id: string; revenue: number; items: PurchaseItem[] }): void {
  if (typeof window === 'undefined') return
  if (!input.id || !Number.isFinite(input.revenue) || input.revenue <= 0 || input.items.length === 0) return
  window.dataLayer ??= []
  window.dataLayer.push({
    ecommerce: {
      currencyCode: 'RUB',
      purchase: {
        actionField: { id: input.id, revenue: input.revenue },
        products: input.items.map((item) => ({ id: item.id, name: item.name, price: item.price, quantity: item.quantity })),
      },
    },
  })
  const params = { transaction_id: input.id, value: input.revenue, currency: 'RUB' }
  if (!analyticsEnabled()) {
    ;(window.__vozdoohAnalyticsPending ??= []).push({ event: 'purchase', params, paidRevenue: input.revenue })
  } else {
    dispatchEvent('purchase', params, input.revenue)
  }
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
