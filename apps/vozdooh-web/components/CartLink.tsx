'use client'

import Link from 'next/link'
import { CartPaymentSync } from './CartPaymentSync'
import { useSyncExternalStore } from 'react'
import { cartItemCount, getCartSnapshot, getServerCartSnapshot, subscribeCart } from '../src/cart/storage'

export function CartLink() {
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)
  const count = cartItemCount(cart)

  return (
    <>
    <CartPaymentSync />
    <Link className="cartLink" href="/cart" aria-label={`Корзина, товаров: ${count}`}>
      <span>Корзина</span>
      <b>{count}</b>
    </Link>
    </>
  )
}
