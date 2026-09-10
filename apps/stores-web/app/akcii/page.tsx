import type { Metadata } from "next";
import { BrandActualList } from "@/components/brand/BrandActualList";
import { StaticPage } from "@/components/content/StaticPage";
import { EmptyState } from "@/components/ui/EmptyState";
import { getActualItemsByType } from "@/lib/directus/actual-items";
import { createListingPageMetadata } from "@/lib/seo/metadata";

const pageMetadata = { title: "Акции магазинов в Амурске", description: "Подтверждённые акции магазинов «Ампер», «Вентиль», «Метиз Маркет» и «Миска» в Амурске.", path: "/akcii/" };
export async function generateMetadata(): Promise<Metadata> {
  const items = await getActualItemsByType("promotion");
  return createListingPageMetadata(pageMetadata, items.length);
}
export const dynamic = "force-dynamic";
export default async function PromotionsPage() {
  const items = await getActualItemsByType("promotion");
  return (
    <StaticPage eyebrow="Предложения" title="Акции" intro="Здесь публикуются только действующие акции с точными сроками, магазинами и условиями.">
      <section className="section" aria-labelledby="promotions-title">
        <h2 id="promotions-title">Действующие акции магазинов</h2>
        {items.length > 0 ? <BrandActualList items={items} /> : <EmptyState title="Активных акций пока нет" text="Здесь появятся только подтверждённые предложения и условия." />}
      </section>
    </StaticPage>
  );
}
