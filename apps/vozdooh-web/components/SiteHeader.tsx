import Link from 'next/link'
import { BrandLogo } from './BrandLogo'

export function SiteHeader() {
  return (
    <header className="header">
      <BrandLogo />
      <nav aria-label="Основная навигация">
        <Link href="/catalog">Каталог</Link>
        <Link href="/finder">Подобрать аромат</Link>
        <Link href="/brands">Бренды</Link>
        <Link href="/#about">О нас</Link>
      </nav>
      <div className="actions">
        <Link href="/catalog">Поиск</Link>
        <span>Корзина · 0</span>
      </div>
    </header>
  )
}
