import type { EntityId, LinkItem, TimestampedEntity } from "./common";

export interface OpeningHoursEntry {
  days: string[];
  opens: string | null;
  closes: string | null;
}

export interface Store extends TimestampedEntity {
  id: EntityId;
  brand_id: EntityId;
  city_id: EntityId;
  name: string;
  slug: string;
  address: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  telephone: string | null;
  email: string | null;
  opening_hours: OpeningHoursEntry[];
  short_description: string;
  description: string;
  facade_photo: string | null;
  entrance_photo: string | null;
  gallery: string[];
  map_links: LinkItem[];
  messenger_links: LinkItem[];
  active: boolean;
  temporarily_closed: boolean;
  seo_title: string;
  seo_description: string;
}
