'use client'

import Link from 'next/link'
import { useState } from 'react'
import { addLine } from '../src/cart/storage'
import type { CatalogProduct } from '../src/catalog/contracts'
import { productPayload, trackEvent } from '../src/integrations/analytics'

export function AddToCartButton({ product }: { product: CatalogProduct }) {
  const sku = product.trade.sku
  const [added, setAdded] = useState(false)

  return (
    <div className="addToCart">
      <button
        type="button"
        className="buyButton"
        onClick={() => {
          addLine(sku)
          trackEvent('add_to_cart', { ...productPayload(product), quantity: 1 })
          setAdded(true)
        }}
      >
        {added ? 'Добавлено в корзину' : 'Добавить в корзину'}
      </button>
      {added && <Link className="textLink" href="/cart">Перейти в корзину →</Link>}
    </div>
  )
}
