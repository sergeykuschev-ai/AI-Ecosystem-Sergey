import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMiskaCatalogPreview } from "@/lib/miska/catalog";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ section: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { section } = await params;
  const { categories } = await getMiskaCatalogPreview();
  const selected = categories.find((category) => category.slug === section);
  return {
    title: selected ? `${selected.name} — проверка каталога` : "Каталог «Миски» — проверка",
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: PageProps) {
  const { section } = await params;
  const { categories, products } = await getMiskaCatalogPreview();
  const selected = categories.find((category) => category.slug === section);
  if (!selected) notFound();

  const byId = new Map(categories.map((category) => [category.external_id, category]));
  const belongsToSection = (categoryId: string | null) => {
    let category = categoryId ? byId.get(categoryId) : undefined;
    const seen = new Set<string>();
    while (category && !seen.has(category.external_id)) {
      if (category.external_id === selected.external_id) return true;
      seen.add(category.external_id);
      category = category.parent_external_id ? byId.get(category.parent_external_id) : undefined;
    }
    return false;
  };
  const sectionProducts = products.filter((product) => belongsToSection(product.category_external_id));

  return (
    <main className="page-shell">
      <section className="brand-landing-section">
        <p className="eyebrow">Каталог из 1С · закрытая проверка</p>
        <h1>{selected.name}</h1>
        <p>{sectionProducts.length} товаров</p>
        <div className="miska-category-grid">
          {sectionProducts.slice(0, 100).map((product) => (
            <article className="miska-category-card" key={product.external_id}>
              <h2>{product.name}</h2>
              {product.sku ? <p>Артикул: {product.sku}</p> : null}
              {product.barcode ? <p>Штрихкод: {product.barcode}</p> : null}
            </article>
          ))}
        </div>
        {sectionProducts.length > 100 ? <p>Показаны первые 100 товаров для проверки.</p> : null}
      </section>
    </main>
  );
}
