import type { Brand } from "@/types/brand";
import type { City } from "@/types/city";
import type { OpeningHoursEntry, Store } from "@/types/store";
import Link from "next/link";
import { TrackedLink } from "@/components/analytics/TrackedLink";
import { BrandLogo } from "@/components/brand/BrandLogo";

const BRAND_ORDER = ["amper", "ventil", "metiz-market", "miska"];

const BRAND_TAGLINE: Record<string, string> = {
  amper: "Магазин электротоваров",
  ventil: "Магазин сантехники",
  "metiz-market": "Магазин метизов и крепежа",
  miska: "Магазин зоотоваров",
};

const DAY_LABELS: Record<string, string> = {
  Monday: "Пн",
  Tuesday: "Вт",
  Wednesday: "Ср",
  Thursday: "Чт",
  Friday: "Пт",
  Saturday: "Сб",
  Sunday: "Вс",
};

function formatDays(days: string[]): string {
  if (days.length === 0) return "";
  const labels = days.map((day) => DAY_LABELS[day] ?? day);
  if (labels.length === 1) return labels[0];
  // Simple consecutive-range detection for the two standard ranges.
  const dayIndex = (label: string) => Object.values(DAY_LABELS).indexOf(label);
  let consecutive = true;
  for (let i = 1; i < labels.length; i++) {
    if (dayIndex(labels[i]) - dayIndex(labels[i - 1]) !== 1) {
      consecutive = false;
      break;
    }
  }
  if (consecutive) {
    return `${labels[0]}–${labels[labels.length - 1]}`;
  }
  return labels.join(", ");
}

function formatPhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

function ContactStoreHours({ hours }: { hours: OpeningHoursEntry[] }) {
  if (hours.length === 0) {
    return <p className="placeholder">Режим работы уточняется</p>;
  }
  return (
    <dl className="hours-list">
      {hours.map((entry) => (
        <div key={entry.days.join("-")}>
          <dt>{formatDays(entry.days)}</dt>
          <dd>{entry.opens && entry.closes ? `${entry.opens}–${entry.closes}` : "Не указано"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ContactStoreGrid({ stores, brands, city }: { stores: Store[]; brands: Brand[]; city: City }) {
  const sorted = [...stores].sort((a, b) => {
    const brandA = brands.find((brand) => brand.id === a.brand_id);
    const brandB = brands.find((brand) => brand.id === b.brand_id);
    const indexA = brandA ? BRAND_ORDER.indexOf(brandA.slug) : Number.MAX_SAFE_INTEGER;
    const indexB = brandB ? BRAND_ORDER.indexOf(brandB.slug) : Number.MAX_SAFE_INTEGER;
    return indexA - indexB;
  });

  return (
    <div className="card-grid">
      {sorted.map((store) => {
        const brand = brands.find((item) => item.id === store.brand_id);
        if (!brand) return null;
        const detailHref = `/stores/${city.slug}/${store.slug}/`;
        const mapUrl = store.map_links[0]?.url;
        const phoneHref = store.telephone ? `tel:${formatPhone(store.telephone)}` : null;

        return (
          <article
            key={store.id}
            className="store-card store-card--contact"
            data-brand={brand.slug}
          >
            <BrandLogo brand={brand} />
            <h3>{brand.name}</h3>
            {BRAND_TAGLINE[brand.slug] && (
              <p className="store-tagline">{BRAND_TAGLINE[brand.slug]}</p>
            )}
            <address className="store-address">{store.address ?? "Адрес уточняется"}</address>

            <p className="eyebrow">Телефон</p>
            <p>
              {store.telephone ? (
                <TrackedLink event="click_phone" payload={{ brand: brand.slug, store: store.slug }} href={phoneHref!}>
                  {store.telephone}
                </TrackedLink>
              ) : (
                "Телефон уточняется"
              )}
            </p>

            <p className="eyebrow">Режим работы</p>
            <ContactStoreHours hours={store.opening_hours} />

            <div className="store-card__actions">
              <Link href={`/${brand.slug}/`}>
                Ассортимент магазина «{brand.name}»
              </Link>
              {phoneHref && (
                <TrackedLink className="button button--primary" event="click_phone" payload={{ brand: brand.slug, store: store.slug }} href={phoneHref}>
                  Позвонить
                </TrackedLink>
              )}
              <div className="store-card__actions-row">
                <TrackedLink
                  className="button button--secondary"
                  event="store_open"
                  payload={{ city: city.slug, store: store.slug, brand: brand.slug }}
                  href={detailHref}
                >
                  Подробнее о магазине
                </TrackedLink>
                {mapUrl && (
                  <TrackedLink
                    className="button button--secondary"
                    event="click_route"
                    payload={{ brand: brand.slug, store: store.slug }}
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Показать на карте
                  </TrackedLink>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
