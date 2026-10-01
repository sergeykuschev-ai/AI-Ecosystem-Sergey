import Link from "next/link";
import type { CatalogProduct } from "@/lib/catalog/products";
import { CATEGORY_LABELS } from "@/lib/catalog/products";

export function ProductCard({ product }: { product: CatalogProduct }) {
  const card = (
    <>
      <span className="product-card__category">{CATEGORY_LABELS[product.category]}</span>
      <span className="product-card__variant">{product.variant}</span>
    </>
  );

  if (product.url) {
    return (
      <Link className="product-card product-card--linked" href={product.url}>
        {card}
      </Link>
    );
  }

  return (
    <div className="product-card" id={`product-${product.slug}`}>
      {card}
    </div>
  );
}
