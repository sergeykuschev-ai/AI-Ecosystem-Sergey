import { TrackedLink } from "@/components/analytics/TrackedLink";
import type { Brand } from "@/types/brand";
import type { City } from "@/types/city";
import type { Store } from "@/types/store";
import { getFormattedOpeningHours } from "./opening-hours";

export type StoreOperatingStatus = "open" | "closed";

interface HomeStoreCardProps {
  store: Store;
  brand: Brand;
  city: City;
  operatingStatus?: StoreOperatingStatus | null;
}

function formatOpeningHours(store: Store): React.ReactNode {
  if (!store.opening_hours.length) {
    return <span className="store-preview-card__placeholder">Режим работы будет добавлен</span>;
  }

  return getFormattedOpeningHours(store.opening_hours).map((entry) => (
    <span className="store-preview-card__hours" key={entry.key}>
      {entry.days}: {entry.time ?? "время уточняется"}
    </span>
  ));
}

export function HomeStoreCard({ store, brand, city, operatingStatus = null }: HomeStoreCardProps) {
  const mapLink = store.map_links.find((link) => link.url);

  return (
    <article className="store-preview-card" data-brand={brand.slug} style={{ "--brand-color": brand.primary_color } as React.CSSProperties}>
      <div className="store-preview-card__heading">
        <p className="store-preview-card__brand">Магазин «{brand.name}»</p>
        {operatingStatus && (
          <span className={`store-preview-card__status store-preview-card__status--${operatingStatus}`}>
            {operatingStatus === "open" ? "Открыто" : "Закрыто"}
          </span>
        )}
      </div>
      <h3>{store.name}</h3>
      <dl className="store-preview-card__details">
        <div>
          <dt>Адрес</dt>
          <dd>{store.address ?? <span className="store-preview-card__placeholder">Адрес будет добавлен</span>}</dd>
        </div>
        <div>
          <dt>Режим работы</dt>
          <dd>{formatOpeningHours(store)}</dd>
        </div>
        <div>
          <dt>Телефон</dt>
          <dd>
            {store.telephone ? (
              <TrackedLink event="click_phone" payload={{ brand: brand.slug, store: store.slug }} href={`tel:${store.telephone.replace(/[^\d+]/g, "")}`}>
                {store.telephone}
              </TrackedLink>
            ) : (
              <span className="store-preview-card__placeholder">Телефон будет добавлен</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="store-preview-card__actions">
        <TrackedLink className="button button--primary" event="store_open" payload={{ city: city.slug, store: store.slug, brand: brand.slug }} href={`/stores/${city.slug}/${store.slug}/`}>
          Подробнее
        </TrackedLink>
        {store.telephone ? (
          <TrackedLink className="button button--secondary" event="click_phone" payload={{ brand: brand.slug, store: store.slug }} href={`tel:${store.telephone.replace(/[^\d+]/g, "")}`}>
            Позвонить
          </TrackedLink>
        ) : (
          <button className="button button--secondary" type="button" disabled title="Телефон будет добавлен позже">
            Позвонить
          </button>
        )}
        {mapLink ? (
          <TrackedLink className="button button--secondary" event="click_route" payload={{ brand: brand.slug, store: store.slug }} href={mapLink.url} target="_blank" rel="noopener noreferrer">
            Маршрут на карте
          </TrackedLink>
        ) : (
          <button className="button button--secondary" type="button" disabled title="Ссылка на карту будет добавлена после подтверждения адреса">
            Маршрут на карте
          </button>
        )}
      </div>
    </article>
  );
}
