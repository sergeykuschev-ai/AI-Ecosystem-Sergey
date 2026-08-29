import type { EntityId, TimestampedEntity } from "./common";

export interface Vacancy extends TimestampedEntity {
  id: EntityId;
  brand_id: EntityId;
  store_id: EntityId | null;
  title: string;
  salary_from: number | null;
  salary_to: number | null;
  schedule: string | null;
  employment_type: string | null;
  description: string;
  requirements: string;
  contact: string | null;
  active: boolean;
  published_at: string | null;
}
