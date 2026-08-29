import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/brand/BrandHeader";
import { CategoryGrid } from "@/components/categories/CategoryGrid";
import { StoreList } from "@/components/stores/StoreList";
import { Container } from "@/components/ui/Container";
import { getBrandBySlug, getBrands } from "@/lib/directus/brands";
import { getCategoriesByBrand } from "@/lib/directus/categories";
import { getCities } from "@/lib/directus/cities";
import { getStoresByBrand } from "@/lib/directus/stores";

export async function BrandPage({ slug }: { slug: string }) {
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();

  const [categories, stores, cities, brands] = await Promise.all([
    getCategoriesByBrand(brand.id),
    getStoresByBrand(brand.id),
    getCities(),
    getBrands(),
  ]);
  const city = cities.find((item) => item.id === stores[0]?.city_id);

  return (
    <main>
      <Container>
        <BrandHeader brand={brand} />
        <section className="section" aria-labelledby="brand-about">
          <h2 id="brand-about">О магазине</h2>
          <p>{brand.description}</p>
        </section>
        <section className="section" aria-labelledby="brand-directions">
          <p className="eyebrow">Основные направления</p>
          <h2 id="brand-directions">Категории</h2>
          <CategoryGrid categories={categories} />
          <p className="note">Категории представлены для навигации по направлениям. Каталог и товары появятся позднее.</p>
        </section>
        {city && (
          <section className="section" aria-labelledby="brand-stores">
            <h2 id="brand-stores">Магазин в Амурске</h2>
            <StoreList stores={stores} brands={brands} city={city} />
          </section>
        )}
      </Container>
    </main>
  );
}
