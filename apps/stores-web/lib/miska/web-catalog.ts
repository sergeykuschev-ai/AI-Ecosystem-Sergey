import type { Category } from "@/types/category";

// These categories belong to physical-store procurement/sales, not the web catalog.
const OFFLINE_CATEGORY = /паразит|блох|клещ|parasiti|parazit|bloh|klesh|\bfleas?\b|\bticks?\b|deworm/i;

/** Exclude Miska's offline-only categories and descendants without mutating CMS data. */
export function excludeMiskaOfflineCategories(categories: Category[], miskaBrandId?: string): Category[] {
  const excluded = new Set(categories.filter((category) =>
    category.brand_id === miskaBrandId && OFFLINE_CATEGORY.test(category.name + " " + category.slug),
  ).map((category) => category.id));
  let previousSize: number;
  do {
    previousSize = excluded.size;
    for (const category of categories) {
      if (category.parent_id && excluded.has(category.parent_id)) excluded.add(category.id);
    }
  } while (excluded.size !== previousSize);
  return categories.filter((category) => !excluded.has(category.id));
}
