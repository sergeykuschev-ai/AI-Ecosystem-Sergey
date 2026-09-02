import type { Metadata } from "next";
import { ContactStoreGrid } from "@/components/contacts/ContactStoreGrid";
import { JsonLd } from "@/components/seo/JsonLd";
import { StaticPage } from "@/components/content/StaticPage";
import { EmptyState } from "@/components/ui/EmptyState";
import { getBrands } from "@/lib/directus/brands";
import { getCityBySlug } from "@/lib/directus/cities";
import { getStoresByCity } from "@/lib/directus/stores";
import { createContactPageJsonLd } from "@/lib/seo/json-ld";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "Контакты магазинов в Амурске | Ампер, Вентиль, Метиз Маркет, Миска",
  description: "Адрес, телефоны и режим работы магазинов Ампер, Вентиль, Метиз Маркет и Миска в Амурске.",
  path: "/kontakty/",
});

const CONTACTS_INTRO = "Четыре магазина по одному адресу — электротовары, сантехника, крепёж и товары для питомцев.";

export default async function ContactsPage() {
  const [city, brands] = await Promise.all([getCityBySlug("amursk"), getBrands()]);

  if (!city) {
    return (
      <StaticPage eyebrow="Контакты" title="Наши магазины в Амурске" intro={CONTACTS_INTRO}>
        <EmptyState title="Город не найден" text="Контактная информация для Амурска пока не опубликована." />
      </StaticPage>
    );
  }

  const stores = await getStoresByCity(city.id);

  if (stores.length === 0) {
    return (
      <StaticPage eyebrow="Контакты" title="Наши магазины в Амурске" intro={CONTACTS_INTRO}>
        <EmptyState title="Магазины не найдены" text="Контактная информация о торговых точках в Амурске пока не опубликована." />
      </StaticPage>
    );
  }

  return (
    <main className="contacts-page">
      <JsonLd data={createContactPageJsonLd()} />
      <StaticPage eyebrow="Контакты" title="Наши магазины в Амурске" intro={CONTACTS_INTRO}>
        <section className="contacts-section" aria-labelledby="contacts-title">
          <h2 id="contacts-title">Магазины</h2>
          <ContactStoreGrid stores={stores} brands={brands} city={city} />
        </section>
      </StaticPage>
    </main>
  );
}
