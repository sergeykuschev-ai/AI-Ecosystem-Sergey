'use client'

import Link from 'next/link'
import { useSyncExternalStore } from 'react'
import { cartItemCount, getCartSnapshot, getServerCartSnapshot, subscribeCart } from '../src/cart/storage'

export function CartLink() {
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)
  const count = cartItemCount(cart)

  return (
    <Link className="cartLink" href="/cart">
      Корзина · {count}
    </Link>
  )
}
