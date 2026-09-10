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

export const ANALYTICS_DEDUPE_WINDOW_MS = 1000;

let adapter: AnalyticsAdapter = new NoopAnalyticsAdapter();
let lastSignature: string | null = null;
let lastTimestamp = 0;

function eventSignature(event: AnalyticsEventName, payload: AnalyticsPayload): string {
  const entries = Object.keys(payload)
    .sort()
    .map((key) => `${key}:${String(payload[key])}`);
  return `${event}|${entries.join("|")}`;
}

export function configureAnalytics(nextAdapter: AnalyticsAdapter): void {
  adapter = nextAdapter;
}

export function trackEvent(event: AnalyticsEventName, payload?: AnalyticsPayload): void {
  const now = Date.now();
  const signature = eventSignature(event, payload ?? {});
  if (signature === lastSignature && now - lastTimestamp < ANALYTICS_DEDUPE_WINDOW_MS) {
    return;
  }
  lastSignature = signature;
  lastTimestamp = now;

  try {
    adapter.track(event, payload);
  } catch {
    // Analytics must never break navigation or the interface.
  }
}

export function resetAnalyticsForTests(): void {
  adapter = new NoopAnalyticsAdapter();
  lastSignature = null;
  lastTimestamp = 0;
}
