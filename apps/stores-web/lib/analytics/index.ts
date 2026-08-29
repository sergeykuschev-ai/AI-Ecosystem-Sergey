export const analyticsEvents = [
  "click_phone",
  "click_route",
  "click_messenger",
  "check_stock",
  "brand_open",
  "store_open",
  "promotion_open",
  "bonus_open",
  "vacancy_open",
] as const;

export type AnalyticsEventName = (typeof analyticsEvents)[number];
export type AnalyticsPayload = Record<string, string | number | boolean | null>;

export interface AnalyticsAdapter {
  track(event: AnalyticsEventName, payload?: AnalyticsPayload): void;
}

class NoopAnalyticsAdapter implements AnalyticsAdapter {
  track(): void {}
}

let adapter: AnalyticsAdapter = new NoopAnalyticsAdapter();

export function configureAnalytics(nextAdapter: AnalyticsAdapter): void {
  adapter = nextAdapter;
}

export function trackEvent(event: AnalyticsEventName, payload?: AnalyticsPayload): void {
  adapter.track(event, payload);
}
