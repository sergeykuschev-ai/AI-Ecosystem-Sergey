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
