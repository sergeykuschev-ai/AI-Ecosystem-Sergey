import Link from "next/link";
import type { Brand } from "@/types/brand";
import type { City } from "@/types/city";
import type { OpeningHoursEntry, Store } from "@/types/store";

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

function OpeningHours({ entries }: { entries: OpeningHoursEntry[] }) {
  return entries.map((entry) => (
    <span className="brand-store-contact__hours" key={entry.days.join("-")}>
      {formatDays(entry.days)}: {entry.opens && entry.closes ? `${entry.opens}–${entry.closes}` : "время уточняется"}
    </span>
  ));
}

interface BrandStoreContactProps {
  store: Store;
  brand: Brand;
  city: City;
  heading?: string;
  note?: string;
  showCallAction?: boolean;
  contactsHref?: string;
}

export function BrandStoreContact({
  store,
  brand,
  city,
  heading,
  note,
  showCallAction = false,
  contactsHref,
}: BrandStoreContactProps) {
  const mapLink = store.map_links.find((link) => link.url);
  const telephoneHref = store.telephone?.replace(/[^\d+]/g, "");

  return (
    <article className="brand-store-contact">
      <div className="brand-store-contact__heading">
        <p className="eyebrow">Магазин в Амурске</p>
        <h2>{heading ?? "Адрес и контакты"}</h2>
        <p className="brand-store-contact__name">{brand.name}</p>
      </div>
      <dl className="brand-store-contact__details">
        <div>
          <dt>Адрес</dt>
          <dd>{store.address}</dd>
        </div>
        <div>
          <dt>Режим работы</dt>
          <dd><OpeningHours entries={store.opening_hours} /></dd>
        </div>
        <div>
          <dt>Телефон</dt>
          <dd>{store.telephone && telephoneHref ? <a href={`tel:${telephoneHref}`}>{store.telephone}</a> : "Телефон уточняется"}</dd>
        </div>
      </dl>
      {note ? <p className="brand-store-contact__note">{note}</p> : null}
      <div className="brand-store-contact__actions">
        {showCallAction && store.telephone && telephoneHref ? (
          <a className="button button--primary" href={`tel:${telephoneHref}`}>
            Позвонить
          </a>
        ) : null}
        <Link href={`/stores/${city.slug}/${store.slug}/`}>Подробнее о торговой точке</Link>
        {contactsHref ? <Link href={contactsHref}>Контакты</Link> : null}
        {mapLink && (
          <a href={mapLink.url} target="_blank" rel="noopener noreferrer">
            Показать на карте <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
    </article>
  );
}
