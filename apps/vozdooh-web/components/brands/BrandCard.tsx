import Link from "next/link";
import type { PublicBrand } from "@/lib/brands/public";
import { getCatalogPresenceSentence } from "@/lib/brands/public";

export function BrandCard({ brand }: { brand: PublicBrand }) {
  const originClaim = brand.verifiedClaims.find((claim) => claim.category === "origin");
  return (
    <Link className="brand-card" href={`/brands/${brand.slug}`}>
      <span className="brand-card__name">{brand.name}</span>
      <span className="brand-card__note">
        {originClaim ? originClaim.statement : "Сведения о бренде проверяются"}
      </span>
      <span className="brand-card__count">
        {getCatalogPresenceSentence(brand.name, brand.productCount)}
      </span>
    </Link>
  );
}
