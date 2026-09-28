import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'
import { availableCollections, collectionPath } from '../../src/catalog/collections'
import { catalogImage, productPresentation } from '../../src/catalog/presentation'
import { getCatalogRepository } from '../../src/catalog/source'
import { withValidImages } from '../../src/catalog/validImages'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Коллекции — VOZDOOH',
  description: 'Редакционные подборки VOZDOOH по характеру аромата, настроению и пространству.',
  alternates: { canonical: '/collections' },
  robots: { index: false, follow: false },
}

export default async function CollectionsPage() {
  const products = await withValidImages(await (await getCatalogRepository()).list())
  const collections = availableCollections(products)
  const usedHeroes = new Set<string>()

  return (
    <main className="collectionsPage">
      <SiteHeader />
      <section className="collectionsIntro">
        <span className="eyebrow">Коллекции</span>
        <h1>Подборки с характером</h1>
        <p>Не случайные витрины, а подборки из реального ассортимента VOZDOOH — по уже подтверждённому характеру аромата, настроению или пространству.</p>
        <small>Состав обновляется вместе с актуальным каталогом и остатками.</small>
      </section>

      <section className="collectionGrid" aria-label="Коллекции VOZDOOH">
        {collections.map((collection, index) => {
          const hero = collection.products.find((product) => !usedHeroes.has(product.id)) ?? collection.products[0]
          if (hero) usedHeroes.add(hero.id)
          const image = hero ? catalogImage(hero) : null
          const display = hero ? productPresentation(hero) : null
          return (
            <Link className="collectionTile" href={collectionPath(collection.slug)} key={collection.slug}>
              <span className="collectionTileVisual">
                {image && <Image src={image} alt="" fill sizes="(max-width: 760px) 100vw, 50vw" />}
                <small aria-hidden="true">0{index + 1}</small>
              </span>
              <span className="collectionTileCopy">
                <small>{collection.eyebrow}</small>
                <h2>{collection.name}</h2>
                <p>{collection.description}</p>
                {display && <span>{hero?.trade.brand} · {display.title}</span>}
                <b>{collection.products.length} позиций <i aria-hidden="true">→</i></b>
              </span>
            </Link>
          )
        })}
      </section>

      <section className="collectionManifesto">
        <span className="eyebrow">Принцип отбора</span>
        <p>Если характеристика аромата или пространства не подтверждена для конкретного товара, мы не добавляем его в такую подборку.</p>
        <Link className="textLink" href="/catalog">Смотреть весь каталог →</Link>
      </section>
      <SiteFooter />
    </main>
  )
}
