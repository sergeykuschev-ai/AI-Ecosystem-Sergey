'use client'

import Link from 'next/link'
import { useState } from 'react'
import { addLine } from '../src/cart/storage'
import { trackEvent } from '../src/integrations/analytics'

export function AddToCartButton({ sku }: { sku: string }) {
  const [added, setAdded] = useState(false)

  return (
    <div className="addToCart">
      <button
        type="button"
        className="buyButton"
        onClick={() => {
          addLine(sku)
          trackEvent('add_to_cart', { item_id: sku, quantity: 1 })
          setAdded(true)
        }}
      >
        {added ? 'Добавлено в корзину' : 'Добавить в корзину'}
      </button>
      {added && <Link className="textLink" href="/cart">Перейти в корзину →</Link>}
    </div>
  )
}
