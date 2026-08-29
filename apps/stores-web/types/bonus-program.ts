import type { EntityId } from "./common";
import type { FAQ } from "./faq";

export interface BonusProgram {
  id: EntityId;
  title: string;
  short_description: string;
  description: string;
  rules: string[];
  participating_brands: EntityId[];
  faq: FAQ[];
  active: boolean;
  updated_at: string;
}
