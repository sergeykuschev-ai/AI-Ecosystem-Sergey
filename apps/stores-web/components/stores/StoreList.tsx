import type { Brand } from "@/types/brand";
import type { City } from "@/types/city";
import type { Store } from "@/types/store";
import { StoreCard } from "./StoreCard";

export function StoreList({ stores, brands, city }: { stores: Store[]; brands: Brand[]; city: City }) {
  return (
    <div className="card-grid">
      {stores.map((store) => {
        const brand = brands.find((item) => item.id === store.brand_id);
        return brand ? <StoreCard key={store.id} store={store} brand={brand} city={city} /> : null;
      })}
    </div>
  );
}
