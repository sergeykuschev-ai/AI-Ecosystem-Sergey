import type { Brand } from "@/types/brand";
import type { City } from "@/types/city";
import type { Store } from "@/types/store";
import { Button } from "@/components/ui/Button";
import { HomeStoreCard } from "./HomeStoreCard";

interface HomeStoreSectionProps {
  stores: Store[];
  brands: Brand[];
  city: City;
}

export function HomeStoreSection({ stores, brands, city }: HomeStoreSectionProps) {
  return (
    <section className="home-store-section" aria-labelledby="local-store">
      <div className="home-store-section__header">
        <div>
          <p className="eyebrow">Физические торговые точки</p>
          <h2 id="local-store">Магазины в Амурске</h2>
          <p className="home-store-section__intro">Адреса, телефоны и режим работы магазинов в Амурске.</p>
        </div>
      </div>
      <div className="home-store-grid">
        {stores.map((store) => {
          const brand = brands.find((item) => item.id === store.brand_id);
          return brand ? <HomeStoreCard key={store.id} store={store} brand={brand} city={city} /> : null;
        })}
      </div>
      <div className="home-store-section__footer">
        <Button href="/stores/amursk/" variant="secondary">Все магазины Амурска</Button>
      </div>
    </section>
  );
}
