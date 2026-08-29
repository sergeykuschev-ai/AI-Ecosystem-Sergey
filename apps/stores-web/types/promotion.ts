import type { EntityId, TimestampedEntity } from "./common";

export interface Promotion extends TimestampedEntity {
  id: EntityId;
  title: string;
  slug: string;
  brand_id: EntityId | null;
  city_id: EntityId | null;
  store_ids: EntityId[];
  start_date: string | null;
  end_date: string | null;
  short_description: string;
  description: string;
  image: string | null;
  terms: string;
  active: boolean;
  seo_title: string;
  seo_description: string;
}
