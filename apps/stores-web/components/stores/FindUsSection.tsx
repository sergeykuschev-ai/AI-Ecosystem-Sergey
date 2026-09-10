import type { Brand } from "@/types/brand";
import type { City } from "@/types/city";
import type { Store } from "@/types/store";
import { TrackedLink } from "@/components/analytics/TrackedLink";
import { Button } from "@/components/ui/Button";
import { getFormattedOpeningHours } from "./opening-hours";

interface FindUsSectionProps {
  stores: Store[];
  brands: Brand[];
  city: City;
}

export function FindUsSection({ stores, brands, city }: FindUsSectionProps) {
  const storesWithBrands = stores
    .map((store) => ({ store, brand: brands.find((item) => item.id === store.brand_id) }))
    .filter((entry): entry is { store: Store; brand: Brand } => Boolean(entry.brand));
  if (!storesWithBrands.length) return null;

  const addresses = Array.from(
    new Set(storesWithBrands.map(({ store }) => store.address).filter((address): address is string => Boolean(address))),
  );
  const mapEntry = storesWithBrands.find(({ store }) => store.map_links.some((link) => link.url));
  const mapLink = mapEntry?.store.map_links.find((link) => link.url) ?? null;

  const brandNamesByPhone = new Map<string, string[]>();
  for (const { store, brand } of storesWithBrands) {
    if (!store.telephone) continue;
    const brandNames = brandNamesByPhone.get(store.telephone) ?? [];
    brandNames.push(brand.name);
    brandNamesByPhone.set(store.telephone, brandNames);
  }

  const representative = storesWithBrands[0].store;
  const hasCommonHours = storesWithBrands.every(
    ({ store }) => JSON.stringify(store.opening_hours) === JSON.stringify(representative.opening_hours),
  );
  const commonHours = getFormattedOpeningHours(representative.opening_hours);

  return (
    <section className="section find-us" id="find-us" aria-labelledby="find-us-title">
      <p className="eyebrow">Контакты и адрес</p>
      <h2 id="find-us-title">Как нас найти</h2>
      <div className="find-us__panel">
        <div className="find-us__info">
          {addresses.length === 1 && <p className="find-us__address">{addresses[0]}</p>}
          {addresses.length > 1 && (
            <ul className="find-us__address-list">
              {addresses.map((address) => <li key={address}>{address}</li>)}
            </ul>
          )}
          <p className="find-us__city">{city.name} · {city.region}</p>
          {mapLink && (
            <TrackedLink className="button button--primary" event="click_route" payload={{ city: city.slug }} href={mapLink.url} target="_blank" rel="noopener noreferrer">
              Построить маршрут
            </TrackedLink>
          )}
        </div>
        <div className="find-us__contacts">
          {brandNamesByPhone.size > 0 && (
            <div className="find-us__phones">
              <h3>Телефоны магазинов</h3>
              <ul>
                {Array.from(brandNamesByPhone.entries()).map(([telephone, brandNames]) => (
                  <li key={telephone}>
                    <span>{brandNames.map((name) => `«${name}»`).join(", ")}</span>
                    <TrackedLink event="click_phone" payload={{ city: city.slug }} href={`tel:${telephone.replace(/[^\d+]/g, "")}`}>
                      {telephone}
                    </TrackedLink>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="find-us__hours">
            <h3>Режим работы</h3>
            {hasCommonHours ? (
              commonHours.length ? (
                <ul>
                  {commonHours.map((entry) => (
                    <li key={entry.key}>
                      <span>{entry.days}</span>
                      <span>{entry.time ?? "время уточняется"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="placeholder">Режим работы будет добавлен</p>
              )
            ) : (
              <ul>
                {storesWithBrands.map(({ store, brand }) => (
                  <li key={store.id}>
                    <span>«{brand.name}»</span>
                    <span>
                      {getFormattedOpeningHours(store.opening_hours)
                        .map((entry) => `${entry.days}: ${entry.time ?? "время уточняется"}`)
                        .join("; ") || "время уточняется"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button href={`/stores/${city.slug}/`} variant="secondary">Все магазины · {city.name}</Button>
        <Button href="/kontakty/" variant="secondary">Контакты</Button>
      </div>
    </section>
  );
}
