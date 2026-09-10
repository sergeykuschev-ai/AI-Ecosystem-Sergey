import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";
import { FAQList } from "@/components/faq/FAQList";
import { JsonLd } from "@/components/seo/JsonLd";
import { EmptyState } from "@/components/ui/EmptyState";
import { getFaqs } from "@/lib/directus/faqs";
import { createFAQPageJsonLd } from "@/lib/seo/json-ld";
import { createListingPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

const pageMetadata = {
  title: "Частые вопросы | Магазины Ампер, Вентиль, Метиз Маркет и Миска",
  description:
    "Ответы на частые вопросы о магазинах Ампер, Вентиль, Метиз Маркет и Миска в Амурске: адрес, режим работы и бонусная программа.",
  path: "/faq/",
};

export async function generateMetadata(): Promise<Metadata> {
  const faqs = await getFaqs();
  return createListingPageMetadata(pageMetadata, faqs.length);
}

export default async function FAQPage() {
  const faqs = await getFaqs();
  return (
    <main className="faq-page">
      {faqs.length > 0 && <JsonLd data={createFAQPageJsonLd(faqs)} />}
      <StaticPage
        eyebrow="Покупателям"
        title="Частые вопросы"
        intro="Ответы на основные вопросы о наших магазинах и бонусной программе."
      >
        <section className="faq-section" aria-label="Вопросы и ответы">
          {faqs.length > 0 ? (
            <FAQList items={faqs} />
          ) : (
            <EmptyState title="Вопросы пока не опубликованы" text="Подтверждённые ответы появятся здесь после публикации." />
          )}
        </section>
        <section className="section" aria-labelledby="faq-useful">
          <h2 id="faq-useful">Полезные разделы</h2>
          <ul className="link-list">
            <li><Link href="/kontakty/">Контакты, адреса и телефоны магазинов</Link></li>
            <li><Link href="/stores/">Магазины по городам и страницы торговых точек</Link></li>
            <li><Link href="/bonus/">Бонусная программа</Link></li>
          </ul>
        </section>
      </StaticPage>
    </main>
  );
}
