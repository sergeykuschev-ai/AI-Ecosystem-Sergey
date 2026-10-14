import Link from 'next/link'
import type { CatalogProduct } from '../src/catalog/contracts'
import { contextualCatalogLinks } from '../src/catalog/contextualLinks'

export function ContextualCatalogLinks({ products, currentPath }: { products: readonly CatalogProduct[]; currentPath: string }) {
  const { sections, examples } = contextualCatalogLinks(products, currentPath)
  if (!sections.length && !examples.length) return null
  if (currentPath === '/') {
    return <section className="landingGuide landingGuideHome" aria-label="Дополнительные направления каталога">
      <details className="landingGuideDetails">
        <summary>Ещё больше ароматов и подборок <span aria-hidden="true">＋</span></summary>
        <div className="landingGuideDetailsContent">
          {sections.length > 0 && <nav className="landingLinks" aria-label="Бренды и подборки">{sections.map(item => <Link href={item.href} key={item.href}>{item.label}</Link>)}</nav>}
          {examples.length > 0 && <nav className="landingLinks landingExamples" aria-label="Ароматы из наличия">{examples.map(item => <Link href={item.href} key={item.href}>{item.label}</Link>)}</nav>}
        </div>
      </details>
    </section>
  }
  return <section className="landingGuide" aria-label="Выбор из наличия">
    <h2>{currentPath === '/' ? 'Выберите аромат для дома или в подарок' : 'Продолжить выбор аромата'}</h2>
    <p>Сравните бренды и форматы из наличия. Для подарка начните с диффузоров, а для знакомства с ассортиментом откройте <Link className="textLink" href="/catalog">каталог VOZDOOH</Link>.</p>
    {sections.length > 0 && <nav className="landingLinks" aria-label="Бренды, форматы и подборки из наличия">{sections.map(item => <Link href={item.href} key={item.href}>{item.label}</Link>)}</nav>}
    {examples.length > 0 && <><p>В карточках можно сравнить объём, цену и доступные характеристики:</p><nav className="landingLinks" aria-label="Примеры товаров из наличия">{examples.map(item => <Link href={item.href} key={item.href}>{item.label}</Link>)}</nav></>}
    <Link className="textLink" href="/">На главную VOZDOOH →</Link>
  </section>
}
