import { mockStores } from "@/lib/data/mock-data";
import type { Store } from "@/types/store";
import { readDirectusItems } from "./client";

export async function getStores(): Promise<Store[]> {
  return (await readDirectusItems<Store>("stores")) ?? mockStores;
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
