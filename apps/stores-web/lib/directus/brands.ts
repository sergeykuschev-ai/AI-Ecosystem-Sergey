import { mockBrands } from "@/lib/data/mock-data";
import type { Brand } from "@/types/brand";
import { readDirectusItems } from "./client";
import { normalizeBrand } from "./mappers";

const fields = ["*"];

export async function getBrands(): Promise<Brand[]> {
  const directusItems = await readDirectusItems<Record<string, unknown>>("brands", fields);
  if (!directusItems) return mockBrands;
  return directusItems.map(normalizeBrand);
}

export async function getBrandBySlug(slug: string): Promise<Brand | null> {
  const brands = await getBrands();
  return brands.find((brand) => brand.slug === slug && brand.active) ?? null;
}
