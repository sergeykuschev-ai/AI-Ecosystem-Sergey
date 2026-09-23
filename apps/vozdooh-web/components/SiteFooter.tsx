import Link from 'next/link'

export function SiteFooter() {
  return (
    <footer>
      <Link className="footerLogo" href="/">VOZDOOH</Link>
      <nav aria-label="Нижняя навигация">
        <Link href="/catalog">Каталог</Link>
        <Link href="/finder">Подбор аромата</Link>
        <Link href="/brands">Бренды</Link>
        <Link href="/collections">Коллекции</Link>
        <Link href="/cart">Корзина</Link>
      </nav>
      <div className="footerNote">
        <p>© 2026 VOZDOOH</p>
        <p>Искусство атмосферы. Парфюмерия для дома.</p>
      </div>
    </footer>
  )
}
