import { mockPromotions } from "@/lib/data/mock-data";
import type { Promotion } from "@/types/promotion";
import { readDirectusItems } from "./client";

export async function getPromotions(): Promise<Promotion[]> {
  return (await readDirectusItems<Promotion>("promotions")) ?? mockPromotions;
}
