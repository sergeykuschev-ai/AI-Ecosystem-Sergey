import Link from "next/link";
import type { Brand } from "@/types/brand";
import type { City } from "@/types/city";
import type { Store } from "@/types/store";

export type StoreOperatingStatus = "open" | "closed";

interface HomeStoreCardProps {
  store: Store;
  brand: Brand;
  city: City;
  operatingStatus?: StoreOperatingStatus | null;
}

const dayLabels: Record<string, string> = {
  Monday: "Пн",
  Tuesday: "Вт",
  Wednesday: "Ср",
  Thursday: "Чт",
  Friday: "Пт",
  Saturday: "Сб",
  Sunday: "Вс",
};

function formatDays(days: string[]): string {
  const key = days.join(",");
  if (key === "Monday,Tuesday,Wednesday,Thursday,Friday") return "Пн–Пт";
  if (key === "Saturday,Sunday") return "Сб–Вс";
  return days.map((day) => dayLabels[day] ?? day).join(", ");
}

function formatOpeningHours(store: Store): React.ReactNode {
  if (!store.opening_hours.length) {
    return <span className="store-preview-card__placeholder">Режим работы будет добавлен</span>;
  }

  return store.opening_hours.map((entry) => (
    <span className="store-preview-card__hours" key={entry.days.join("-")}>
      {formatDays(entry.days)}: {entry.opens && entry.closes ? `${entry.opens}–${entry.closes}` : "время уточняется"}
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
              <a href={`tel:${store.telephone.replace(/[^\d+]/g, "")}`}>{store.telephone}</a>
            ) : (
              <span className="store-preview-card__placeholder">Телефон будет добавлен</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="store-preview-card__actions">
        <Link className="button button--primary" href={`/stores/${city.slug}/${store.slug}/`}>Подробнее</Link>
        {mapLink ? (
          <a className="button button--secondary" href={mapLink.url} target="_blank" rel="noopener noreferrer">Показать на карте</a>
        ) : (
          <button className="button button--secondary" type="button" disabled title="Ссылка на карту будет добавлена после подтверждения адреса">
            Показать на карте
          </button>
        )}
      </div>
    </article>
  );
}
