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
  title: 'Как выбрать ароматическую свечу для дома — VOZDOOH',
  description: 'Как выбрать ароматическую свечу для дома: сценарий, характер аромата, размер и безопасное использование. Свечи из актуального наличия VOZDOOH.',
  alternates: { canonical: '/guides/kak-vybrat-aromaticheskuyu-svechu' },
  robots: publicRobots(),
}

const structuredData = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Как выбрать ароматическую свечу для дома',
  description: 'Практический гид VOZDOOH по выбору ароматической свечи для дома.',
  mainEntityOfPage: 'https://vozdooh27.ru/guides/kak-vybrat-aromaticheskuyu-svechu',
  datePublished: '2026-10-10',
  dateModified: '2026-10-10',
  author: { '@type': 'Organization', name: 'VOZDOOH', url: 'https://vozdooh27.ru' },
  publisher: { '@type': 'Organization', name: 'VOZDOOH', url: 'https://vozdooh27.ru' },
  inLanguage: 'ru-RU',
}).replace(/</g, '\\u003c')

export default async function CandleGuidePage() {
  const products = storefrontProducts(await withValidImages(await (await getCatalogRepository()).list()))
  const highlights = products.filter((product) => product.trade.category === 'Свечи').slice(0, 4)

  return (
    <main className="catalogPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <SiteHeader />
      <article>
        <section className="pageIntro">
          <nav className="landingLinks" aria-label="Навигация">
            <Link href="/guides">Гиды</Link>
            <Link href="/categories/candles">Ароматические свечи</Link>
          </nav>
          <span className="eyebrow">Выбор свечи</span>
          <h1>Как выбрать ароматическую свечу для дома</h1>
          <p>Удачная свеча — это не только красивый аромат в банке. Важно понять, где вы будете её использовать, насколько заметным должен быть аромат и какие правила горения указал производитель.</p>
        </section>

        <section className="landingGuide">
          <h2>1. Начните со сценария</h2>
          <p>Для спальни, ванной, гостиной и подарка могут подходить разные характеры аромата и размеры свечи. Сначала решите, нужен ли мягкий вечерний фон, более заметная атмосфера для гостиной или подарок, где оформление также имеет большое значение.</p>
        </section>

        <section className="landingGuide">
          <h2>2. Выбирайте характер композиции, а не одну ноту</h2>
          <p>Цитрусовые и зелёные композиции обычно воспринимаются легче, древесные и пряные — глубже, цветочные — по-разному в зависимости от базы, а гурманские могут быть заметнее. Это ориентиры, а не строгие правила: смотрите полное описание конкретной свечи.</p>
          <nav className="landingLinks" aria-label="Выбор по характеру">
            <Link href="/collections/fresh-air">Свежие</Link>
            <Link href="/collections/woods-and-spices">Древесные и пряные</Link>
            <Link href="/collections/floral">Цветочные</Link>
            <Link href="/collections/warm-interior">Тёплые</Link>
          </nav>
        </section>

        <section className="landingGuide">
          <h2>3. Не оценивайте свечу только по холодному аромату</h2>
          <p>То, как свеча пахнет без горения, и то, как композиция раскрывается при использовании, могут отличаться. Поэтому при выборе полезнее сочетать описание аромата, бренд, размер и рекомендации производителя, а не искать просто «самую сильную» свечу.</p>
        </section>

        <section className="landingGuide">
          <h2>4. Правильное горение зависит от конкретной свечи</h2>
          <p>Подрезать фитиль, длительность первого горения и максимальное время одного сеанса нужно определять по инструкции производителя. Не оставляйте горящую свечу без присмотра, держите её вдали от детей, животных, легковоспламеняющихся предметов и сильного сквозняка.</p>
        </section>

        {highlights.length > 0 && (
          <section className="recommendations" aria-labelledby="candle-stock-title">
            <span className="eyebrow">Из актуального наличия</span>
            <h2 id="candle-stock-title">Ароматические свечи VOZDOOH</h2>
            <div className="products">{highlights.map((product, index) => <ProductCard key={product.id} product={product} index={index} />)}</div>
            <nav className="landingLinks" aria-label="Продолжить выбор">
              <Link href="/categories/candles">Все свечи</Link>
              <Link href="/collections/home-fragrance">Все ароматы для дома</Link>
              <Link href="/delivery">Доставка</Link>
            </nav>
          </section>
        )}
      </article>
      <SiteFooter />
    </main>
  )
}
