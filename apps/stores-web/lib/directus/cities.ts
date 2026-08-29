import { mockCities } from "@/lib/data/mock-data";
import type { City } from "@/types/city";
import { readDirectusItems } from "./client";

export async function getCities(): Promise<City[]> {
  return (await readDirectusItems<City>("cities")) ?? mockCities;
}

export async function getCityBySlug(slug: string): Promise<City | null> {
  return (await getCities()).find((city) => city.slug === slug && city.active) ?? null;
}
