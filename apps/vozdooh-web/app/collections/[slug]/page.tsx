import { ContextualCatalogLinks } from '../../../components/ContextualCatalogLinks'
import type { Metadata } from 'next'
import { publicRobots } from '../../../src/seo/indexing'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ProductCard } from '../../../components/ProductCard'
import { SiteFooter } from '../../../components/SiteFooter'
import { SiteHeader } from '../../../components/SiteHeader'
import { TrackView } from '../../../components/TrackView'
import { availableCollections, collectionPath } from '../../../src/catalog/collections'
import { getCatalogRepository } from '../../../src/catalog/source'
import { withValidImages } from '../../../src/catalog/validImages'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ slug: string }> }

async function getCollection(slug: string) {
  const products = await withValidImages(await (await getCatalogRepository()).list())
  return availableCollections(products).find((collection) => collection.slug === slug)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const collection = await getCollection((await params).slug)
  if (!collection) return { title: 'Коллекция не найдена — VOZDOOH', robots: { index: false, follow: false } }
  const seoTitles: Record<string, string> = {
    'warm-interior': 'Тёплые ароматы для дома — VOZDOOH',
    'fresh-air': 'Свежие ароматы для дома — VOZDOOH',
    'woods-and-spices': 'Древесные и пряные ароматы для дома — VOZDOOH',
    floral: 'Цветочные ароматы для дома — VOZDOOH',
    'living-room': 'Ароматы для гостиной — VOZDOOH',
    bedroom: 'Ароматы для спальни — VOZDOOH',
    focused: 'Ароматы для концентрации и работы — VOZDOOH',
    'gift-diffusers': 'Аромадиффузор в подарок — купить с доставкой по России | VOZDOOH',
    'home-fragrance': 'Ароматы для дома — купить с доставкой по России | VOZDOOH',
  }
  const title = seoTitles[collection.slug] ?? `${collection.name} — коллекция VOZDOOH`
  return {
    title,
    description: collection.description,
    openGraph: { title, description: collection.description },
    alternates: { canonical: collectionPath(collection.slug) },
    robots: publicRobots(),
  }
}

export default async function CollectionPage({ params }: Props) {
  const collection = await getCollection((await params).slug)
  if (!collection) notFound()

  return (
    <main className="catalogPage collectionPage">
      <TrackView event="view_collection" payload={{ collection: collection.name, slug: collection.slug }} />
      <SiteHeader />
      <section className="collectionHero">
        <nav className="landingLinks" aria-label="Навигация по коллекциям">
          <Link href="/collections">Коллекции</Link>
          <Link href="/catalog">Каталог</Link>
        </nav>
        <span className="eyebrow">{collection.eyebrow} · {collection.name}</span>
        <h1>{{
          'warm-interior': 'Тёплые ароматы для дома',
          'fresh-air': 'Свежие ароматы для дома',
          'woods-and-spices': 'Древесные и пряные ароматы для дома',
          floral: 'Цветочные ароматы для дома',
          'living-room': 'Ароматы для гостиной',
          bedroom: 'Ароматы для спальни',
          focused: 'Ароматы для концентрации и работы',
          'gift-diffusers': 'Аромадиффузоры в подарок',
          'home-fragrance': 'Ароматы для дома',
        }[collection.slug] ?? collection.name}</h1>
        <p>{collection.description}</p>
        <small>{collection.note}</small>
      </section>

      {collection.guide && collection.guideTitle && (
        <section className="landingGuide" aria-labelledby="collectionGuideTitle">
          <h2 id="collectionGuideTitle">{collection.guideTitle}</h2>
          {collection.guide.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <nav className="landingLinks" aria-label="Полезные разделы">
            <Link href="/categories/diffusers">Диффузоры</Link>
            <Link href="/categories/gifts">Подарочные наборы</Link>
            <Link href="/brands/culti-milano">CULTI MILANO</Link>
            <Link href="/brands/teatro-fragranze-uniche">TEATRO</Link>
          </nav>
        </section>
      )}

      {['home-fragrance', 'gift-diffusers'].includes(collection.slug) && (
        <section className="landingGuide" aria-label="Покупка и доставка">
          <h2>Доставка ароматов по России</h2>
          <p>Интерьерные ароматы можно заказать онлайн из актуального наличия. Отправляем заказы из Хабаровска в другие регионы России через доступные пункты Ozon. Стоимость доставки согласовывается отдельно до отправки; условия оплаты и получения собраны на отдельных страницах.</p>
          <nav className="landingLinks" aria-label="Условия заказа">
            <Link href="/delivery">Доставка</Link>
            <Link href="/payment">Оплата</Link>
            <Link href="/catalog">Весь каталог</Link>
            <Link href="/guides/kak-vybrat-aromadiffuzor">Как выбрать диффузор</Link>
            {collection.slug === 'gift-diffusers' && <Link href="/guides/aromadiffuzor-v-podarok">Как выбрать диффузор в подарок</Link>}
            {collection.slug === 'home-fragrance' && <Link href="/guides/aromat-dlya-gostinoy-i-spalni">Аромат для гостиной и спальни</Link>}
          </nav>
        </section>
      )}

      {['living-room', 'bedroom'].includes(collection.slug) && (
        <section className="landingGuide" aria-label="Гид по выбору аромата для комнаты">
          <h2>Как выбрать аромат для комнаты</h2>
          <p>Для гостиной и спальни важны не только ноты, но и желаемая интенсивность, привычки дома и конкретный формат. В отдельном гиде собрали практический порядок выбора и позиции из актуального наличия.</p>
          <Link className="textLink" href="/guides/aromat-dlya-gostinoy-i-spalni">Читать гид →</Link>
        </section>
      )}

      <div className="catalogSectionHeading catalogCount collectionCount">
        <h2>В подборке</h2>
        <span>{collection.products.length} позиций</span>
      </div>
      <section className="catalogGrid">
        {collection.products.map((product, index) => <ProductCard product={product} index={index} key={product.id} />)}
      </section>

      <section className="collectionOutro">
        <p>Хотите выбрать по бренду, формату или другим доступным характеристикам?</p>
        <Link className="primary" href="/catalog">Открыть весь каталог</Link>
      </section>
      <ContextualCatalogLinks products={collection.products} currentPath={collectionPath(collection.slug)} />
      <SiteFooter />
    </main>
  )
}
