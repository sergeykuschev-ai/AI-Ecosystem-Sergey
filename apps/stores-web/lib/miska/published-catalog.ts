/**
 * Publication manifest of the static «Миска» catalog section.
 *
 * The catalog pages (/miska/katalog/, category and product pages) are served
 * by Caddy as a static bundle (see docs/MISKA_STATIC_SECTION.md); they are not
 * Next.js routes, so nothing else in the app can discover them. This manifest
 * is the in-repo source of truth for which of those pages are published and
 * indexable. It was derived from the release manifest of the published bundle
 * (issue #279) and cross-checked against the live site on 2026-11-02:
 * every listed URL returned HTTP 200 with a self-referencing canonical and
 * an `index, follow` robots policy.
 *
 * Rules:
 * - only entries with `published: true` may appear in any sitemap;
 * - a `published: false` entry must not be reachable or listed anywhere;
 * - slugs are the canonical trailing-slash route segment under /miska/tovary/;
 * - names are the verified product names from the pages' Product JSON-LD,
 *   never invented marketing text.
 */

export interface MiskaCatalogCategory {
  slug: string;
  /** Display name as published in the category page H1. */
  title: string;
}

export interface MiskaCatalogProduct {
  slug: string;
  /** Verified product name from the page Product JSON-LD. */
  name: string;
  /**
   * Shortened <title> proposal (<= 70 chars) per the documented rule:
   * keep product type, brand/line when significant, purpose, key variant and
   * package size; append the local suffix only when it fits. Applied at the
   * next regeneration of the static bundle, not retrofitted into live HTML.
   */
  shortTitle: string;
  sku: string;
  ean: string;
  /** Category slugs the product is listed under (facets may overlap). */
  categories: string[];
  published: boolean;
}

export const MISKA_CATALOG_HOME_PATH = "/miska/katalog/";

export const MISKA_CATALOG_CATEGORIES: readonly MiskaCatalogCategory[] = [
  { slug: "dlya-koshek", title: "Корма и наполнители для кошек" },
  { slug: "dlya-sobak", title: "Корма и лакомства для собак" },
  { slug: "suhie-korma", title: "Сухие корма для кошек и собак" },
  { slug: "vlazhnye-korma", title: "Влажные корма для кошек" },
  { slug: "lakomstva", title: "Лакомства для собак" },
  { slug: "napolniteli", title: "Наполнители для кошачьего туалета" },
];

