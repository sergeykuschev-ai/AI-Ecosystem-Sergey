import type { Metadata } from "next";
import { StaticPage } from "@/components/content/StaticPage";
import { FAQList } from "@/components/faq/FAQList";
import { JsonLd } from "@/components/seo/JsonLd";
import { getFaqs } from "@/lib/directus/faqs";
import { createFAQPageJsonLd } from "@/lib/seo/json-ld";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "Частые вопросы | Магазины Ампер, Вентиль, Метиз Маркет и Миска",
  description:
    "Ответы на частые вопросы о магазинах Ампер, Вентиль, Метиз Маркет и Миска в Амурске: адрес, режим работы и бонусная программа.",
  path: "/faq/",
});

export default async function FAQPage() {
  const faqs = await getFaqs();
  return (
    <main className="faq-page">
      <JsonLd data={createFAQPageJsonLd(faqs)} />
      <StaticPage
        eyebrow="Покупателям"
        title="Частые вопросы"
        intro="Ответы на основные вопросы о наших магазинах и бонусной программе."
      >
        <section className="faq-section" aria-label="Вопросы и ответы">
          <FAQList items={faqs} />
        </section>
      </StaticPage>
    </main>
  );
}
