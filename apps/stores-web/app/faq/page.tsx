import type { Metadata } from "next";
import { StaticPage } from "@/components/content/StaticPage";
import { FAQList } from "@/components/faq/FAQList";
import { getFaqs } from "@/lib/directus/faqs";
import { createPageMetadata } from "@/lib/seo/metadata";
export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({ title: "Частые вопросы", description: "Ответы на частые вопросы о магазинах и возможностях сайта.", path: "/faq/" });
export default async function FAQPage() {
  const faqs = await getFaqs();
  return <StaticPage eyebrow="Помощь" title="Частые вопросы" intro="Короткие ответы о магазинах, данных на сайте и возможностях первой версии."><section className="section" aria-label="Вопросы и ответы"><FAQList items={faqs} /></section></StaticPage>;
}
