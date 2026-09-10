import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ANALYTICS_DEDUPE_WINDOW_MS,
  analyticsEvents,
  configureAnalytics,
  resetAnalyticsForTests,
  trackEvent,
  type AnalyticsAdapter,
  type AnalyticsEventName,
  type AnalyticsPayload,
} from "@/lib/analytics";
import { YANDEX_METRIKA_COUNTER_ID, YandexMetrikaAdapter } from "@/lib/analytics/yandex-metrika";

function createRecordingAdapter() {
  const calls: Array<{ event: AnalyticsEventName; payload?: AnalyticsPayload }> = [];
  const adapter: AnalyticsAdapter = {
    track(event, payload) {
      calls.push({ event, payload });
    },
  };
  return { adapter, calls };
}

function withFakeWindow<T>(fakeWindow: unknown, run: () => T): T {
  const globals = globalThis as Record<string, unknown>;
  const hadWindow = "window" in globals;
  const originalWindow = globals.window;
  globals.window = fakeWindow;
  try {
    return run();
  } finally {
    if (hadWindow) {
      globals.window = originalWindow;
    } else {
      delete globals.window;
    }
  }
}

describe("analytics event registry", () => {
  test("keeps the documented stable goal names", () => {
    assert.deepEqual([...analyticsEvents].sort(), [
      "bonus_open",
      "brand_open",
      "check_stock",
      "click_messenger",
      "click_phone",
      "click_route",
      "promotion_open",
      "store_open",
      "vacancy_open",
    ]);
  });
});

describe("trackEvent", () => {
  test("forwards events to the configured adapter", () => {
    resetAnalyticsForTests();
    const { adapter, calls } = createRecordingAdapter();
    configureAnalytics(adapter);

    trackEvent("click_phone", { brand: "amper", store: "amper-amursk" });

    assert.deepEqual(calls, [{ event: "click_phone", payload: { brand: "amper", store: "amper-amursk" } }]);
  });

  test("suppresses an identical event+payload fired twice in a row", () => {
    resetAnalyticsForTests();
    const { adapter, calls } = createRecordingAdapter();
    configureAnalytics(adapter);

    trackEvent("click_phone", { brand: "amper" });
    trackEvent("click_phone", { brand: "amper" });
    trackEvent("click_phone", { brand: "amper" });

    assert.equal(calls.length, 1);
  });

  test("treats payloads with the same keys in a different order as duplicates", () => {
    resetAnalyticsForTests();
    const { adapter, calls } = createRecordingAdapter();
    configureAnalytics(adapter);

    trackEvent("store_open", { city: "amursk", store: "amper-amursk" });
    trackEvent("store_open", { store: "amper-amursk", city: "amursk" });

    assert.equal(calls.length, 1);
  });

  test("does not suppress distinct payloads or distinct events", () => {
    resetAnalyticsForTests();
    const { adapter, calls } = createRecordingAdapter();
    configureAnalytics(adapter);

    trackEvent("click_phone", { brand: "amper" });
    trackEvent("click_phone", { brand: "ventil" });
    trackEvent("click_route", { brand: "amper" });

    assert.equal(calls.length, 3);
  });

  test("fires an identical event+payload again after the dedupe window", () => {
    resetAnalyticsForTests();
    const { adapter, calls } = createRecordingAdapter();
    configureAnalytics(adapter);

    const realDateNow = Date.now;
    let fakeNow = 10_000;
    Date.now = () => fakeNow;
    try {
      trackEvent("bonus_open", { source: "nav" });
      fakeNow += ANALYTICS_DEDUPE_WINDOW_MS - 1;
      trackEvent("bonus_open", { source: "nav" });
      fakeNow += ANALYTICS_DEDUPE_WINDOW_MS + 1;
      trackEvent("bonus_open", { source: "nav" });
    } finally {
      Date.now = realDateNow;
    }

    assert.equal(calls.length, 2);
  });

  test("never throws when the adapter fails", () => {
    resetAnalyticsForTests();
    configureAnalytics({
      track() {
        throw new Error("counter blocked");
      },
    });

    assert.doesNotThrow(() => trackEvent("click_phone", { brand: "amper" }));
  });
});

describe("YandexMetrikaAdapter", () => {
  test("keeps the production counter id", () => {
    assert.equal(YANDEX_METRIKA_COUNTER_ID, 112116056);
  });

  test("is a no-op on the server where window is undefined", () => {
    assert.equal(typeof window, "undefined");
    const adapter = new YandexMetrikaAdapter();
    assert.doesNotThrow(() => adapter.track("click_phone", { brand: "amper" }));
  });

  test("is a no-op when window.ym is unavailable", () => {
    const adapter = new YandexMetrikaAdapter();
    withFakeWindow({}, () => {
      assert.doesNotThrow(() => adapter.track("click_phone", { brand: "amper" }));
    });
    withFakeWindow({ ym: null }, () => {
      assert.doesNotThrow(() => adapter.track("click_phone", { brand: "amper" }));
    });
  });

  test("forwards reachGoal with the counter id and payload", () => {
    const calls: unknown[][] = [];
    const ym = (...args: unknown[]) => {
      calls.push(args);
    };

    withFakeWindow({ ym }, () => {
      const adapter = new YandexMetrikaAdapter();
      adapter.track("click_phone", { brand: "amper", store: "amper-amursk" });
      adapter.track("brand_open", { brand: "miska" });
      adapter.track("vacancy_open");
    });

    assert.deepEqual(calls, [
      [112116056, "reachGoal", "click_phone", { brand: "amper", store: "amper-amursk" }],
      [112116056, "reachGoal", "brand_open", { brand: "miska" }],
      [112116056, "reachGoal", "vacancy_open", {}],
    ]);
  });

  test("swallows errors thrown by ym so navigation is never blocked", () => {
    const ym = () => {
      throw new Error("ym blocked by an extension");
    };

    withFakeWindow({ ym }, () => {
      const adapter = new YandexMetrikaAdapter();
      assert.doesNotThrow(() => adapter.track("click_route", { brand: "ventil" }));
    });
  });
});
