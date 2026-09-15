import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MiskaSeoCategoryPage } from "@/components/miska/MiskaSeoCategoryPage";
import { MISKA_SEO_CATEGORIES } from "@/lib/miska/seo-categories";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ category: string }>;
}

function resolveCategory(slug: string) {
  return MISKA_SEO_CATEGORIES.find((item) => item.slug === slug);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category: slug } = await params;
  const category = resolveCategory(slug);
  if (!category) notFound();

  return createPageMetadata({
    title: category.metaTitle,
    description: category.metaDescription,
    path: `/miska/${category.slug}/`,
  });
}

export default async function Page({ params }: PageProps) {
  const { category: slug } = await params;
  const category = resolveCategory(slug);
  if (!category) notFound();

  return <MiskaSeoCategoryPage category={category} />;
}
