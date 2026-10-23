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
  title: 'Аромадиффузор в подарок: как выбрать — гид VOZDOOH',
  description: 'Как выбрать аромадиффузор в подарок: аромат, объём, оформление и сценарий подарка. Подборка диффузоров из актуального наличия VOZDOOH с доставкой.',
  alternates: { canonical: '/guides/aromadiffuzor-v-podarok' },
  robots: publicRobots(),
}

const structuredData = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Аромадиффузор в подарок: как выбрать',
  description: 'Практический гид VOZDOOH по выбору аромадиффузора в подарок.',
  mainEntityOfPage: 'https://vozdooh27.ru/guides/aromadiffuzor-v-podarok',
  datePublished: '2026-10-10',
  dateModified: '2026-10-10',
  author: { '@type': 'Organization', name: 'VOZDOOH', url: 'https://vozdooh27.ru' },
  publisher: { '@type': 'Organization', name: 'VOZDOOH', url: 'https://vozdooh27.ru' },
  inLanguage: 'ru-RU',
}).replace(/</g, '\\u003c')

export default async function GiftDiffuserGuidePage() {
  const products = await withValidImages(await (await getCatalogRepository()).list())
  const collection = availableCollections(products).find((item) => item.slug === 'gift-diffusers')
  const highlights = collection?.products.slice(0, 4) ?? []

  return (
    <main className="catalogPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <SiteHeader />
      <article>
        <section className="pageIntro">
          <nav className="landingLinks" aria-label="Навигация">
            <Link href="/guides">Гиды</Link>
            <Link href="/collections/gift-diffusers">Диффузоры в подарок</Link>
          </nav>
          <span className="eyebrow">Подарочный гид</span>
          <h1>Как выбрать аромадиффузор в подарок</h1>
          <p>Аромат — вещь личная, поэтому хороший подарок начинается не с попытки угадать «самый универсальный» запах, а с нескольких понятных ориентиров: привычек человека, характера композиции, формата и внешнего вида флакона.</p>
        </section>

        <section className="landingGuide">
          <h2>1. Сначала выясните направление, а не одну ноту</h2>
          <p>Если вы знаете хотя бы общее предпочтение — свежие, цитрусовые, древесные, цветочные, тёплые или гурманские композиции — выбор уже становится заметно точнее. Одна нота в пирамиде сама по себе мало говорит о том, как будет ощущаться весь аромат.</p>
          <nav className="landingLinks" aria-label="Выбор по характеру">
            <Link href="/collections/fresh-air">Свежие ароматы</Link>
            <Link href="/collections/woods-and-spices">Древесные и пряные</Link>
            <Link href="/collections/floral">Цветочные</Link>
            <Link href="/collections/warm-interior">Тёплые</Link>
          </nav>
        </section>

        <section className="landingGuide">
          <h2>2. Если вкусы неизвестны — не делайте вид, что знаете их</h2>
          <p>Лучше вспомнить, какие запахи человеку уже нравятся дома, в свечах, косметике или парфюмерии, и отдельно — что он точно не любит. Если подсказок нет совсем, логичнее выбрать спокойный сценарий подарка и сохранить возможность выбора, чем обещать «универсальный аромат для всех».</p>
        </section>

        <section className="landingGuide">
          <h2>3. Объём — это не показатель качества подарка</h2>
          <p>Больший флакон может дольше использоваться, но сам по себе не делает подарок лучше. Смотрите одновременно на аромат, дизайн флакона, место использования и комплектацию конкретного товара. Для интерьерного подарка внешний вид важен почти так же, как композиция.</p>
          <Link className="textLink" href="/guides/kak-vybrat-aromadiffuzor">Как выбрать диффузор для дома →</Link>
        </section>

        <section className="landingGuide">
          <h2>4. Подумайте, где подарок будет стоять</h2>
          <p>Для спальни обычно ищут более спокойный фон, для гостиной можно выбирать выразительнее, а для кабинета — композиции, которые не перегружают пространство. Это не жёсткое правило, а удобный способ сузить выбор.</p>
          <nav className="landingLinks" aria-label="Выбор по комнате">
            <Link href="/collections/bedroom">Для спальни</Link>
            <Link href="/collections/living-room">Для гостиной</Link>
            <Link href="/finder">Подбор аромата</Link>
          </nav>
        </section>

        {highlights.length > 0 && (
          <section className="recommendations" aria-labelledby="gift-stock-title">
            <span className="eyebrow">Сейчас в наличии</span>
            <h2 id="gift-stock-title">Аромадиффузоры, которые можно заказать</h2>
            <p>Ниже — несколько позиций из текущего наличия VOZDOOH. Это не рейтинг и не обещание, что один аромат подойдёт всем: сравните описание, объём и оформление каждой карточки.</p>
            <div className="products">
              {highlights.map((product, index) => <ProductCard key={product.id} product={product} index={index} />)}
            </div>
            <nav className="landingLinks" aria-label="Продолжить выбор">
              <Link href="/collections/gift-diffusers">Все диффузоры в подарок</Link>
              <Link href="/categories/diffusers">Все аромадиффузоры</Link>
              <Link href="/delivery">Доставка</Link>
            </nav>
          </section>
        )}
      </article>
      <SiteFooter />
    </main>
  )
}
