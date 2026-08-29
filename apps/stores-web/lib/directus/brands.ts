import { mockBrands } from "@/lib/data/mock-data";
import type { Brand } from "@/types/brand";
import { readDirectusItems } from "./client";

export async function getBrands(): Promise<Brand[]> {
  return (await readDirectusItems<Brand>("brands")) ?? mockBrands;
}

export async function getBrandBySlug(slug: string): Promise<Brand | null> {
  const brands = await getBrands();
  return brands.find((brand) => brand.slug === slug && brand.active) ?? null;
}
