'use client'

import { removePaidCartItems } from './storage'
import { trackPurchase } from '../integrations/analytics'

export type PaidOrder = {
  id: string
  totalMinor: number
  currency: 'RUB'
  items: { id: string; name: string; priceMinor: number; quantity: number }[]
}

const trackedInMemory = new Set<string>()

function alreadyTracked(key: string): boolean {
  if (trackedInMemory.has(key)) return true
  for (const storage of ['localStorage', 'sessionStorage'] as const) {
    try { if (window[storage].getItem(key) === '1') return true } catch { /* Try the other store. */ }
  }
  return false
}

/** Neither a redirect nor submission is proof of payment. Validate the status contract. */
export function verifiedPaidOrder(data: unknown, requestId: string): PaidOrder | null {
  if (!data || typeof data !== 'object' || !('state' in data) || data.state !== 'paid' || !('order' in data)) return null
  const order = data.order as PaidOrder | undefined
  if (!order || order.id !== requestId || order.currency !== 'RUB' || !Number.isSafeInteger(order.totalMinor) || order.totalMinor <= 0 || !Array.isArray(order.items) || !order.items.length) return null
  if (!order.items.every((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && Number.isSafeInteger(item.priceMinor) && item.priceMinor > 0 && Number.isSafeInteger(item.quantity) && item.quantity > 0)) return null
  if (new Set(order.items.map((item) => item.id)).size !== order.items.length || order.items.reduce((sum, item) => sum + item.priceMinor * item.quantity, 0) !== order.totalMinor) return null
  return order
}

export async function applyConfirmedPayment(order: PaidOrder): Promise<boolean> {
  const apply = () => {
    let cleaned = false
    try { cleaned = removePaidCartItems(order.id, order.items) } catch { /* Retry cleanup; analytics has an independent receipt. */ }
    const key = `vozdooh-purchase-tracked:${order.id}`
    if (!alreadyTracked(key)) {
      trackPurchase({ id: order.id, revenue: order.totalMinor / 100, items: order.items.map((item) => ({ id: item.id, name: item.name, price: item.priceMinor / 100, quantity: item.quantity })) })
      trackedInMemory.add(key)
      for (const storage of ['localStorage', 'sessionStorage'] as const) {
        try { window[storage].setItem(key, '1') } catch { /* Memory still prevents duplicates in this document. */ }
      }
    }
    return cleaned
  }
  // Serialize success callbacks across tabs. The receipt lives with the cart,
  // so a failed write cannot mark an unapplied cleanup as complete.
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('vozdooh-paid-cart', apply)
  return apply()
}
