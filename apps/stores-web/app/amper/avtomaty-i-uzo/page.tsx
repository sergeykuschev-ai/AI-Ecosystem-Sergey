import type { Metadata } from "next";
import { AmperSeoCategoryPage } from "@/components/amper/AmperSeoCategoryPage";
import { getAmperSeoCategory } from "@/lib/amper/seo-categories";
import { createPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

const category = getAmperSeoCategory("avtomaty-i-uzo");

export const metadata: Metadata = createPageMetadata({
  title: category.metaTitle,
  description: category.metaDescription,
  path: `/amper/${category.slug}/`,
});

export default function Page() {
  return <AmperSeoCategoryPage category={category} />;
}
