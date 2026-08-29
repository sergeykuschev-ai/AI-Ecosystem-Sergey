import { mockBonusProgram } from "@/lib/data/mock-data";
import type { BonusProgram } from "@/types/bonus-program";
import { readDirectusItems } from "./client";

export async function getBonusProgram(): Promise<BonusProgram | null> {
  const programs = await readDirectusItems<BonusProgram>("bonus_programs");
  return programs ? programs[0] ?? null : mockBonusProgram;
}
