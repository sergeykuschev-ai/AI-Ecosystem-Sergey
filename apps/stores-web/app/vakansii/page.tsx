import type { Metadata } from "next";
import { StaticPage } from "@/components/content/StaticPage";
import { EmptyState } from "@/components/ui/EmptyState";
import { VacancyCard } from "@/components/vacancies/VacancyCard";
import { getVacancies } from "@/lib/directus/vacancies";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({ title: "Вакансии магазинов в Амурске", description: "Актуальные вакансии магазинов «Ампер», «Вентиль», «Метиз Маркет» и «Миска» в Амурске.", path: "/vakansii/" });
export default async function VacanciesPage() {
  const vacancies = await getVacancies();
  return <StaticPage eyebrow="Работа у нас" title="Вакансии" intro="На странице публикуются только актуальные вакансии с подтверждёнными условиями и контактами."><section className="section" aria-label="Список вакансий">{vacancies.length ? <div className="card-grid">{vacancies.map((vacancy) => <VacancyCard key={vacancy.id} vacancy={vacancy} />)}</div> : <EmptyState title="Открытых вакансий пока нет" text="Новые позиции появятся здесь после публикации." />}</section></StaticPage>;
}
