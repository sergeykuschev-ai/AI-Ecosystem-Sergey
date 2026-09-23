import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MiskaCatalogPreviewGrid, type PreviewProduct } from "@/components/miska/MiskaCatalogPreviewGrid";
import { getMiskaCatalogPreview } from "@/lib/miska/catalog";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ section: string }>;
}

function decodeSection(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { section: rawSection } = await params;
  const section = decodeSection(rawSection);
  if (section === "all") {
    return { title: "Все товары — проверка каталога Миски", robots: { index: false, follow: false } };
  }
  const { categories } = await getMiskaCatalogPreview();
  const selected = categories.find((category) => category.slug === section);
  return {
    title: selected ? `${selected.name} — проверка каталога` : "Каталог «Миски» — проверка",
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: PageProps) {
  const { section: rawSection } = await params;
  const section = decodeSection(rawSection);
  const { categories, products } = await getMiskaCatalogPreview();
  const root = categories.find((category) => category.name === "МИСКА ЗООТОВАРЫ");
  if (!root) notFound();

  const selected = section === "all"
    ? root
    : categories.find((category) => category.slug === section);
  if (!selected) notFound();

  const byId = new Map(categories.map((category) => [category.external_id, category]));
  const belongsToSection = (categoryId: string | null) => {
    if (section === "all") return true;
    let category = categoryId ? byId.get(categoryId) : undefined;
    const seen = new Set<string>();
    while (category && !seen.has(category.external_id)) {
      if (category.external_id === selected.external_id) return true;
      seen.add(category.external_id);
      category = category.parent_external_id ? byId.get(category.parent_external_id) : undefined;
    }
    return false;
  };

  const firstGroupBelowSelected = (categoryId: string | null) => {
    let category = categoryId ? byId.get(categoryId) : undefined;
    const seen = new Set<string>();
    if (!category) return null;
    while (category && !seen.has(category.external_id)) {
      seen.add(category.external_id);
      if (category.parent_external_id === selected.external_id) return category;
      if (category.external_id === selected.external_id) return category;
      category = category.parent_external_id ? byId.get(category.parent_external_id) : undefined;
    }
    return null;
  };

  const rows: PreviewProduct[] = products
    .filter((product) => belongsToSection(product.category_external_id))
    .map((product) => {
      const exactCategory = product.category_external_id ? byId.get(product.category_external_id) : undefined;
      const group = firstGroupBelowSelected(product.category_external_id);
      return {
        externalId: product.external_id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        price: product.price,
        stockQuantity: product.stock_quantity,
        groupId: group?.external_id ?? "__uncategorized",
        groupName: group?.name ?? "Без категории",
        categoryName: exactCategory?.name ?? "Без категории",
      };
    });

  const groupCounts = new Map<string, { id: string; name: string; count: number }>();
  for (const row of rows) {
    const existing = groupCounts.get(row.groupId);
    if (existing) existing.count += 1;
    else groupCounts.set(row.groupId, { id: row.groupId, name: row.groupName, count: 1 });
  }
  const groups = [...groupCounts.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const inStock = rows.filter((product) => Number(product.stockQuantity ?? 0) > 0).length;
  const noPrice = rows.filter((product) => product.price == null).length;
  const title = section === "all" ? "Все товары" : selected.name;

  return (
    <main className="page-shell brand-landing" data-brand="miska">
      <section className="brand-landing-section">
        <nav className="miska-catalog-breadcrumbs" aria-label="Хлебные крошки">
          <Link href="/miska/catalog-preview/">Каталог</Link>
          <span aria-hidden="true">/</span>
          <span>{title}</span>
        </nav>
        <p className="eyebrow">Каталог из 1С · закрытая проверка</p>
        <h1>{title}</h1>
        <div className="miska-catalog-mini-stats">
          <span><strong>{rows.length}</strong> товаров</span>
          <span><strong>{inStock}</strong> в наличии</span>
          <span><strong>{noPrice}</strong> без цены</span>
        </div>
      </section>

      <section className="brand-landing-section brand-landing-section--compact">
        <MiskaCatalogPreviewGrid products={rows} groups={groups} />
      </section>
    </main>
  );
}
