import type { Store } from "@/types/store";
import { StoreHours } from "./StoreHours";

export function StoreContactBlock({ store }: { store: Store }) {
  return (
    <section className="contact-block" aria-labelledby="store-contacts">
      <h2 id="store-contacts">Контакты и режим работы</h2>
      <dl>
        <div><dt>Адрес</dt><dd>{store.address ?? "[ADDRESS_NOT_SET]"}</dd></div>
        <div><dt>Телефон</dt><dd>{store.telephone ? <a href={`tel:${store.telephone}`}>{store.telephone}</a> : "[PHONE_NOT_SET]"}</dd></div>
        {store.email && <div><dt>Email</dt><dd><a href={`mailto:${store.email}`}>{store.email}</a></dd></div>}
      </dl>
      <h3>Режим работы</h3>
      <StoreHours hours={store.opening_hours} />
    </section>
  );
}
