import type { PublicBrand } from "@/lib/brands/public";
import { BrandCard } from "./BrandCard";

export function BrandsIndex({ brands }: { brands: PublicBrand[] }) {
  return (
    <section className="brands-index">
      <h1>Бренды</h1>
      <p className="brands-index__intro">
        Бренды, представленные в каталоге VOZDOOH. О каждом бренде мы публикуем только
        проверенные факты: сведения без подтверждающего источника не размещаются.
      </p>
      <ul className="brands-index__grid">
        {brands.map((brand) => (
          <li key={brand.slug}>
            <BrandCard brand={brand} />
          </li>
        ))}
      </ul>
    </section>
  );
}
