import type { EntityId, TimestampedEntity } from "./common";

export interface City extends TimestampedEntity {
  id: EntityId;
  slug: string;
  name: string;
  region: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
}
