'use client'

import { useEffect, useState } from 'react'
import { applyConfirmedPayment, verifiedPaidOrder } from '../src/cart/confirmedPayment'

export function PaymentSuccessTracker({ requestId }: { requestId: string }) {
  const [paidRequestId, setPaidRequestId] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    let running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const check = async () => {
      if (cancelled || running) return
      if (timer) clearTimeout(timer)
      running = true
      attempts += 1
      let complete = false
      try {
        const response = await fetch(`/api/payments/ozon/status?requestId=${encodeURIComponent(requestId)}`, { cache: 'no-store' })
        if (response.ok && !cancelled) {
          const order = verifiedPaidOrder(await response.json(), requestId)
          if (order && !cancelled) {
            setPaidRequestId(requestId)
            complete = await applyConfirmedPayment(order)
          }
        }
      } catch { /* Retry transient network/storage failures without changing the cart. */ }
      running = false
      if (!cancelled && !complete) timer = setTimeout(check, attempts < 24 ? 2500 : 30000)
    }
    const resume = () => { if (document.visibilityState === 'visible') void check() }
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    void check()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [requestId])
  return <p role="status">{paidRequestId === requestId ? 'Оплата подтверждена. Спасибо за заказ.' : 'Проверяем подтверждение оплаты. Статус обновится автоматически; повторно оплачивать заказ не нужно.'}</p>
}
