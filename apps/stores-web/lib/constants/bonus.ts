import type { CanonicalBrandSlug } from "./brands";

export const BONUS_EARN_RATE = "5%";
export const BONUS_SPEND_CAP_PERCENT = 15;
export const BONUS_SPEND_CAP_LABEL = "до 15%";
export const BONUS_VALIDITY_MONTHS = 3;
export const BONUS_VALIDITY_LABEL = "3 месяца";

export const BONUS_CARD_THRESHOLDS_RUB: Record<CanonicalBrandSlug, number> = {
  amper: 3500,
  ventil: 3500,
  "metiz-market": 3500,
  miska: 2000,
};

export function formatRubles(amount: number): string {
  const grouped = String(Math.trunc(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped} ₽`;
}
