'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import type { CatalogProduct } from '../src/catalog/contracts'
import { trackEvent } from '../src/integrations/analytics'
import { ProductCard } from './ProductCard'

/** Count actual section visibility once; no customer or order data. */
export function MerchSection({ id, title, description, products }: { id: string; title: string; description: string; products: CatalogProduct[] }) {
  const element = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!element.current || !products.length || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        trackEvent('view_merch_section', { section_id: id })
        observer.disconnect()
      }
    }, { threshold: 0.15 })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [id, products.length])
  if (!products.length) return null
  return (
    <section ref={element} id={id} className="section sectionWhite" aria-labelledby={`${id}-title`}>
      <div className="sectionHead"><div><span className="eyebrow">Из актуального наличия</span><h2 id={`${id}-title`}>{title}</h2></div><p>{description}</p></div>
      <div className="products">{products.map((product, index) => <ProductCard key={product.trade.sku} product={product} index={index} merchSection={id} />)}</div>
      <Link className="textLink" href="/collections/popular">Все популярные ароматы →</Link>
    </section>
  )
}
