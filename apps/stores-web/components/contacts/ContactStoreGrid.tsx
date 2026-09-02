import type { Brand } from "@/types/brand";
import type { City } from "@/types/city";
import type { OpeningHoursEntry, Store } from "@/types/store";
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
            className="store-card"
            data-brand={brand.slug}
            style={{
              "--brand-color": brand.primary_color,
              display: "flex",
              flexDirection: "column",
              height: "100%",
            } as React.CSSProperties}
          >
            <BrandLogo brand={brand} />
            <h3>{brand.name}</h3>
            {BRAND_TAGLINE[brand.slug] && (
              <p className="store-tagline">{BRAND_TAGLINE[brand.slug]}</p>
            )}
            <p className="store-address">{store.address ?? "Адрес уточняется"}</p>

            <p className="eyebrow">Телефон</p>
            <p>
              {store.telephone ? (
                <a href={phoneHref!}>{store.telephone}</a>
              ) : (
                "Телефон уточняется"
              )}
            </p>

            <p className="eyebrow">Режим работы</p>
            <ContactStoreHours hours={store.opening_hours} />

            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {phoneHref && (
                <a className="button button--primary" href={phoneHref}>Позвонить</a>
              )}
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <a className="button button--secondary" href={detailHref} style={{ flex: 1, textAlign: "center" }}>
                  Подробнее о магазине
                </a>
                {mapUrl && (
                  <a
                    className="button button--secondary"
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: "center" }}
                  >
                    Показать на карте
                  </a>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
