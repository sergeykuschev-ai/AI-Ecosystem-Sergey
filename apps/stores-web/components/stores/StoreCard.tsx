import Link from "next/link";
import type { Brand } from "@/types/brand";
import type { City } from "@/types/city";
import type { Store } from "@/types/store";
import { BrandLogo } from "@/components/brand/BrandLogo";

export function StoreCard({ store, brand, city }: { store: Store; brand: Brand; city: City }) {
  return (
    <article className="store-card">
      <BrandLogo brand={brand} />
      <p className="eyebrow">{city.name}</p>
      <h3>{store.name}</h3>
      <p>{store.short_description}</p>
      <p className="store-address">{store.address ?? "[ADDRESS_NOT_SET]"}</p>
      <Link href={`/stores/${city.slug}/${store.slug}/`}>Страница магазина <span aria-hidden="true">→</span></Link>
    </article>
  );
}
