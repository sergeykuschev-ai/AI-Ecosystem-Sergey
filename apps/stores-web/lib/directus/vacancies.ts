import { mockVacancies } from "@/lib/data/mock-data";
import type { Vacancy } from "@/types/vacancy";
import { readDirectusItems } from "./client";
import { normalizeVacancy } from "./mappers";

const fields = ["*", "brand_id.*", "store_id.*"];

export async function getVacancies(): Promise<Vacancy[]> {
  const directusItems = await readDirectusItems<Record<string, unknown>>("vacancies", fields);
  if (!directusItems) return mockVacancies;
  return directusItems.map(normalizeVacancy);
}
