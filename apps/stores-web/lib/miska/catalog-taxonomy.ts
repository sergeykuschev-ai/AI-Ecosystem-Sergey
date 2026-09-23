export const MISKA_CATALOG_SECTIONS = [
  { slug: "koshki", name: "Кошки" },
  { slug: "sobaki", name: "Собаки" },
  { slug: "koshki-i-sobaki", name: "Кошки и собаки" },
  { slug: "gryzuny", name: "Грызуны" },
  { slug: "ptitsy", name: "Птицы" },
  { slug: "ryby", name: "Рыбы" },
  { slug: "reptilii", name: "Рептилии" },
  { slug: "vetapteka", name: "Ветаптека" },
] as const;

export type MiskaCatalogSectionName = (typeof MISKA_CATALOG_SECTIONS)[number]["name"];

export function sectionBySlug(slug: string) {
  return MISKA_CATALOG_SECTIONS.find((section) => section.slug === slug) ?? null;
}

export function sectionByName(name: string | null) {
  return MISKA_CATALOG_SECTIONS.find((section) => section.name === name) ?? null;
}
