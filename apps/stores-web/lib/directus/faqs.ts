import { mockFaqs } from "@/lib/data/mock-data";
import type { FAQ } from "@/types/faq";
import { readDirectusItems } from "./client";

export async function getFaqs(): Promise<FAQ[]> {
  return (await readDirectusItems<FAQ>("faqs")) ?? mockFaqs;
}
