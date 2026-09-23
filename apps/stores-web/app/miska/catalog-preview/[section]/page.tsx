import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MiskaCatalogPreviewGrid, type PreviewProduct } from "@/components/miska/MiskaCatalogPreviewGrid";
import { getMiskaCatalogPreview } from "@/lib/miska/catalog";
import { sectionBySlug } from "@/lib/miska/catalog-taxonomy";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ section: string }>;
}

function titleForSlug(slug: string) {
  if (slug === "all") return "Все товары";
  if (slug === "review") return "Нужно проверить";
  return sectionBySlug(slug)?.name ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { section } = await params;
  const title = titleForSlug(section);
  return {
    title: title ? `${title} — проверка каталога Миски` : "Каталог «Миски» — проверка",
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: PageProps) {
  const { section } = await params;
  const title = titleForSlug(section);
  if (!title) notFound();

  const { products } = await getMiskaCatalogPreview();
  const sectionDef = sectionBySlug(section);
  const filtered = products.filter((product) => {
    if (section === "all") return true;
    if (section === "review") return product.classification_status === "review";
    return product.site_section === sectionDef?.name;
  });

  const rows: PreviewProduct[] = filtered.map((product) => ({
    externalId: product.external_id,
    name: product.site_name || product.name,
    sourceName: product.name,
    sku: product.sku,
    barcode: product.barcode,
    price: product.price,
    stockQuantity: product.stock_quantity,
    groupId: product.site_category || "Прочее",
    groupName: product.site_category || "Прочее",
    categoryName: product.site_category || "Прочее",
    subcategoryName: product.site_subcategory,
    brand: product.brand,
    classificationStatus: product.classification_status,
    classificationConfidence: product.classification_confidence,
  }));

  const groupCounts = new Map<string, { id: string; name: string; count: number }>();
  const brandCounts = new Map<string, number>();
  for (const row of rows) {
    const existing = groupCounts.get(row.groupId);
    if (existing) existing.count += 1;
    else groupCounts.set(row.groupId, { id: row.groupId, name: row.groupName, count: 1 });
    if (row.brand) brandCounts.set(row.brand, (brandCounts.get(row.brand) ?? 0) + 1);
  }
  const groups = [...groupCounts.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const brands = [...brandCounts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const inStock = rows.filter((product) => Number(product.stockQuantity ?? 0) > 0).length;
  const noPrice = rows.filter((product) => product.price == null).length;

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
          <span><strong>{brands.length}</strong> брендов</span>
        </div>
      </section>

      <section className="brand-landing-section brand-landing-section--compact">
        <MiskaCatalogPreviewGrid products={rows} groups={groups} brands={brands} />
      </section>
    </main>
  );
}
