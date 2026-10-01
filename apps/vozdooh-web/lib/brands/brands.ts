import type { Brand } from "./types";

/**
 * Brand research layer for VOZDOOH.
 *
 * Only facts supported by an existing repository artifact may carry
 * status "verified":
 *  - "catalog"  — derived from the VOZDOOH catalog seed (lib/catalog/products.ts)
 *                 or from the brand's official name as recorded there;
 *  - issue #200 defines the candidate set.
 *
 * Everything else (founders, dates, production, materials, awards,
 * sustainability) stays "needs_source" and must never render on public pages.
 * The full audit lives in research/brand-audit-2026-10.md.
 */
export const BRANDS: Brand[] = [
  {
    slug: "culti-milano",
    name: "Culti Milano",
    claims: [
      {
        id: "culti-milano-origin-name",
        category: "origin",
        statement: "Слово «Milano» в названии бренда указывает на Милан, Италию.",
        status: "verified",
        source: "catalog: official brand name «Culti Milano»",
      },
      {
        id: "culti-milano-founding",
        category: "founding",
        statement: "Год основания бренда",
        status: "needs_source",
      },
      {
        id: "culti-milano-founders",
        category: "founders",
        statement: "Основатели бренда",
        status: "needs_source",
      },
      {
        id: "culti-milano-philosophy",
        category: "philosophy",
        statement: "Философия и позиционирование бренда",
        status: "needs_source",
      },
      {
        id: "culti-milano-craft",
        category: "craft",
        statement: "Места и способы производства",
        status: "needs_source",
      },
      {
        id: "culti-milano-materials",
        category: "materials",
        statement: "Составы, парфюмерные пирамиды, материалы флаконов и свечей",
        status: "needs_source",
      },
    ],
  },
  {
    slug: "teatro-fragranze-uniche",
    name: "Teatro Fragranze Uniche",
    claims: [
      {
        id: "teatro-fragranze-uniche-origin-name",
        category: "origin",
        statement:
          "Название бренда образовано итальянскими словами: «teatro» — «театр», «fragranze uniche» — «уникальные ароматы».",
        status: "verified",
        source: "catalog: official brand name «Teatro Fragranze Uniche»",
      },
      {
        id: "teatro-fragranze-uniche-origin-city",
        category: "origin",
        statement: "Город и страна происхождения бренда (название их не указывает)",
        status: "needs_source",
      },
      {
        id: "teatro-fragranze-uniche-founding",
        category: "founding",
        statement: "Год основания бренда",
        status: "needs_source",
      },
      {
        id: "teatro-fragranze-uniche-founders",
        category: "founders",
        statement: "Основатели бренда",
        status: "needs_source",
      },
      {
        id: "teatro-fragranze-uniche-craft",
        category: "craft",
        statement: "Места и способы производства",
        status: "needs_source",
      },
      {
        id: "teatro-fragranze-uniche-materials",
        category: "materials",
        statement: "Составы и парфюмерные пирамиды",
        status: "needs_source",
      },
    ],
  },
  {
    slug: "ladenac",
    name: "Ladenac",
    claims: [
      {
        id: "ladenac-origin",
        category: "origin",
        statement: "Страна и город происхождения бренда (по названию не определяются)",
        status: "needs_source",
      },
      {
        id: "ladenac-founding",
        category: "founding",
        statement: "Год основания бренда",
        status: "needs_source",
      },
      {
        id: "ladenac-founders",
        category: "founders",
        statement: "Основатели бренда",
        status: "needs_source",
      },
      {
        id: "ladenac-philosophy",
        category: "philosophy",
        statement: "Философия и позиционирование бренда",
        status: "needs_source",
      },
      {
        id: "ladenac-craft",
        category: "craft",
        statement: "Места и способы производства",
        status: "needs_source",
      },
      {
        id: "ladenac-materials",
        category: "materials",
        statement: "Составы, парфюмерные пирамиды, материалы",
        status: "needs_source",
      },
      {
        id: "ladenac-awards",
        category: "awards",
        statement: "Награды и упоминания в прессе",
        status: "needs_source",
      },
    ],
  },
  {
    slug: "millefiori-milano",
    name: "Millefiori Milano",
    claims: [
      {
        id: "millefiori-milano-origin-name",
        category: "origin",
        statement: "Слово «Milano» в названии бренда указывает на Милан, Италию.",
        status: "verified",
        source: "catalog: official brand name «Millefiori Milano»",
      },
      {
        id: "millefiori-milano-name-lex",
        category: "origin",
        statement: "«Millefiori» — итальянское слово, дословно «тысяча цветов».",
        status: "verified",
        source: "catalog: official brand name «Millefiori Milano»",
      },
      {
        id: "millefiori-milano-founding",
        category: "founding",
        statement: "Год основания бренда",
        status: "needs_source",
      },
      {
        id: "millefiori-milano-founders",
        category: "founders",
        statement: "Основатели бренда",
        status: "needs_source",
      },
      {
        id: "millefiori-milano-philosophy",
        category: "philosophy",
        statement: "Философия и позиционирование бренда",
        status: "needs_source",
      },
      {
        id: "millefiori-milano-craft",
        category: "craft",
        statement: "Места и способы производства",
        status: "needs_source",
      },
      {
        id: "millefiori-milano-sustainability",
        category: "sustainability",
        statement: "Экологические инициативы бренда",
        status: "needs_source",
      },
    ],
  },
];

export function getBrandBySlug(slug: string): Brand | undefined {
  return BRANDS.find((brand) => brand.slug === slug);
}
