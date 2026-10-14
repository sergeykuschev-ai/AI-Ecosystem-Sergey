'use client'

import { useEffect } from 'react'
import { reconcilePendingPaidCart } from '../src/cart/paymentRecovery'

/** Recheck already-created order receipts if the user returns from payment
 * straight to catalog/cart, closes the provider tab or restores Safari later.
 */
export function CartPaymentSync() {
  useEffect(() => {
    let running = false
    const check = async () => {
      if (running || document.visibilityState === 'hidden') return
      running = true
      try { await reconcilePendingPaidCart() } finally { running = false }
    }
    const resume = () => { void check() }
    void check()
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    const interval = window.setInterval(resume, 30000)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])
  return null
}
