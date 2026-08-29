import Link from "next/link";
import type { Brand } from "@/types/brand";
import { BrandLogo } from "./BrandLogo";

export function BrandCard({ brand }: { brand: Brand }) {
  return (
    <article className="brand-card" data-brand={brand.slug} style={{ "--brand-color": brand.primary_color } as React.CSSProperties}>
      <BrandLogo brand={brand} />
      <h3>{brand.name}</h3>
      <p>{brand.short_description}</p>
      <Link href={`/${brand.slug}/`}>О магазине <span aria-hidden="true">→</span></Link>
    </article>
  );
}
