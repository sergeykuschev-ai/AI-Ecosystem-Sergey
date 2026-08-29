import type { Metadata } from "next";
import { StaticPage } from "@/components/content/StaticPage";
import { PromotionList } from "@/components/promotions/PromotionList";
import { getPromotions } from "@/lib/directus/promotions";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({ title: "Акции магазинов в Амурске", description: "Подтверждённые акции магазинов «Ампер», «Вентиль», «Метиз Маркет» и «Миска» в Амурске.", path: "/akcii/" });
export default async function PromotionsPage() {
  const promotions = await getPromotions();
  return <StaticPage eyebrow="Предложения" title="Акции" intro="Здесь публикуются только действующие акции с точными сроками, магазинами и условиями."><section className="section" aria-label="Список акций"><PromotionList promotions={promotions} /></section></StaticPage>;
}
