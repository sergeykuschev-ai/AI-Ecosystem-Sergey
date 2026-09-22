import Link from "next/link";
import { getMiskaCatalogPreview } from "@/lib/miska/catalog";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Каталог Миски — проверка",
  robots: { index: false, follow: false },
};

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

  return (
    <main className="page-shell">
      <section className="brand-landing-section">
        <p className="eyebrow">Каталог из 1С · закрытая проверка</p>
        <h1>Каталог «Миски»</h1>
        <p>{categories.length} категорий · {products.length} товаров</p>
        <div className="miska-category-grid">
          {sections.map((section) => (
            <article className="miska-category-card" key={section.external_id}>
              <h2><Link href={`/miska/catalog-preview/${section.slug}/`}>{section.name}</Link></h2>
              <p>{countBySection.get(section.external_id) ?? 0} товаров</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
