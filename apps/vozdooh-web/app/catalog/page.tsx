import type { Metadata } from 'next'
import Link from 'next/link'
import { ProductCard } from '../../components/ProductCard'
import { SiteFooter } from '../../components/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader'
import { categoryLabels, familyLabels, moodLabels, roomLabels, type DemoCategory, type DemoFamily, type DemoMood, type DemoRoom } from '../../src/catalog/demo'
import { catalogHref, parseDemoFilters, type FilterGroup, type RawSearchParams } from '../../src/catalog/filterParams'
import { applyDemoFilters } from '../../src/catalog/filters'

export const metadata: Metadata = {
  title: 'Каталог — VOZDOOH',
  description: 'Демонстрационный каталог VOZDOOH. Реальные товары, цены и наличие появятся после синхронизации с 1С.',
  robots: { index: false, follow: false },
}

type Option<V extends string> = { value: V; label: string }

const filterGroups: { group: FilterGroup; title: string; options: Option<string>[] }[] = [
  { group: 'category', title: 'Категория', options: (Object.entries(categoryLabels) as [DemoCategory, string][]).map(([value, label]) => ({ value, label })) },
  { group: 'family', title: 'Характер', options: (Object.entries(familyLabels) as [DemoFamily, string][]).map(([value, label]) => ({ value, label })) },
  { group: 'mood', title: 'Настроение', options: (Object.entries(moodLabels) as [DemoMood, string][]).map(([value, label]) => ({ value, label })) },
  { group: 'room', title: 'Помещение', options: (Object.entries(roomLabels) as [DemoRoom, string][]).map(([value, label]) => ({ value, label })) },
]

export default async function CatalogPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = await searchParams
  const filters = parseDemoFilters(params)
  const products = applyDemoFilters(filters)
  const hasFilters = Boolean(filters.category || filters.family || filters.mood || filters.room)

  return (
    <main>
      <SiteHeader />
      <section className="pageIntro">
        <span className="eyebrow">Каталог</span>
        <h1>Ароматы для пространства</h1>
        <p>Структура каталога готова к реальным данным из 1С. До импорта здесь используются только явные демонстрационные placeholders: цены, наличие и бренды не отображаются, пока их не подтвердит учётная система.</p>
      </section>

      <div className="filtersBar">
        {filterGroups.map(({ group, title, options }) => {
          const active = filters[group]
          return (
            <div className="filterGroup" key={group}>
              <b>{title}</b>
              <Link className={`chip${active === null ? ' active' : ''}`} href={catalogHref(filters, group, null)}>Все</Link>
              {options.map((option) => (
                <Link
                  className={`chip${active === option.value ? ' active' : ''}`}
                  href={catalogHref(filters, group, option.value)}
                  key={option.value}
                >
                  {option.label}
                </Link>
              ))}
            </div>
          )
        })}
      </div>

      <p className="resultNote">
        {hasFilters
          ? `Найдено демонстрационных позиций: ${products.length}. Фильтры работают на demo-данных и после импорта будут применяться к реальному каталогу.`
          : `Демонстрационные позиции: ${products.length}.`}
      </p>

      {products.length > 0 ? (
        <section className="catalogGrid">
          {products.map((product, index) => (
            <ProductCard product={product} index={index} key={product.id} />
          ))}
        </section>
      ) : (
        <section className="emptyResult">
          <h2>Ничего не найдено</h2>
          <p>По такой комбинации фильтров демонстрационных позиций нет. Попробуйте сбросить часть условий.</p>
          <Link className="primary" href="/catalog">Сбросить фильтры</Link>
        </section>
      )}
      <SiteFooter />
    </main>
  )
}
