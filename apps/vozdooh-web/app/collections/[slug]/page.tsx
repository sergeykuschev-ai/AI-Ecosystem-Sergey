import type { Metadata } from 'next'
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
  return {
    title: `${collection.name} — коллекция VOZDOOH`,
    description: collection.description,
    alternates: { canonical: collectionPath(collection.slug) },
    robots: { index: false, follow: false },
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
        <span className="eyebrow">{collection.eyebrow}</span>
        <h1>{collection.name}</h1>
        <p>{collection.description}</p>
        <small>{collection.note}</small>
      </section>

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
      <SiteFooter />
    </main>
  )
}
