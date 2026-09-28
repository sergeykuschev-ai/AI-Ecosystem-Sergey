/**
 * Analytics readiness layer for VOZDOOH.
 *
 * Yandex Metrica loads only when NEXT_PUBLIC_YANDEX_METRICA_ID is configured;
 * no counter ID is hard-coded. Until then every hook below is a safe no-op.
 * Never attach personal data (names, phones, addresses) to events.
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

declare global {
  interface Window {
    ym?: (id: number, method: string, data?: unknown) => void
    __vozdoohAnalyticsId?: number
  }
}

export function analyticsEnabled(): boolean {
  return typeof window !== 'undefined' && typeof window.__vozdoohAnalyticsId === 'number'
}

export function trackEvent(event: AnalyticsEvent, params: Record<string, unknown> = {}): void {
  if (!analyticsEnabled()) return
  window.ym!(window.__vozdoohAnalyticsId!, 'params', { event, ...params })
}

/** Product-scoped payload limited to non-personal catalog facts. */
export function productPayload(product: {
  trade: { sku: string; brand: string | null; category: string; price: number | null }
  editorial: { slug: string }
}): Record<string, unknown> {
  return {
    item_id: product.trade.sku,
    item_brand: product.trade.brand,
    item_category: product.trade.category,
    price: product.trade.price,
    slug: product.editorial.slug,
  }
}
