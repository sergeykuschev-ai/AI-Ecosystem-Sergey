import { mockCategories } from "@/lib/data/mock-data";
import type { Category } from "@/types/category";
import { readDirectusItems } from "./client";
import { normalizeCategory } from "./mappers";
import { getBrands } from "./brands";
import { excludeMiskaOfflineCategories } from "@/lib/miska/web-catalog";

const fields = ["*", "brand_id.*", "parent_id.*", "image.*"];

export async function getCategories(): Promise<Category[]> {
  const [directusItems, brands] = await Promise.all([
    readDirectusItems<Record<string, unknown>>("categories", fields), getBrands(),
  ]);
  const categories = directusItems ? directusItems.map(normalizeCategory) : mockCategories;
  return excludeMiskaOfflineCategories(categories, brands.find((brand) => brand.slug === "miska")?.id);
}

export async function getCategoriesByBrand(brandId: string): Promise<Category[]> {
  return (await getCategories())
    .filter((category) => category.brand_id === brandId && category.active)
    .sort((left, right) => left.sort_order - right.sort_order);
}
