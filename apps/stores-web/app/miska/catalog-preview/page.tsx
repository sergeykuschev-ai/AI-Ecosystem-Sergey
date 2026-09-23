import Link from "next/link";
import { getMiskaCatalogPreview } from "@/lib/miska/catalog";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Каталог Миски — закрытая проверка",
  robots: { index: false, follow: false },
};

const PRIMARY_ORDER = [
  "Кошки", "Собаки", "Грызуны", "Птицы", "Рыбы",
  "Аптека", "Средства ухода и содержания", "Одежда", "Попоны/Воротники", "Поилки",
];

function syncLabel(value: string | null) {
  if (!value) return "ещё не синхронизировалось";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Vladivostok",
  }).format(new Date(value));
}
export default async function Page() {
  const { categories, products } = await getMiskaCatalogPreview();
  const root = categories.find((category) => category.name === "МИСКА ЗООТОВАРЫ");
  const sections = root
    ? categories.filter((category) => category.parent_external_id === root.external_id)
    : [];
  const byId = new Map(categories.map((category) => [category.external_id, category]));
  const countBySection = new Map<string, number>();

  for (const product of products) {
    let category = product.category_external_id ? byId.get(product.category_external_id) : undefined;
    const seen = new Set<string>();
    while (category?.parent_external_id && !seen.has(category.external_id)) {
      if (category.parent_external_id === root?.external_id) break;
      seen.add(category.external_id);
      category = byId.get(category.parent_external_id);
    }
    if (category && category.parent_external_id === root?.external_id) {
      countBySection.set(category.external_id, (countBySection.get(category.external_id) ?? 0) + 1);
    }
  }

  const priority = new Map(PRIMARY_ORDER.map((name, index) => [name, index]));
  const primary = sections
    .filter((section) => priority.has(section.name))
    .sort((a, b) => (priority.get(a.name) ?? 99) - (priority.get(b.name) ?? 99));
  const other = sections
    .filter((section) => !priority.has(section.name))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const priced = products.filter((product) => product.price != null).length;
  const inStock = products.filter((product) => Number(product.stock_quantity ?? 0) > 0).length;
  const lastSync = products.map((product) => product.offers_synced_at).filter(Boolean).sort().at(-1) ?? null;

  const renderSection = (section: (typeof sections)[number]) => (
    <article className="miska-category-card miska-catalog-section-card" key={section.external_id}>
      <h2><Link href={`/miska/catalog-preview/${section.slug}/`}>{section.name}</Link></h2>
      <p>{countBySection.get(section.external_id) ?? 0} товаров</p>
    </article>
  );

  return (
    <main className="page-shell brand-landing" data-brand="miska">
      <section className="brand-landing-section miska-catalog-head">
        <p className="eyebrow">Каталог из 1С · закрытая проверка</p>
        <h1>Рабочий каталог «Миски»</h1>
        <p className="lead">Реальные цены и остатки магазина. Изображения и описания будут добавляться отдельно.</p>

        <div className="miska-catalog-stats">
          <div><strong>{products.length}</strong><span>товаров</span></div>
          <div><strong>{inStock}</strong><span>в наличии</span></div>
          <div><strong>{priced}</strong><span>с ценой</span></div>
          <div><strong>{products.length - priced}</strong><span>без цены</span></div>
        </div>
        <p className="miska-catalog-sync">Последнее обновление 1С: {syncLabel(lastSync)}</p>
      </section>

      <section className="brand-landing-section">
        <div className="miska-catalog-section-heading">
          <div>
            <p className="eyebrow">Навигация</p>
            <h2>Основные разделы</h2>
          </div>
          <Link className="miska-catalog-all-link" href="/miska/catalog-preview/all/">Все {products.length} товаров →</Link>
        </div>
        <div className="miska-category-grid miska-catalog-section-grid">
          {primary.map(renderSection)}
        </div>
      </section>

      {other.length ? (
        <section className="brand-landing-section">
          <p className="eyebrow">Структура 1С</p>
          <h2>Прочие группы</h2>
          <p className="miska-catalog-note">Эти группы пока оставлены как в 1С, чтобы ничего не потерять. Перед публичным запуском их разберём.</p>
          <div className="miska-category-grid miska-catalog-section-grid">
            {other.map(renderSection)}
          </div>
        </section>
      ) : null}
    </main>
  );
}
