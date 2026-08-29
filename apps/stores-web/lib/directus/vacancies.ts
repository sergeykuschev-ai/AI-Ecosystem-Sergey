import { mockVacancies } from "@/lib/data/mock-data";
import type { Vacancy } from "@/types/vacancy";
import { readDirectusItems } from "./client";

export async function getVacancies(): Promise<Vacancy[]> {
  return (await readDirectusItems<Vacancy>("vacancies")) ?? mockVacancies;
}
