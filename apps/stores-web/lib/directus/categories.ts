import { mockCategories } from "@/lib/data/mock-data";
import type { Category } from "@/types/category";
import { readDirectusItems } from "./client";

export async function getCategories(): Promise<Category[]> {
  return (await readDirectusItems<Category>("categories")) ?? mockCategories;
}

export async function getCategoriesByBrand(brandId: string): Promise<Category[]> {
  return (await getCategories())
    .filter((category) => category.brand_id === brandId && category.active)
    .sort((left, right) => left.sort_order - right.sort_order);
}
