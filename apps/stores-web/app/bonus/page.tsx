import type { Metadata } from "next";
import Link from "next/link";
import { BonusProgramBlock } from "@/components/bonus/BonusProgramBlock";
import { StaticPage } from "@/components/content/StaticPage";
import { EmptyState } from "@/components/ui/EmptyState";
import { getBonusProgram } from "@/lib/directus/bonus-programs";
import { getBrands } from "@/lib/directus/brands";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "Бонусная программа",
  description: "Информация и правила бонусной программы участвующих магазинов в Амурске.",
  path: "/bonus/",
});

export default async function BonusPage() {
  const [program, brands] = await Promise.all([getBonusProgram(), getBrands()]);

  if (!program) {
    return (
      <StaticPage eyebrow="Для покупателей" title="Бонусная программа" intro="">
        <EmptyState title="Программа пока не опубликована" text="Подтверждённые условия появятся на этой странице." />
      </StaticPage>
    );
  }

  const participatingBrands = brands.filter(
    (brand) => brand.active && program.participating_brands.includes(brand.id),
  );

  return (
    <StaticPage eyebrow="Для покупателей" title="Бонусная программа" intro={program.short_description}>
      <section aria-label="Условия бонусной программы">
        <BonusProgramBlock program={program} />
      </section>
      {participatingBrands.length > 0 && (
        <section className="section" aria-labelledby="bonus-stores-title">
          <h2 id="bonus-stores-title">Магазины бонусной программы</h2>
          <ul className="link-list">
            {participatingBrands.map((brand) => (
              <li key={brand.id}>
                <Link href={`/${brand.slug}/`}>Ассортимент и контакты магазина «{brand.name}»</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </StaticPage>
  );
}
