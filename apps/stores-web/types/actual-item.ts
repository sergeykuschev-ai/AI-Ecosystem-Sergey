import type { EntityId } from "./common";

export type ActualItemType =
  | "promotion"
  | "announcement"
  | "vacancy"
  | "bonus"
  | "general";

export type ActualItemImageOrientation = "landscape" | "portrait";

export interface ActualItem {
  id: EntityId;
  type: ActualItemType;
  brandId: EntityId | null;
  title: string;
  shortText: string;
  image: string | null;
  imageAlt: string | null;
  imageOrientation?: ActualItemImageOrientation;
  badge: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  active: boolean;
  showOnHome?: boolean;
}