export const MISKA_CATALOG_PRODUCTS: readonly MiskaCatalogProduct[] = [
  {
    slug: "bumazhnyy-komkuyuschiysya-napolnitel-cat-s-choice-s-tsvetovym-indikatorom-komka-6-cch544650",
    name: "Бумажный комкующийся наполнитель Cat's choice с цветовым индикатором комка 6 л/1,5 кг",
    shortTitle: "Наполнитель Cat's Choice с индикатором комка 6 л — «Миска», Амурск",
    sku: "CCH544650",
    ean: "4620202544650",
    categories: ["dlya-koshek", "napolniteli"],
    published: true,
  },
  {
    slug: "lakomstvo-mnyams-na-kazhdyy-den-dlya-sobak-grudki-kurinye-50-g-33046",
    name: "Лакомство Мнямс На каждый день для собак Грудки куриные 50 г",
    shortTitle: "Лакомство Мнямс для собак Грудки куриные 50 г — «Миска», Амурск",
    sku: "33046",
    ean: "4610011705939",
    categories: ["dlya-sobak", "lakomstva"],
    published: true,
  },
  {
    slug: "lakomstvo-mnyams-na-kazhdyy-den-dlya-sobak-legkoe-barane-70-g-33036",
    name: "Лакомство Мнямс На каждый день для собак Легкое баранье 70 г",
    shortTitle: "Лакомство Мнямс для собак Легкое баранье 70 г — «Миска», Амурск",
    sku: "33036",
    ean: "4610011705793",
    categories: ["dlya-sobak", "lakomstva"],
    published: true,
  },
  {
    slug: "lakomstvo-mnyams-na-kazhdyy-den-dlya-sobak-ushi-govyazhi-85-g-33040",
    name: "Лакомство Мнямс На каждый день для собак Уши говяжьи 85 г",
    shortTitle: "Лакомство Мнямс для собак Уши говяжьи 85 г — «Миска», Амурск",
    sku: "33040",
    ean: "4610011705908",
    categories: ["dlya-sobak", "lakomstva"],
    published: true,
  },
  {
    slug: "lakomstvo-mnyams-na-kazhdyy-den-dlya-sobak-ushi-krolichi-65-g-33050",
    name: "Лакомство Мнямс На каждый день для собак Уши кроличьи 65 г",
    shortTitle: "Лакомство Мнямс для собак Уши кроличьи 65 г — «Миска», Амурск",
    sku: "33050",
    ean: "4610011706004",
    categories: ["dlya-sobak", "lakomstva"],
    published: true,
  },
  {
    slug: "rastitelnyy-komkuyuschiysya-napolnitel-cat-s-choice-s-ph-indikatorom-6l-2-cch549570",
    name: "Растительный комкующийся наполнитель Cat's choice с pH-индикатором 6л/2,5 кг",
    shortTitle: "Наполнитель Cat's Choice с pH-индикатором 6 л — «Миска», Амурск",
    sku: "CCH549570",
    ean: "4620202549570",
    categories: ["dlya-koshek", "napolniteli"],
    published: true,
  },
  {
    slug: "rastitelnyy-komkuyuschiysya-napolnitel-tofu-cat-s-choice-s-aromatom-kofe-6-cch544551",
    name: "Растительный комкующийся наполнитель тофу Cat's choice с ароматом \"Кофе\" 6 л/2,5 кг",
    shortTitle: "Наполнитель тофу Cat's Choice «Кофе» 6 л — «Миска», Амурск",
    sku: "CCH544551",
    ean: "4620202544551",
    categories: ["dlya-koshek", "napolniteli"],
    published: true,
  },
  {
    slug: "suhoy-korm-award-indeyka-kuritsa-srednie-porody-2kg-7173440",
    name: "Сухой корм AWARD для взрослых собак средних пород с индейкой и курицей с добавлением моркови и черной смородины 2кг",
    shortTitle: "Сухой корм AWARD для собак с индейкой и курицей 2 кг — «Миска», Амурск",
    sku: "7173440",
    ean: "4630147173440",
    categories: ["dlya-sobak", "suhie-korma"],
    published: true,
  },
  {
    slug: "suhoy-korm-award-monoprotein-losos-koshki-400g-6201173",
    name: "Сухой корм AWARD Monoprotein для взрослых стерилизованных кошек из лосося с добавлением спаржи и ацеролы 400г",
    shortTitle: "Сухой корм AWARD Monoprotein для кошек, лосось 400 г — «Миска», Амурск",
    sku: "6201173",
    ean: "4680846201173",
    categories: ["dlya-koshek", "suhie-korma"],
    published: true,
  },
  {
    slug: "suhoy-korm-award-sterilized-belaya-ryba-koshki-1-5kg-7173617",
    name: "Сухой корм AWARD Sterilized для взрослых стерилизованных кошек с белой рыбой с добавлением семян льна, клюквы и цикория 1,5кг",
    shortTitle: "Сухой корм AWARD Sterilized для кошек, белая рыба 1,5 кг — «Миска»",
    sku: "7173617",
    ean: "4630147173617",
    categories: ["dlya-koshek", "suhie-korma"],
    published: true,
  },
  {
    slug: "suhoy-korm-award-sterilized-indeyka-kuritsa-koshki-1-5kg-7173587",
    name: "Сухой корм AWARD Sterilized для взрослых стерилизованных кошек с индейкой и курицей с добавлением клюквы и цикория 1,5кг",
    shortTitle: "Сухой корм AWARD Sterilized для кошек, индейка-курица 1,5 кг — «Миска»",
    sku: "7173587",
    ean: "4630147173587",
    categories: ["dlya-koshek", "suhie-korma"],
    published: true,
  },
  {
    slug: "suhoy-korm-award-yagnenok-indeyka-melkie-porody-10kg-7173419",
    name: "Сухой корм AWARD для взрослых собак мелких и миниатюрных пород с ягненком и индейкой с добавлением брокколи и брусники 10кг",
    shortTitle: "Сухой корм AWARD для собак, ягнёнок-индейка 10 кг — «Миска», Амурск",
    sku: "7173419",
    ean: "4630147173419",
    categories: ["dlya-sobak", "suhie-korma"],
    published: true,
  },
  {
    slug: "suhoy-korm-award-yagnenok-indeyka-shchenki-2kg-7173372",
    name: "Сухой корм AWARD для щенков от 1 месяца, беременных и кормящих сук всех пород с ягненком и индейкой с добавлением яблока и черники 2кг",
    shortTitle: "Сухой корм AWARD для щенков, ягнёнок-индейка 2 кг — «Миска», Амурск",
    sku: "7173372",
    ean: "4630147173372",
    categories: ["dlya-sobak", "suhie-korma"],
    published: true,
  },
  {
    slug: "suhoy-korm-craftia-natura-losos-seld-sobaki-640g-crf5426392",
    name: "Сухой корм CRAFTIA NATURA для взрослых собак миниатюрных и мелких пород из лосося с сельдью 640 г",
    shortTitle: "Сухой корм CRAFTIA NATURA для собак, лосось-сельдь 640 г — «Миска»",
    sku: "CRF5426392",
    ean: "7640335426392",
    categories: ["dlya-sobak", "suhie-korma"],
    published: true,
  },
  {
    slug: "suhoy-korm-monge-cat-daily-line-kuritsa-kotyata-400g-70004862",
    name: "Сухой корм Monge Cat Daily Line для котят и беременных кошек, из курицы 400 г",
    shortTitle: "Сухой корм Monge Cat Daily Line для котят, курица 400 г — «Миска»",
    sku: "70004862",
    ean: "8009470004862",
    categories: ["dlya-koshek", "suhie-korma"],
    published: true,
  },
  {
    slug: "vlazhnyy-korm-ferma-kota-fedora-myasnye-kusochki-dlya-koshek-s-utkoy-706066",
    name: "Влажный корм Ферма кота Фёдора мясные кусочки для кошек с уткой, кроликом и дичью 85г",
    shortTitle: "Влажный корм Ферма кота Фёдора для кошек с уткой 85 г — «Миска»",
    sku: "706066",
    ean: "4630147176328",
    categories: ["dlya-koshek", "vlazhnye-korma"],
    published: true,
  },
  {
    slug: "vlazhnyy-korm-ferma-kota-fedora-nezhnye-kusochki-s-telyatinoy-dlya-kotyat-706035",
    name: "Влажный корм Ферма кота Фёдора нежные кусочки с телятиной для котят 85г",
    shortTitle: "Влажный корм Ферма кота Фёдора для котят с телятиной 85 г — «Миска»",
    sku: "706035",
    ean: "4630147176342",
    categories: ["dlya-koshek", "vlazhnye-korma"],
    published: true,
  },
  {
    slug: "vlazhnyy-korm-ferma-kota-fedora-sochnye-kusochki-v-zhele-dlya-koshek-170463",
    name: "Влажный корм Ферма кота Фёдора сочные кусочки в желе для кошек с ягненком 85г",
    shortTitle: "Влажный корм Ферма кота Фёдора для кошек с ягнёнком 85 г — «Миска»",
    sku: "170463",
    ean: "4630147176397",
    categories: ["dlya-koshek", "vlazhnye-korma"],
    published: true,
  },
  {
    slug: "vlazhnyy-korm-mnyams-na-kazhdyy-den-kusochki-v-souse-s-indeykoy-34028",
    name: "Влажный корм Мнямс На каждый день Кусочки в соусе с индейкой для котят старше 1 месяца 85 г",
    shortTitle: "Влажный корм Мнямс для котят Кусочки в соусе с индейкой 85 г — «Миска»",
    sku: "34028",
    ean: "4620202540140",
    categories: ["dlya-koshek", "vlazhnye-korma"],
    published: true,
  },
  {
    slug: "vlazhnyy-korm-mnyams-na-kazhdyy-den-kusochki-v-souse-s-indeykoy-34075",
    name: "Влажный корм Мнямс На каждый день Кусочки в соусе с индейкой для выведения шерсти у кошек 85 г",
    shortTitle: "Влажный корм Мнямс для кошек Кусочки в соусе с индейкой 85 г — «Миска»",
    sku: "34075",
    ean: "4620202540164",
    categories: ["dlya-koshek", "vlazhnye-korma"],
    published: true,
  },
];

