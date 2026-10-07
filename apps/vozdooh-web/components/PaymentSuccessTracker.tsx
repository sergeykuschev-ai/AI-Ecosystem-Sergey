 'use client'

import { useEffect } from 'react'
import { trackPurchase } from '../src/integrations/analytics'

type PaidResponse = {
  state: 'paid'
  order: {
    id: string
    totalMinor: number
    currency: 'RUB'
    items: { id: string; name: string; priceMinor: number; quantity: number }[]
  }
}

export function PaymentSuccessTracker({ requestId }: { requestId: string }) {
  useEffect(() => {
    const storageKey = `vozdooh-purchase-tracked:${requestId}`
    try { if (localStorage.getItem(storageKey) === '1') return } catch { /* storage may be unavailable */ }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const check = async () => {
      attempts += 1
      try {
        const response = await fetch(`/api/payments/ozon/status?requestId=${encodeURIComponent(requestId)}`, { cache: 'no-store' })
        if (response.ok) {
          const data = await response.json() as { state?: unknown } | PaidResponse
          if (data.state === 'paid' && 'order' in data && !cancelled) {
            const order = data.order
            trackPurchase({
              id: order.id,
              revenue: order.totalMinor / 100,
              items: order.items.map((item) => ({ id: item.id, name: item.name, price: item.priceMinor / 100, quantity: item.quantity })),
            })
            try { localStorage.setItem(storageKey, '1') } catch { /* analytics still sent */ }
            return
          }
        }
      } catch { /* page remains usable; worker may still be reconciling */ }
      if (!cancelled && attempts < 24) timer = setTimeout(check, 2500)
    }

    void check()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [requestId])
  return null
}
