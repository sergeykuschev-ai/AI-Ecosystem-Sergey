import { randomUUID } from 'node:crypto'
import type { OrderRequestStore } from './orderRequests'
import { createOzonOrder } from './ozonAcquiring'

export class PaymentError extends Error {
  constructor(public code: string, public status = 422) { super(code) }
}

export async function beginOzonPayment(
  requestId: string,
  store: OrderRequestStore,
  createPayment = createOzonOrder,
  ensureFreshInventory?: () => Promise<void>,
) {
  const request = await store.findById(requestId)
  if (!request) throw new PaymentError('REQUEST_NOT_FOUND', 404)
  if (request.payment && !request.payment.redirectUrl.includes('qr.nspk.ru')) return { paymentId: request.payment.paymentId, redirectUrl: request.payment.redirectUrl }
  if (ensureFreshInventory) await ensureFreshInventory()
  const extId = randomUUID()
  const result = await createPayment({ extId, amountMinor: request.totalMinor, items: request.lines.map(line => ({ extId: line.sku, name: line.name, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor })), successUrl: `https://vozdooh27.ru/checkout/success?requestId=${encodeURIComponent(request.id)}`, failUrl: `https://vozdooh27.ru/checkout/fail?requestId=${encodeURIComponent(request.id)}`, notificationUrl: 'https://vozdooh27.ru/api/payments/ozon/notification' })
  const updated = { ...request, payment: { provider: 'ozon' as const, paymentId: result.paymentId, extId, redirectUrl: result.redirectUrl, createdAt: new Date().toISOString(), status: 'PAYMENT_NEW' as const } }
  await store.replace(updated)
  return { paymentId: result.paymentId, redirectUrl: result.redirectUrl }
}
