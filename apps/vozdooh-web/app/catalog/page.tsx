import { catalogSource, getCatalogRepository } from '../../src/catalog/source'

import type { Metadata } from 'next'
import { publicRobots } from '../../src/seo/indexing'
import Link from 'next/link'
import { Suspense } from 'react'
import { ProductCard } from '../../components/ProductCard'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'
import { FilterTracker } from '../../components/FilterTracker'
import { categoryLabels, familyLabels, moodLabels, roomLabels, type DemoCategory, type DemoFamily, type DemoMood, type DemoRoom } from '../../src/catalog/vocabulary'
import { catalogHref, parseCatalogFilters, type FilterGroup, type RawSearchParams } from '../../src/catalog/filterParams'
import { curatorSelection, isDebugCatalog, storefrontProducts } from '../../src/catalog/presentation'
import { withValidImages } from '../../src/catalog/validImages'
import { availableFilterOptions, applyCatalogFilters } from '../../src/catalog/filters'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Ароматы для дома — каталог интерьерной парфюмерии | VOZDOOH',
  description: 'Каталог ароматов для дома VOZDOOH: диффузоры, ароматические свечи, спреи, рефилы, автомобильные ароматы и подарочные наборы.',
  openGraph: { title: 'Ароматы для дома — каталог VOZDOOH', description: 'Диффузоры, ароматические свечи, спреи, рефилы и другие форматы интерьерной парфюмерии.' },
  alternates: { canonical: '/catalog' },
  robots: publicRobots(),
}

type Option<V extends string> = { value: V; label: string }

const filterGroups: { group: FilterGroup; title: string; options: Option<string>[] }[] = [
  { group: 'brand', title: 'Бренд', options: [] },
  { group: 'category', title: 'Категория', options: (Object.entries(categoryLabels) as [DemoCategory, string][]).map(([value, label]) => ({ value, label })) },
  { group: 'family', title: 'Характер', options: (Object.entries(familyLabels) as [DemoFamily, string][]).map(([value, label]) => ({ value, label })) },
  { group: 'mood', title: 'Настроение', options: (Object.entries(moodLabels) as [DemoMood, string][]).map(([value, label]) => ({ value, label })) },
  { group: 'room', title: 'Помещение', options: (Object.entries(roomLabels) as [DemoRoom, string][]).map(([value, label]) => ({ value, label })) },
]

export default async function CatalogPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = await searchParams
  const allProducts = await withValidImages(await (await getCatalogRepository()).list())
  const debug = isDebugCatalog(params)
  const demo = catalogSource() === 'demo'
  const categories = demo ? categoryLabels : Object.fromEntries(allProducts.map((product) => [product.trade.category, product.trade.category]))
  const brands = demo ? {} : Object.fromEntries(allProducts.filter((product) => product.trade.brand).map((product) => [product.trade.brand as string, product.trade.brand as string]))
  const visibleProducts = storefrontProducts(allProducts, debug || demo)
  const groups = filterGroups.map((group) => group.group === 'category'
    ? { ...group, options: Object.entries(categories).map(([value, label]) => ({ value, label })) }
    : group.group === 'brand'
      ? { ...group, options: Object.entries(brands).sort((a, b) => a[1].localeCompare(b[1], 'ru')).map(([value, label]) => ({ value, label })) }
      : group).map((group) => ({ ...group, options: availableFilterOptions(visibleProducts, group.group, Object.fromEntries(group.options.map(({ value, label }) => [value, label]))) }))
  const filters = parseCatalogFilters(params, categories, brands)
  const products = applyCatalogFilters(visibleProducts, filters)
  const hasFilters = Boolean(filters.brand || filters.category || filters.family || filters.mood || filters.room)

  const curated = !hasFilters && !debug && !demo ? curatorSelection(products) : []
  const resetHref = debug ? "/catalog?debugCatalog=1" : "/catalog"

  return (
    <main className="catalogPage">
      <Suspense fallback={null}>
        <FilterTracker />
      </Suspense>
      <SiteHeader />
      <section className="pageIntro">
        <span className="eyebrow">Каталог</span>
        <h1>Ароматы для пространства</h1>
        <p>{demo ? 'Демонстрационная коллекция VOZDOOH.' : 'Ароматы, которые становятся частью дома. Найдите свой характер пространства.'}</p>
        <nav className="landingLinks" aria-label="Знакомство с коллекцией"><Link href="/brands">Бренды</Link><Link href="/categories">Категории</Link></nav>
      </section>

      <div className="catalogControls">
        <details className="filterDisclosure">
          <summary>Фильтры{hasFilters ? ` · ${Object.values(filters).filter(Boolean).length}` : ''} <span aria-hidden="true">＋</span></summary>
          <form action="/catalog" className="filterPanel">
            {debug && <input type="hidden" name="debugCatalog" value="1" />}
            {groups.filter(({ group, options }) => filters[group] && options.length === 0).map(({ group }) => (
              <input key={group} type="hidden" name={group} value={filters[group]!} />
            ))}
            {groups.filter(({ options }) => options.length > 0).map(({ group, title, options }) => (
              <label key={group}>
                <span>{title}</span>
                <select name={group} defaultValue={filters[group] ?? ''} key={`${group}-${filters[group]}`}>
                  <option value="">Все</option>
                  {filters[group] && !options.some(({ value }) => value === filters[group]) && <option value={filters[group]!} hidden>{filters[group]} — нет товаров</option>}
                  {options.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
            ))}
            <button className="primary" type="submit">Показать ароматы</button>
          </form>
        </details>
        <Link className="catalogFinder" href="/finder">Подобрать аромат ↗</Link>
      </div>
      {hasFilters && <nav className="activeFilters" aria-label="Активные фильтры">
        {groups.map(({ group, title, options }) => filters[group] ? (
          <Link className="chip" key={group} aria-label={`Убрать фильтр ${title}: ${filters[group]}`} href={catalogHref(filters, group, null, debug)}>
            {options.find((option) => option.value === filters[group])?.label ?? filters[group]} <span aria-hidden="true">×</span>
          </Link>
        ) : null)}
        <Link className="clearFilters" href={resetHref}>Сбросить всё</Link>
      </nav>}
      {debug && <p className="resultNote">PREVIEW 1C · Внутренний просмотр · {allProducts.length} позиций, включая товары без фото. Цены не публикуются.</p>}
      {curated.length > 0 && <section className="curatorSection" aria-labelledby="curatorTitle">
        <div className="catalogSectionHeading"><h2 id="curatorTitle">Кураторский выбор</h2><span>Знакомство с коллекцией</span></div>
        <div className="curatorGrid">{curated.map((product) => <ProductCard product={product} key={product.id} />)}</div>
      </section>}
      <div className="catalogSectionHeading catalogCount"><h2>{hasFilters ? 'Ваш выбор' : 'Коллекция'}</h2><span>{products.length} позиций</span></div>

      {products.length > 0 ? (
        <section className="catalogGrid">
          {products.map((product, index) => (
            <ProductCard product={product} filters={filters} index={index} demo={demo} debug={debug} key={product.id} />
          ))}
        </section>
      ) : (
        <section className="emptyResult">
          <h2>Ничего не найдено</h2>
          <p>{demo ? 'По такой комбинации фильтров демонстрационных позиций нет. Попробуйте сбросить часть условий.' : 'По такой комбинации фильтров позиций нет. Попробуйте сбросить часть условий.'}</p>
          <Link className="primary" href={resetHref}>Сбросить фильтры</Link>
        </section>
      )}
      <SiteFooter />
    </main>
  )
}
