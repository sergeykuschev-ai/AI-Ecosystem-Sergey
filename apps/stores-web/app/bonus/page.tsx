import type { Metadata } from "next";
import { BonusProgramBlock } from "@/components/bonus/BonusProgramBlock";
import { StaticPage } from "@/components/content/StaticPage";
import { EmptyState } from "@/components/ui/EmptyState";
import { getBonusProgram } from "@/lib/directus/bonus-programs";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({ title: "Бонусная программа", description: "Информация и правила бонусной программы участвующих магазинов в Амурске.", path: "/bonus/" });
export default async function BonusPage() {
  const program = await getBonusProgram();
  return <StaticPage eyebrow="Для покупателей" title="Бонусная программа" intro="Условия участия, список магазинов и правила будут размещены после официального утверждения."><section className="section" aria-label="Условия бонусной программы">{program ? <BonusProgramBlock program={program} /> : <EmptyState title="Программа пока не опубликована" text="Подтверждённые условия появятся на этой странице." />}</section></StaticPage>;
}
