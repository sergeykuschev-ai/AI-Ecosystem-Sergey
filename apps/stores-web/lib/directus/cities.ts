import { mockCities } from "@/lib/data/mock-data";
import type { City } from "@/types/city";
import { readDirectusItems } from "./client";
import { normalizeCity } from "./mappers";

const fields = ["*"];

export async function getCities(): Promise<City[]> {
  const directusItems = await readDirectusItems<Record<string, unknown>>("cities", fields);
  if (!directusItems) return mockCities;
  return directusItems.map(normalizeCity);
}

export async function getCityBySlug(slug: string): Promise<City | null> {
  return (await getCities()).find((city) => city.slug === slug && city.active) ?? null;
}
