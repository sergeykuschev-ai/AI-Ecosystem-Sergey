export type EntityId = string;

export interface TimestampedEntity {
  created_at: string;
  updated_at: string;
}

export interface LinkItem {
  label: string;
  url: string;
}
