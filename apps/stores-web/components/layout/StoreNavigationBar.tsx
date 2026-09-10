import { TrackedLink } from "@/components/analytics/TrackedLink";

const storeLinks = [
  { name: "Ампер", slug: "amper" },
  { name: "Вентиль", slug: "ventil" },
  { name: "Метиз Маркет", slug: "metiz-market" },
  { name: "Миска", slug: "miska" },
] as const;

export function StoreNavigationBar() {
  return (
    <nav className="store-navigation" aria-label="Навигация по магазинам">
      <ul className="store-navigation__list">
        {storeLinks.map((store) => (
          <li key={store.slug}>
            <TrackedLink
              className="store-navigation__link"
              dataAttributes={{ "data-brand": store.slug }}
              event="brand_open"
              payload={{ brand: store.slug }}
              href={`/${store.slug}/`}
            >
              {store.name}, Амурск
            </TrackedLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
