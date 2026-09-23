import Link from "next/link";
import { getMiskaCatalogPreview } from "@/lib/miska/catalog";
import { MISKA_CATALOG_SECTIONS } from "@/lib/miska/catalog-taxonomy";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Каталог Миски — закрытая проверка",
  robots: { index: false, follow: false },
};

function syncLabel(value: string | null) {
  if (!value) return "ещё не синхронизировалось";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Vladivostok",
  }).format(new Date(value));
}

export default async function Page() {
  const { products } = await getMiskaCatalogPreview();
  const priced = products.filter((product) => product.price != null).length;
  const inStock = products.filter((product) => Number(product.stock_quantity ?? 0) > 0).length;
  const review = products.filter((product) => product.classification_status === "review").length;
  const branded = products.filter((product) => Boolean(product.brand)).length;
  const lastSync = products.map((product) => product.offers_synced_at).filter(Boolean).sort().at(-1) ?? null;

  const sections = MISKA_CATALOG_SECTIONS.map((section) => {
    const rows = products.filter((product) => product.site_section === section.name);
    return {
      ...section,
      count: rows.length,
      inStock: rows.filter((product) => Number(product.stock_quantity ?? 0) > 0).length,
      categories: new Set(rows.map((product) => product.site_category).filter(Boolean)).size,
    };
  }).filter((section) => section.count > 0);

  return (
    <main className="page-shell brand-landing" data-brand="miska">
      <section className="brand-landing-section miska-catalog-head">
        <p className="eyebrow">Каталог из 1С · закрытая проверка</p>
        <h1>Рабочий каталог «Миски»</h1>
        <p className="lead">1С отвечает за цену и остаток. Категории, бренды, изображения и контент сайта живут отдельно.</p>

        <div className="miska-catalog-stats">
          <div><strong>{products.length}</strong><span>товаров</span></div>
          <div><strong>{inStock}</strong><span>в наличии</span></div>
          <div><strong>{priced}</strong><span>с ценой</span></div>
          <div><strong>{branded}</strong><span>бренд определён</span></div>
        </div>
        <p className="miska-catalog-sync">Последнее обновление 1С: {syncLabel(lastSync)}</p>
      </section>

      <section className="brand-landing-section">
        <div className="miska-catalog-section-heading">
          <div>
            <p className="eyebrow">Нормальная структура сайта</p>
            <h2>Разделы каталога</h2>
          </div>
          <Link className="miska-catalog-all-link" href="/miska/catalog-preview/all/">Все {products.length} товаров →</Link>
        </div>

        <div className="miska-category-grid miska-catalog-section-grid">
          {sections.map((section) => (
            <article className="miska-category-card miska-catalog-section-card" key={section.slug}>
              <h2><Link href={`/miska/catalog-preview/${section.slug}/`}>{section.name}</Link></h2>
              <p>{section.count} товаров · {section.inStock} в наличии · {section.categories} категорий</p>
            </article>
          ))}
        </div>
      </section>

      <section className="brand-landing-section">
        <p className="eyebrow">Контроль качества</p>
        <h2>Очередь проверки</h2>
        <p className="miska-catalog-note">
          Автоматически разобрано {products.length - review} из {products.length}. В ручной очереди осталось {review}.
        </p>
        <div className="miska-category-grid miska-catalog-section-grid">
          <article className="miska-category-card miska-catalog-section-card">
            <h2><Link href="/miska/catalog-preview/review/">Нужно проверить</Link></h2>
            <p>{review} товаров с неоднозначной исходной группой или названием</p>
          </article>
        </div>
      </section>
    </main>
  );
}
