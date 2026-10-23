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
  title: 'Рефил для диффузора: как использовать и заправить — VOZDOOH',
  description: 'Как использовать рефил для аромадиффузора: совместимость, подготовка флакона, палочки и смена аромата. Рефилы из актуального наличия VOZDOOH.',
  alternates: { canonical: '/guides/refil-dlya-diffuzora-kak-ispolzovat' },
  robots: publicRobots(),
}

const structuredData = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Рефил для диффузора: как использовать и заправить',
  description: 'Практический гид VOZDOOH по использованию рефила для аромадиффузора.',
  mainEntityOfPage: 'https://vozdooh27.ru/guides/refil-dlya-diffuzora-kak-ispolzovat',
  datePublished: '2026-10-10',
  dateModified: '2026-10-10',
  author: { '@type': 'Organization', name: 'VOZDOOH', url: 'https://vozdooh27.ru' },
  publisher: { '@type': 'Organization', name: 'VOZDOOH', url: 'https://vozdooh27.ru' },
  inLanguage: 'ru-RU',
}).replace(/</g, '\\u003c')

export default async function RefillGuidePage() {
  const products = storefrontProducts(await withValidImages(await (await getCatalogRepository()).list()))
  const highlights = products.filter((product) => product.trade.category === 'Рефилы').slice(0, 4)

  return (
    <main className="catalogPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <SiteHeader />
      <article>
        <section className="pageIntro">
          <nav className="landingLinks" aria-label="Навигация">
            <Link href="/guides">Гиды</Link>
            <Link href="/categories/refills">Рефилы</Link>
          </nav>
          <span className="eyebrow">Повторное наполнение</span>
          <h1>Рефил для диффузора: как использовать</h1>
          <p>Рефил — это сменная ароматическая жидкость, но не любой рефил подходит к любому флакону и палочкам. Перед заправкой важно проверить назначение и рекомендации конкретного бренда.</p>
        </section>

        <section className="landingGuide">
          <h2>1. Сначала проверьте совместимость</h2>
          <p>Сверьте бренд, аромат, назначение и формат. Рефил для палочкового диффузора не стоит автоматически считать совместимым с другими ароматическими системами. Если производитель не заявляет универсальность, безопаснее использовать предназначенный для этой линейки продукт.</p>
        </section>

        <section className="landingGuide">
          <h2>2. Не смешивайте остатки вслепую</h2>
          <p>Если меняете аромат, остатки старой композиции могут изменить новую. Следуйте инструкции производителя по подготовке флакона. Не заливайте ароматическую жидкость в мокрый сосуд и не используйте бытовые растворители для очистки без прямой рекомендации бренда.</p>
        </section>

        <section className="landingGuide">
          <h2>3. Палочки тоже влияют на результат</h2>
          <p>Старые палочки могут быть уже насыщены предыдущей композицией или работать слабее. При смене аромата новые палочки обычно дают более предсказуемый результат, но точный комплект и материал лучше выбирать по рекомендации производителя.</p>
          <Link className="textLink" href="/categories/accessories">Палочки и аксессуары →</Link>
        </section>

        <section className="landingGuide">
          <h2>4. После заправки настройте интенсивность заново</h2>
          <p>Не переносите автоматически прежнее количество палочек на новый аромат. Начните мягче и увеличивайте интенсивность постепенно: разные композиции и основы могут ощущаться по-разному даже при одинаковом объёме.</p>
          <Link className="textLink" href="/guides/kak-polzovatsya-aromadiffuzorom">Как пользоваться диффузором →</Link>
        </section>

        {highlights.length > 0 && (
          <section className="recommendations" aria-labelledby="refill-stock-title">
            <span className="eyebrow">Из актуального наличия</span>
            <h2 id="refill-stock-title">Рефилы, которые можно заказать</h2>
            <div className="products">{highlights.map((product, index) => <ProductCard key={product.id} product={product} index={index} />)}</div>
            <nav className="landingLinks" aria-label="Продолжить выбор">
              <Link href="/categories/refills">Все рефилы</Link>
              <Link href="/categories/diffusers">Аромадиффузоры</Link>
              <Link href="/delivery">Доставка</Link>
            </nav>
          </section>
        )}
      </article>
      <SiteFooter />
    </main>
  )
}
