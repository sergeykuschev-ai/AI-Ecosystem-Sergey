import Link from "next/link";
import type { PublicBrand } from "@/lib/brands/public";
import { getCatalogPresenceSentence, getNoStoryNotice } from "@/lib/brands/public";
import { CLAIM_CATEGORY_LABELS } from "@/lib/brands/types";
import type { CatalogProduct } from "@/lib/catalog/products";
import { ProductCard } from "./ProductCard";

export function BrandLanding({
  brand,
  products,
}: {
  brand: PublicBrand;
  products: CatalogProduct[];
}) {
  return (
    <article className="brand-page">
      <header className="brand-page__header">
        <p className="breadcrumbs">
          <Link href="/">Главная</Link>
          <span aria-hidden="true"> / </span>
          <Link href="/brands">Бренды</Link>
        </p>
        <h1>{brand.name}</h1>
        <p className="brand-page__presence">
          {getCatalogPresenceSentence(brand.name, brand.productCount)}
        </p>
      </header>

      <section aria-labelledby="brand-facts">
        <h2 id="brand-facts">О бренде</h2>
        {brand.hasVerifiedStory ? (
          <ul className="brand-facts">
            {brand.verifiedClaims.map((claim) => (
              <li key={claim.id}>
                <span className="brand-facts__category">{CLAIM_CATEGORY_LABELS[claim.category]}:</span>{" "}
                {claim.statement}
                {claim.source ? (
                  <span className="brand-facts__source"> (источник: {claim.source})</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="brand-facts__notice">{getNoStoryNotice()}</p>
        )}
        <p className="brand-facts__policy">
          Мы публикуем о брендах только факты, подтверждённые проверяемыми источниками.
        </p>
      </section>

      <section aria-labelledby="brand-products">
        <h2 id="brand-products">Позиции в каталоге</h2>
        <ul className="product-list">
          {products.map((product) => (
            <li key={product.slug}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
