import type { EntityId } from "./common";

export interface FAQ {
  id: EntityId;
  question: string;
  answer: string;
  brand_id: EntityId | null;
  city_id: EntityId | null;
  store_id: EntityId | null;
  category_id: EntityId | null;
  sort_order: number;
  active: boolean;
}
