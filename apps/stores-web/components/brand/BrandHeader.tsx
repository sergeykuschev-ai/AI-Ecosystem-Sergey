import type { Brand } from "@/types/brand";
import { BrandLogo } from "./BrandLogo";

export function BrandHeader({ brand }: { brand: Brand }) {
  return (
    <header className="brand-hero" style={{ "--brand-color": brand.primary_color, "--brand-soft": brand.secondary_color } as React.CSSProperties}>
      <BrandLogo brand={brand} />
      <p className="eyebrow">Официальная страница магазина</p>
      <h1>{brand.name}</h1>
      <p className="lead">{brand.short_description}</p>
    </header>
  );
}
