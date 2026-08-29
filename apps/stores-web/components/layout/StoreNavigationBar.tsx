import Link from "next/link";

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
            <Link className="store-navigation__link" data-brand={store.slug} href={`/${store.slug}/`}>
              {store.name}, Амурск
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
