import type { EntityId, LinkItem, TimestampedEntity } from "./common";

export interface Brand extends TimestampedEntity {
  id: EntityId;
  slug: string;
  name: string;
  legal_name: string | null;
  logo: string | null;
  primary_color: string;
  secondary_color: string;
  short_description: string;
  description: string;
  seo_title: string;
  seo_description: string;
  social_links: LinkItem[];
  active: boolean;
}
