import { mockFaqs } from "@/lib/data/mock-data";
import type { FAQ } from "@/types/faq";
import { readDirectusItems } from "./client";
import { normalizeFaq } from "./mappers";

const fields = ["*", "brand_id.*", "city_id.*", "store_id.*", "category_id.*"];

export async function getFaqs(): Promise<FAQ[]> {
  const directusItems = await readDirectusItems<Record<string, unknown>>(
    "faqs",
    fields,
    "filter[active][_eq]=true&sort[]=sort_order",
  );
  if (!directusItems) return mockFaqs;
  return directusItems.map(normalizeFaq);
}
