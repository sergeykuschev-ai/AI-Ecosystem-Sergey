import { getMiskaCatalogPreview } from "@/lib/miska/catalog";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Каталог Миски — проверка",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const { categories, products } = await getMiskaCatalogPreview();
  return (
    <main className="page-shell">
      <section className="brand-landing-section">
        <p className="eyebrow">Проверка каталога 1С</p>
        <h1>Каталог «Миски»</h1>
        <p>{categories.length} категорий · {products.length} товаров</p>
        <div className="miska-category-grid">
          {categories.slice(0, 24).map((category) => (
            <article className="miska-category-card" key={category.external_id}>
              <h2>{category.name}</h2>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
