import type { OrderRequest } from './orderRequests'

export type PublicPaymentStatus =
  | { state: 'no_payment' }
  | { state: 'pending' }
  | { state: 'paid'; order: { id: string; totalMinor: number; currency: 'RUB'; items: { id: string; name: string; priceMinor: number; quantity: number }[] } }

/** Customer-safe payment state used by the success page. Never expose contact or delivery data. */
export function publicPaymentStatus(order: OrderRequest): PublicPaymentStatus {
  if (!order.payment) return { state: 'no_payment' }
  if (order.payment.status !== 'PAID') return { state: 'pending' }
  return {
    state: 'paid',
    order: {
      id: order.id,
      totalMinor: order.totalMinor,
      currency: order.currency,
      items: order.lines.map((line) => ({ id: line.sku, name: line.name, priceMinor: line.unitPriceMinor, quantity: line.quantity })),
    },
  }
}
