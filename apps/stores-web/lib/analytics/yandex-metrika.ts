import type { AnalyticsAdapter, AnalyticsEventName, AnalyticsPayload } from "./index";

export const YANDEX_METRIKA_COUNTER_ID = 112116056;

declare global {
  interface Window {
    ym?: (id: number, method: string, ...args: unknown[]) => void;
  }
}

export class YandexMetrikaAdapter implements AnalyticsAdapter {
  track(event: AnalyticsEventName, payload?: AnalyticsPayload): void {
    if (typeof window === "undefined") return;

    const ym = window.ym;
    if (typeof ym !== "function") return;

    try {
      ym(YANDEX_METRIKA_COUNTER_ID, "reachGoal", event, payload ?? {});
    } catch {
      // A blocked or failing counter must never break the interface.
    }
  }
}
