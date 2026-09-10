import type { Metadata } from "next";
import { BonusProgramBlock } from "@/components/bonus/BonusProgramBlock";
import { StaticPage } from "@/components/content/StaticPage";
import { EmptyState } from "@/components/ui/EmptyState";
import { getBonusProgram } from "@/lib/directus/bonus-programs";
import { createPageMetadata } from "@/lib/seo/metadata";
import { getStaticPageSeo } from "@/lib/seo/page-intents";

export const dynamic = "force-dynamic";

const pageSeo = getStaticPageSeo("/bonus/");
export const metadata: Metadata = createPageMetadata(pageSeo);

export default async function BonusPage() {
  const program = await getBonusProgram();

  if (!program) {
    return (
      <StaticPage eyebrow="Для покупателей" title="Бонусная программа" intro="">
        <EmptyState title="Программа пока не опубликована" text="Подтверждённые условия появятся на этой странице." />
      </StaticPage>
    );
  }

  return (
    <StaticPage eyebrow="Для покупателей" title="Бонусная программа" intro={program.short_description}>
      <section aria-label="Условия бонусной программы">
        <BonusProgramBlock program={program} />
      </section>
    </StaticPage>
  );
}
