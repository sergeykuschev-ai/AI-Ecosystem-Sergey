import type { EntityId, TimestampedEntity } from "./common";

export interface Category extends TimestampedEntity {
  id: EntityId;
  brand_id: EntityId;
  parent_id: EntityId | null;
  name: string;
  slug: string;
  short_description: string;
  description: string;
  image: string | null;
  sort_order: number;
  active: boolean;
}
