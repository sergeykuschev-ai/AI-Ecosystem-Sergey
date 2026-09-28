import Image from 'next/image'
import Link from 'next/link'

const shopLinks = [
  { href: '/catalog', label: 'Каталог' },
  { href: '/finder', label: 'Подбор аромата' },
  { href: '/brands', label: 'Бренды' },
  { href: '/collections', label: 'Коллекции' },
  { href: '/cart', label: 'Корзина' },
]

const infoLinks = [
  { href: '/delivery', label: 'Доставка' },
  { href: '/payment', label: 'Оплата' },
  { href: '/returns', label: 'Возврат' },
  { href: '/contacts', label: 'Контакты' },
  { href: '/privacy', label: 'Конфиденциальность' },
  { href: '/offer', label: 'Оферта' },
  { href: '/user-agreement', label: 'Соглашение' },
]

export function SiteFooter() {
  return (
    <footer>
      <Link className="footerLogo" href="/" aria-label="VOZDOOH — на главную">
        <Image src="/brand/vozdooh-horizontal.webp" alt="VOZDOOH" width={900} height={118} />
      </Link>
      <nav aria-label="Нижняя навигация">
        <div className="footerNavGroup">
          {shopLinks.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}
        </div>
        <div className="footerNavGroup footerNavInfo">
          {infoLinks.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}
        </div>
      </nav>
      <div className="footerNote">
        <p>© 2026 VOZDOOH · vozdooh27.ru</p>
        <p>ИП Кущев Сергей Васильевич · Россия, г. Хабаровск</p>
        <p><a className="textLink" href="tel:+79244199990">+7 924 419-99-90</a> · <a className="textLink" href="mailto:vozdooh.kms@yandex.ru">vozdooh.kms@yandex.ru</a></p>
        <p>Искусство атмосферы. Парфюмерия для дома.</p>
      </div>
    </footer>
  )
}
