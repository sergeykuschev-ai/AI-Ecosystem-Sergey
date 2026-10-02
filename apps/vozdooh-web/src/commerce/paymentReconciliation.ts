import type { OrderRequestStore } from './orderRequests'
import { getOzonOrderDetails } from './ozonAcquiring'
import { queueOrderMail } from './orderMail'

export type PaymentReconciliationResult =
  | { state: 'not_found' }
  | { state: 'no_payment' }
  | { state: 'pending'; providerStatus: string | null }
  | { state: 'paid'; changed: boolean }

type DetailsFetcher = (input: { id: string; extId: string }) => Promise<{ status: unknown }>

export async function reconcileOzonPayment(
  requestId: string,
  store: OrderRequestStore,
  detailsFetcher: DetailsFetcher = getOzonOrderDetails,
): Promise<PaymentReconciliationResult> {
  const order = await store.findById(requestId)
  if (!order) return { state: 'not_found' }
  if (!order.payment) return { state: 'no_payment' }

  if (order.payment.status === 'PAID') {
    await queueOrderMail(order, 'payment_confirmed')
    return { state: 'paid', changed: false }
  }

  const details = await detailsFetcher({ id: order.payment.paymentId, extId: order.payment.extId })
  const providerStatus = typeof details.status === 'string' ? details.status : null
  if (providerStatus !== 'STATUS_PAID') return { state: 'pending', providerStatus }

  const current = await store.findById(requestId)
  if (!current?.payment) return { state: current ? 'no_payment' : 'not_found' }
  if (current.payment.status === 'PAID') {
    await queueOrderMail(current, 'payment_confirmed')
    return { state: 'paid', changed: false }
  }

  const paid = {
    ...current,
    payment: {
      ...current.payment,
      status: 'PAID' as const,
      paidAt: new Date().toISOString(),
    },
  }
  const saved = await store.replace(paid)
  await queueOrderMail(saved, 'payment_confirmed')
  return { state: 'paid', changed: true }
}
