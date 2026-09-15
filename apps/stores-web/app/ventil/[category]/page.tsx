import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VentilSeoCategoryPage } from "@/components/ventil/VentilSeoCategoryPage";
import { VENTIL_SEO_CATEGORIES } from "@/lib/ventil/seo-categories";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ category: string }>;
}

function resolveCategory(slug: string) {
  return VENTIL_SEO_CATEGORIES.find((item) => item.slug === slug);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category: slug } = await params;
  const category = resolveCategory(slug);
  if (!category) notFound();

  return createPageMetadata({
    title: category.metaTitle,
    description: category.metaDescription,
    path: `/ventil/${category.slug}/`,
  });
}

export default async function Page({ params }: PageProps) {
  const { category: slug } = await params;
  const category = resolveCategory(slug);
  if (!category) notFound();

  return <VentilSeoCategoryPage category={category} />;
}
