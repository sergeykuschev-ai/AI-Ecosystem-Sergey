import { mockActualItems } from "@/lib/data/mock-data";
import type { ActualItem } from "@/types/actual-item";
import { readDirectusItems } from "./client";
import { normalizeActualItem } from "./mappers";

function parseBoundary(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NaN : timestamp;
}

export function isActualItemVisible(item: ActualItem, now: Date): boolean {
  if (!item.active) return false;

  const startsAt = parseBoundary(item.startsAt);
  const endsAt = parseBoundary(item.endsAt);
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) return false;

  const currentTime = now.getTime();
  if (startsAt !== null && currentTime < startsAt) return false;
  if (endsAt !== null && currentTime > endsAt) return false;
  return true;
}

const fields = ["*", "brandId.*", "image.*"];

async function getVisibleActualItems(now: Date): Promise<ActualItem[]> {
  const directusItems = await readDirectusItems<Record<string, unknown>>("actual_items", fields);
  const items = directusItems?.map(normalizeActualItem) ?? mockActualItems;
  return items
    .filter((item) => isActualItemVisible(item, now))
    .sort((left, right) => right.priority - left.priority);
}

export async function getActualItems(now = new Date()): Promise<ActualItem[]> {
  return (await getVisibleActualItems(now)).filter((item) => item.showOnHome !== false);
}

export async function getActualItemsByBrand(brandId: string, now = new Date()): Promise<ActualItem[]> {
  return (await getVisibleActualItems(now)).filter((item) => item.brandId === brandId);
}
