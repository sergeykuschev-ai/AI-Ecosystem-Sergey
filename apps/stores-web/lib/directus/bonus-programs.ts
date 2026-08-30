import { mockBonusProgram } from "@/lib/data/mock-data";
import type { BonusProgram } from "@/types/bonus-program";
import { readDirectusSingleton } from "./client";
import { normalizeBonusProgram } from "./mappers";

const fields = ["*", "faq.*"];

export async function getBonusProgram(): Promise<BonusProgram | null> {
  const raw = await readDirectusSingleton<Record<string, unknown>>("bonus_programs", fields);
  if (!raw) return mockBonusProgram;
  return normalizeBonusProgram(raw);
}
