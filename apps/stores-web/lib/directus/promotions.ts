import { mockPromotions } from "@/lib/data/mock-data";
import type { Promotion } from "@/types/promotion";
import { readDirectusItems } from "./client";
import { normalizePromotion } from "./mappers";

const fields = ["*", "brand_id.*", "city_id.*", "image.*"];

export async function getPromotions(): Promise<Promotion[]> {
  const directusItems = await readDirectusItems<Record<string, unknown>>("promotions", fields);
  if (!directusItems) return mockPromotions;
  return directusItems.map(normalizePromotion);
}
