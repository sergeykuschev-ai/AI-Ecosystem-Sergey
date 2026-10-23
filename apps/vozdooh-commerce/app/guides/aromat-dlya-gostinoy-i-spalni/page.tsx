import type { Metadata } from 'next'
import Link from 'next/link'
import { ProductCard } from '../../../components/ProductCard'
import { SiteFooter } from '../../../components/SiteFooter'
import { SiteHeader } from '../../../components/SiteHeader'
import { availableCollections } from '../../../src/catalog/collections'
import { getCatalogRepository } from '../../../src/catalog/source'
import { withValidImages } from '../../../src/catalog/validImages'
import { publicRobots } from '../../../src/seo/indexing'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Как выбрать аромат для гостиной и спальни — VOZDOOH',
  description: 'Как подобрать аромат для гостиной и спальни: характер композиции, интенсивность и формат. Подборки VOZDOOH из актуального наличия.',
  alternates: { canonical: '/guides/aromat-dlya-gostinoy-i-spalni' },
  robots: publicRobots(),
}

const structuredData = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Как выбрать аромат для гостиной и спальни',
  description: 'Практический гид VOZDOOH по выбору интерьерного аромата для разных комнат.',
  mainEntityOfPage: 'https://vozdooh27.ru/guides/aromat-dlya-gostinoy-i-spalni',
  datePublished: '2026-10-10',
  dateModified: '2026-10-10',
  author: { '@type': 'Organization', name: 'VOZDOOH', url: 'https://vozdooh27.ru' },
  publisher: { '@type': 'Organization', name: 'VOZDOOH', url: 'https://vozdooh27.ru' },
  inLanguage: 'ru-RU',
}).replace(/</g, '\\u003c')

export default async function RoomFragranceGuidePage() {
  const products = await withValidImages(await (await getCatalogRepository()).list())
  const collections = availableCollections(products)
  const living = collections.find((item) => item.slug === 'living-room')
  const bedroom = collections.find((item) => item.slug === 'bedroom')
  const livingHighlights = living?.products.slice(0, 3) ?? []
  const bedroomHighlights = bedroom?.products.slice(0, 3) ?? []

  return (
    <main className="catalogPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <SiteHeader />
      <article>
        <section className="pageIntro">
          <nav className="landingLinks" aria-label="Навигация">
            <Link href="/guides">Гиды</Link>
            <Link href="/collections/home-fragrance">Ароматы для дома</Link>
          </nav>
          <span className="eyebrow">По пространству</span>
          <h1>Как выбрать аромат для гостиной и спальни</h1>
          <p>Комната помогает быстрее сузить выбор: важно не только, какие ноты нравятся, но и насколько заметным должен быть аромат, сколько времени вы проводите в пространстве и какой фон хотите получить.</p>
        </section>

        <section className="landingGuide">
          <h2>Для гостиной: можно больше характера</h2>
          <p>Гостиная часто выдерживает более заметные древесные, цитрусовые, пряные и цветочные композиции. Но вместо правила «для гостиной нужен сильный аромат» лучше ориентироваться на размер пространства, привычки дома и реальную интенсивность конкретного продукта.</p>
          <nav className="landingLinks" aria-label="Ароматы для гостиной">
            <Link href="/collections/living-room">Подборка для гостиной</Link>
            <Link href="/collections/woods-and-spices">Древесные и пряные</Link>
            <Link href="/collections/fresh-air">Свежие</Link>
          </nav>
        </section>

        {livingHighlights.length > 0 && (
          <section className="recommendations" aria-labelledby="living-stock-title">
            <span className="eyebrow">Из актуального наличия</span>
            <h2 id="living-stock-title">Варианты для гостиной</h2>
            <div className="products">
              {livingHighlights.map((product, index) => <ProductCard key={product.id} product={product} index={index} />)}
            </div>
          </section>
        )}

        <section className="landingGuide">
          <h2>Для спальни: важнее комфортный фон</h2>
          <p>В спальне особенно заметно, если аромат оказывается слишком навязчивым. Поэтому разумно начинать с композиции, которую вы уже считаете спокойной и приятной, а интенсивность увеличивать постепенно в рамках инструкции конкретного продукта.</p>
          <nav className="landingLinks" aria-label="Ароматы для спальни">
            <Link href="/collections/bedroom">Подборка для спальни</Link>
            <Link href="/collections/floral">Цветочные</Link>
            <Link href="/collections/fresh-air">Свежие</Link>
          </nav>
        </section>

        {bedroomHighlights.length > 0 && (
          <section className="recommendations" aria-labelledby="bedroom-stock-title">
            <span className="eyebrow">Из актуального наличия</span>
            <h2 id="bedroom-stock-title">Варианты для спальни</h2>
            <div className="products">
              {bedroomHighlights.map((product, index) => <ProductCard key={product.id} product={product} index={index} />)}
            </div>
          </section>
        )}

        <section className="landingGuide">
          <h2>Как не ошибиться с интенсивностью</h2>
          <p>Не стоит выбирать объём только по площади комнаты и ожидать точного результата. На ощущение влияют формула аромата, палочки, температура, вентиляция и место установки. Для палочкового диффузора сначала следуйте инструкции бренда и регулируйте интенсивность только тем способом, который предусмотрен конкретным продуктом.</p>
          <nav className="landingLinks" aria-label="Продолжить выбор">
            <Link href="/guides/kak-vybrat-aromadiffuzor">Гид по аромадиффузорам</Link>
            <Link href="/categories/diffusers">Все диффузоры</Link>
            <Link href="/finder">Подобрать аромат</Link>
          </nav>
        </section>
      </article>
      <SiteFooter />
    </main>
  )
}
