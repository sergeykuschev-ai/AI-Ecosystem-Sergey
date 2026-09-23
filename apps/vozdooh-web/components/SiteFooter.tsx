import Image from 'next/image'
import Link from 'next/link'

export function SiteFooter() {
  return (
    <footer>
      <Link className="footerLogo" href="/" aria-label="VOZDOOH — на главную">
        <Image src="/brand/vozdooh-horizontal.webp" alt="VOZDOOH" width={900} height={118} />
      </Link>
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
