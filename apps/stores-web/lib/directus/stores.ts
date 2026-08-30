import { mockStores } from "@/lib/data/mock-data";
import type { Store } from "@/types/store";
import { readDirectusItems } from "./client";
import { normalizeStore } from "./mappers";

const fields = ["*", "brand_id.*", "city_id.*", "facade_photo.*", "entrance_photo.*"];

export async function getStores(): Promise<Store[]> {
  const directusItems = await readDirectusItems<Record<string, unknown>>("stores", fields);
  if (!directusItems) return mockStores;
  return directusItems.map(normalizeStore);
}

export async function getStoresByCity(cityId: string): Promise<Store[]> {
  return (await getStores()).filter((store) => store.city_id === cityId && store.active);
}

export async function getStoresByBrand(brandId: string): Promise<Store[]> {
  return (await getStores()).filter((store) => store.brand_id === brandId && store.active);
}

export async function getStoreBySlug(cityId: string, slug: string): Promise<Store | null> {
  return (await getStores()).find(
    (store) => store.city_id === cityId && store.slug === slug && store.active,
  ) ?? null;
}
