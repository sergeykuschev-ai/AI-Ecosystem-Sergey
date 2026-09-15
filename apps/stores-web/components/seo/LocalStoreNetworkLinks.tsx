import Link from "next/link";

const STORES = [
  { slug: "amper", name: "Ампер", description: "магазин электротоваров" },
  { slug: "ventil", name: "Вентиль", description: "магазин сантехники" },
  { slug: "metiz-market", name: "Метиз Маркет", description: "магазин метизов и крепежа" },
  { slug: "miska", name: "Миска", description: "зоомагазин" },
] as const;

interface LocalStoreNetworkLinksProps {
  currentSlug: (typeof STORES)[number]["slug"];
}

export function LocalStoreNetworkLinks({ currentSlug }: LocalStoreNetworkLinksProps) {
  const otherStores = STORES.filter((store) => store.slug !== currentSlug);

  return (
    <section className="brand-landing-section" aria-labelledby="other-stores-amursk">
      <p className="eyebrow">Рядом</p>
      <h2 id="other-stores-amursk">Другие наши магазины в Амурске</h2>
      <p>По адресу проспект Победы, 16 также работают другие магазины нашей сети.</p>
      <ul>
        {otherStores.map((store) => (
          <li key={store.slug}>
            <Link href={`/${store.slug}/`}>{store.name}</Link> — {store.description}
          </li>
        ))}
      </ul>
    </section>
  );
}
