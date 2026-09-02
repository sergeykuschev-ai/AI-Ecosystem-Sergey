import type { Metadata } from "next";
import { BrandActualList } from "@/components/brand/BrandActualList";
import { StaticPage } from "@/components/content/StaticPage";
import { EmptyState } from "@/components/ui/EmptyState";
import { getActualItemsByType } from "@/lib/directus/actual-items";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({ title: "Вакансии магазинов в Амурске", description: "Актуальные вакансии магазинов «Ампер», «Вентиль», «Метиз Маркет» и «Миска» в Амурске.", path: "/vakansii/" });
export const dynamic = "force-dynamic";
export default async function VacanciesPage() {
  const items = await getActualItemsByType("vacancy");
  return (
    <StaticPage eyebrow="Работа у нас" title="Вакансии" intro="На странице публикуются только актуальные вакансии с подтверждёнными условиями и контактами.">
      <section className="section" aria-label="Список вакансий">
        {items.length > 0 ? <BrandActualList items={items} /> : <EmptyState title="Открытых вакансий пока нет" text="Новые позиции появятся здесь после публикации." />}
      </section>
    </StaticPage>
  );
}
