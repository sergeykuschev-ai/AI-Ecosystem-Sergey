/**
 * Commerce domain contracts.
 *
 * Pre-1C boundary: the checkout UI collects a CheckoutDraft, but there is
 * deliberately NO demo implementation of OrderService or PaymentGateway and
 * no API route that accepts orders. Order creation and payment become real
 * only after the 1C stock/order boundary and a confirmed payment provider
 * are connected. Never submit fake orders or fake payments from the UI.
 */

export type Money = {
  amountMinor: number
  currency: 'RUB'
}

export type CartLine = {
  sku: string
  quantity: number
}

export type OrderDraft = {
  lines: CartLine[]
  customerId?: string
}

export interface OrderService {
  create(draft: OrderDraft): Promise<{ orderId: string }>
}

export interface PaymentGateway {
  createPayment(orderId: string, amount: Money): Promise<{ paymentId: string; redirectUrl?: string }>
}

export type CheckoutContact = {
  name: string
  phone: string
  email: string
}

export type CheckoutDelivery = {
  method: 'pickup' | 'courier'
  address: string
  comment: string
}

/** Data the checkout form assembles. Held client-side only until ordering opens. */
export type CheckoutDraft = {
  lines: CartLine[]
  contact: CheckoutContact
  delivery: CheckoutDelivery
}
