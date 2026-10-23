import type { Metadata } from 'next'
import Link from 'next/link'
import { ProductCard } from '../../../components/ProductCard'
import { SiteFooter } from '../../../components/SiteFooter'
import { SiteHeader } from '../../../components/SiteHeader'
import { storefrontProducts } from '../../../src/catalog/presentation'
import { getCatalogRepository } from '../../../src/catalog/source'
import { withValidImages } from '../../../src/catalog/validImages'
import { publicRobots } from '../../../src/seo/indexing'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Как пользоваться аромадиффузором с палочками — VOZDOOH',
  description: 'Как пользоваться аромадиффузором с палочками: куда поставить, сколько палочек начать использовать, когда менять интенсивность и чего избегать. Гид VOZDOOH.',
  alternates: { canonical: '/guides/kak-polzovatsya-aromadiffuzorom' },
  robots: publicRobots(),
}

const structuredData = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Как пользоваться аромадиффузором с палочками',
  description: 'Практический гид VOZDOOH по использованию аромадиффузора с палочками.',
  mainEntityOfPage: 'https://vozdooh27.ru/guides/kak-polzovatsya-aromadiffuzorom',
  datePublished: '2026-10-10',
  dateModified: '2026-10-10',
  author: { '@type': 'Organization', name: 'VOZDOOH', url: 'https://vozdooh27.ru' },
  publisher: { '@type': 'Organization', name: 'VOZDOOH', url: 'https://vozdooh27.ru' },
  inLanguage: 'ru-RU',
}).replace(/</g, '\\u003c')

export default async function DiffuserUseGuidePage() {
  const products = storefrontProducts(await withValidImages(await (await getCatalogRepository()).list()))
  const highlights = products.filter((product) => product.trade.category === 'Диффузоры').slice(0, 4)

  return (
    <main className="catalogPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <SiteHeader />
      <article>
        <section className="pageIntro">
          <nav className="landingLinks" aria-label="Навигация">
            <Link href="/guides">Гиды</Link>
            <Link href="/categories/diffusers">Аромадиффузоры</Link>
          </nav>
          <span className="eyebrow">Практика</span>
          <h1>Как пользоваться аромадиффузором с палочками</h1>
          <p>У диффузора нет одной универсальной настройки для всех комнат и брендов. Надёжный подход — начать мягче, следовать инструкции конкретного производителя и менять интенсивность постепенно.</p>
        </section>

        <section className="landingGuide">
          <h2>1. Подготовьте флакон по инструкции бренда</h2>
          <p>Снимите транспортировочную защиту так, как указано производителем, и поставьте флакон на устойчивую поверхность. Не используйте универсальные советы по прокалыванию или частичному снятию пробки, если этого нет в инструкции конкретного диффузора.</p>
        </section>

        <section className="landingGuide">
          <h2>2. Начните с меньшего количества палочек</h2>
          <p>Чем больше рабочая поверхность палочек, тем обычно заметнее аромат и быстрее расход жидкости. Но точного числа «на квадратный метр» для всех брендов нет: материал палочек, формула основы, температура и движение воздуха отличаются. Начните с меньшего количества и добавляйте по одной, оценивая результат через некоторое время.</p>
        </section>

        <section className="landingGuide">
          <h2>3. Куда поставить диффузор</h2>
          <p>Лучше выбирать устойчивое место без прямого солнца, батареи и постоянного сильного сквозняка. Тепло и интенсивный поток воздуха могут ускорять испарение. Берегите мебель и чувствительные поверхности от контакта с ароматической жидкостью.</p>
          <nav className="landingLinks" aria-label="Выбор по комнате">
            <Link href="/collections/living-room">Для гостиной</Link>
            <Link href="/collections/bedroom">Для спальни</Link>
            <Link href="/guides/aromat-dlya-gostinoy-i-spalni">Гид по комнатам</Link>
          </nav>
        </section>

        <section className="landingGuide">
          <h2>4. Нужно ли переворачивать палочки</h2>
          <p>Это зависит от конкретного продукта. Переворачивание может временно усиливать аромат, но одновременно увеличивает испарение и риск капель на поверхности. Если производитель допускает такой способ регулировки, делайте это аккуратно и не чаще, чем требуется для комфортной интенсивности.</p>
        </section>

        <section className="landingGuide">
          <h2>5. Если аромат стал слабее</h2>
          <p>Сначала проверьте уровень жидкости, положение флакона и состояние палочек. Обоняние также адаптируется к постоянному фону, поэтому ощущение «перестал пахнуть» не всегда означает, что диффузор перестал работать. Если жидкость заканчивается, используйте совместимый рефил и рекомендации бренда.</p>
          <Link className="textLink" href="/guides/refil-dlya-diffuzora-kak-ispolzovat">Как пользоваться рефилом →</Link>
        </section>

        {highlights.length > 0 && (
          <section className="recommendations" aria-labelledby="diffuser-stock-title">
            <span className="eyebrow">Из актуального наличия</span>
            <h2 id="diffuser-stock-title">Аромадиффузоры VOZDOOH</h2>
            <div className="products">{highlights.map((product, index) => <ProductCard key={product.id} product={product} index={index} />)}</div>
            <nav className="landingLinks" aria-label="Продолжить выбор">
              <Link href="/categories/diffusers">Все аромадиффузоры</Link>
              <Link href="/guides/kak-vybrat-aromadiffuzor">Как выбрать диффузор</Link>
              <Link href="/delivery">Доставка</Link>
            </nav>
          </section>
        )}
      </article>
      <SiteFooter />
    </main>
  )
}
