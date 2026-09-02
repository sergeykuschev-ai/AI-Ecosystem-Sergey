import Image from "next/image";
import type { Brand } from "@/types/brand";

export function BrandLogo({ brand }: { brand: Brand }) {
  if (!brand.logo) return null;

  return (
    <div className="brand-logo" data-brand={brand.slug}>
      <Image
        className="brand-logo__image"
        src={brand.logo}
        alt={`Логотип магазина ${brand.name}`}
        fill
        sizes="(min-width: 1024px) 288px, (min-width: 672px) 40vw, 90vw"
        unoptimized
      />
    </div>
  );
}
