'use client'

import { useEffect, useState } from 'react'
import type { PaidCartOutcome } from '../src/cart/storage'
import { applyConfirmedPaymentResult, verifiedPaidOrder } from '../src/cart/confirmedPayment'

export function PaymentSuccessTracker({ requestId }: { requestId: string }) {
  const [result, setResult] = useState<{ requestId: string; outcome: PaidCartOutcome | null } | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    let running = false
    let finished = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const check = async () => {
      if (cancelled || running || finished) return
      if (timer) clearTimeout(timer)
      running = true
      attempts += 1
      let complete = false
      try {
        const response = await fetch(`/api/payments/ozon/status?requestId=${encodeURIComponent(requestId)}`, { cache: 'no-store' })
        if (response.ok && !cancelled) {
          const order = verifiedPaidOrder(await response.json(), requestId)
          if (order && !cancelled) {
            setResult((previous) => previous?.requestId === requestId ? previous : { requestId, outcome: null })
            const outcome = await applyConfirmedPaymentResult(order)
            if (!cancelled) setResult({ requestId, outcome })
            complete = outcome !== 'storage-failure'
            finished = complete
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
  }, [requestId, retry])
  const paid = result?.requestId === requestId
  const outcome = paid ? result.outcome : null
  const manual = outcome === 'missing-receipt' || outcome === 'receipt-mismatch'
  return <>
    <p role="status">{!paid
      ? 'Проверяем подтверждение оплаты. Повторно оплачивать заказ не нужно.'
      : manual
        ? 'Оплата подтверждена. Не удалось сверить корзину с покупкой. Проверьте корзину и удалите купленные товары вручную. Повторно оплачивать заказ не нужно.'
        : outcome === 'storage-failure'
          ? 'Оплата подтверждена. Хранилище браузера недоступно. Повторите обновление корзины или удалите купленные товары вручную. Новый заказ создавать и повторно оплачивать не нужно.'
          : outcome === null
            ? 'Оплата подтверждена. Проверяем корзину.'
            : 'Оплата подтверждена. Корзина сверена с покупкой; новые товары сохранены. Спасибо за заказ.'}</p>
    {paid && outcome === 'storage-failure' && <button type="button" onClick={() => setRetry((value) => value + 1)}>Повторить обновление корзины</button>}
  </>
}
