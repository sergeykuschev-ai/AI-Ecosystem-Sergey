'use client'

import { pendingPaymentRequestIds } from './storage'
import { applyConfirmedPayment, verifiedPaidOrder } from './confirmedPayment'

/** Reconcile only locally bound receipts against the server-verified paid state.
 * A redirect, order submission or an unverified status cannot delete cart lines.
 */
export async function reconcilePendingPaidCart(
  fetchStatus: typeof fetch = fetch,
): Promise<number> {
  let cleaned = 0
  for (const requestId of pendingPaymentRequestIds()) {
    try {
      const response = await fetchStatus(`/api/payments/ozon/status?requestId=${encodeURIComponent(requestId)}`, { cache: 'no-store' })
      if (!response.ok) continue
      const paid = verifiedPaidOrder(await response.json(), requestId)
      if (paid && await applyConfirmedPayment(paid)) cleaned += 1
    } catch { /* Retry at next visibility/focus/poll; never alter unpaid cart. */ }
  }
  return cleaned
}
