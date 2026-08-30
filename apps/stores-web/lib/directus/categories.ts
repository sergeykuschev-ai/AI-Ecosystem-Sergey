import { mockCategories } from "@/lib/data/mock-data";
import type { Category } from "@/types/category";
import { readDirectusItems } from "./client";
import { normalizeCategory } from "./mappers";

const fields = ["*", "brand_id.*", "parent_id.*", "image.*"];

export async function getCategories(): Promise<Category[]> {
  const directusItems = await readDirectusItems<Record<string, unknown>>("categories", fields);
  if (!directusItems) return mockCategories;
  return directusItems.map(normalizeCategory);
}

export async function getCategoriesByBrand(brandId: string): Promise<Category[]> {
  return (await getCategories())
    .filter((category) => category.brand_id === brandId && category.active)
    .sort((left, right) => left.sort_order - right.sort_order);
}
