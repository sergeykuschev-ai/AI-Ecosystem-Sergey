import Link from 'next/link'
import { BrandLogo } from './BrandLogo'
import { CartLink } from './CartLink'

export function SiteHeader() {
  return (
    <header className="header">
      <BrandLogo />
      <nav aria-label="Основная навигация">
        <Link href="/catalog">Каталог</Link>
        <Link href="/finder">Подобрать аромат</Link>
        <Link href="/brands">Бренды</Link>
        <Link href="/collections">Коллекции</Link>
        <Link href="/#about">О нас</Link>
      </nav>
      <div className="actions">
        <CartLink />
      </div>
    </header>
  )
}