const KNOWN_CATEGORY_SLUGS = new Set(MISKA_CATALOG_CATEGORIES.map((category) => category.slug));

/** Products that pass the publication rule (the same rule the pages follow). */
export function getPublishedMiskaCatalogProducts(): MiskaCatalogProduct[] {
  return MISKA_CATALOG_PRODUCTS.filter((product) => product.published);
}

/** Canonical trailing-slash paths of every published indexable catalog page. */
export function getPublishedMiskaCatalogPaths(): string[] {
  const paths = [
    MISKA_CATALOG_HOME_PATH,
    ...MISKA_CATALOG_CATEGORIES.map((category) => `/miska/katalog/${category.slug}/`),
    ...getPublishedMiskaCatalogProducts().map((product) => `/miska/tovary/${product.slug}/`),
  ];
  return [...new Set(paths)].sort();
}

/** Throws when the manifest violates its own invariants; used by tests and tooling. */
export function assertMiskaCatalogManifestIntegrity(): void {
  const slugs = new Set<string>();
  for (const product of MISKA_CATALOG_PRODUCTS) {
    if (!/^[a-z0-9-]+$/.test(product.slug)) throw new Error(`Invalid product slug: ${product.slug}`);
    if (slugs.has(product.slug)) throw new Error(`Duplicate product slug: ${product.slug}`);
    slugs.add(product.slug);
    if (product.published && product.categories.length === 0) {
      throw new Error(`Published product ${product.slug} must belong to at least one category`);
    }
    for (const category of product.categories) {
      if (!KNOWN_CATEGORY_SLUGS.has(category)) {
        throw new Error(`Product ${product.slug} references unknown category: ${category}`);
      }
    }
    if (product.published) {
      if (!product.shortTitle.trim()) throw new Error(`Published product ${product.slug} needs a shortTitle`);
      if (product.shortTitle.length > 70) {
        throw new Error(`shortTitle of ${product.slug} is ${product.shortTitle.length} chars (> 70)`);
      }
    }
  }
}
