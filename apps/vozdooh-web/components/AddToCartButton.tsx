'use client'

import Link from 'next/link'
import { useState } from 'react'
import { addLine } from '../src/cart/storage'

export function AddToCartButton({ sku }: { sku: string }) {
  const [added, setAdded] = useState(false)

  return (
    <div className="addToCart">
      <button
        type="button"
        className="buyButton"
        onClick={() => {
          addLine(sku)
          setAdded(true)
        }}
      >
        {added ? 'Добавлено в корзину' : 'Добавить в корзину'}
      </button>
      {added && <Link className="textLink" href="/cart">Перейти в корзину →</Link>}
    </div>
  )
}
