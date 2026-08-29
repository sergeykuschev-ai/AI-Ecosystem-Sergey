import type { Vacancy } from "@/types/vacancy";

export function VacancyCard({ vacancy }: { vacancy: Vacancy }) {
  return <article className="card"><h2>{vacancy.title}</h2><p>{vacancy.description}</p></article>;
}
