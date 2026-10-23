/** Future confirmed-order and payment adapter contracts.
 * Order requests use orderRequests.ts and never invoke these adapters.
 * No payment gateway or 1C order adapter is configured.
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

/** Legacy draft shape reserved for future confirmed-order adapters. */
export type CheckoutDraft = {
  lines: CartLine[]
  contact: CheckoutContact
  delivery: CheckoutDelivery
}
