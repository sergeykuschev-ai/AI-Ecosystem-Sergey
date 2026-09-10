import type { Store } from "@/types/store";
import { TrackedLink } from "@/components/analytics/TrackedLink";
import { StoreHours } from "./StoreHours";

export function StoreContactBlock({ store }: { store: Store }) {
  const mapUrl = store.map_links.find((link) => link.url)?.url ?? null;
  const telephoneHref = store.telephone?.replace(/[^\d+]/g, "") ?? null;

  return (
    <section className="contact-block" aria-labelledby="store-contacts">
      <h2 id="store-contacts">Контакты и режим работы</h2>
      <dl>
        <div><dt>Адрес</dt><dd>{store.address ?? "[ADDRESS_NOT_SET]"}</dd></div>
        <div>
          <dt>Телефон</dt>
          <dd>
            {store.telephone ? (
              <TrackedLink
                event="click_phone"
                payload={{ store: store.slug }}
                href={`tel:${store.telephone.replace(/[^\d+]/g, "")}`}
              >
                {store.telephone}
              </TrackedLink>
            ) : (
              "[PHONE_NOT_SET]"
            )}
          </dd>
        </div>
        {store.email && <div><dt>Email</dt><dd><a href={`mailto:${store.email}`}>{store.email}</a></dd></div>}
      </dl>
      {(telephoneHref || mapUrl) && (
        <div className="button-row">
          {telephoneHref && (
            <TrackedLink className="button button--primary" event="click_phone" payload={{ store: store.slug }} href={`tel:${telephoneHref}`}>
              Позвонить
            </TrackedLink>
          )}
          {mapUrl && (
            <TrackedLink className="button button--secondary" event="click_route" payload={{ store: store.slug }} href={mapUrl} target="_blank" rel="noopener noreferrer">
              Построить маршрут
            </TrackedLink>
          )}
        </div>
      )}
      <h3>Режим работы</h3>
      <StoreHours hours={store.opening_hours} />
    </section>
  );
}
