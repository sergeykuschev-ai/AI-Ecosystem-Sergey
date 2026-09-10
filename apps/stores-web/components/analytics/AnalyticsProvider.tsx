"use client";

import { useEffect } from "react";
import { configureAnalytics } from "@/lib/analytics";
import { YandexMetrikaAdapter } from "@/lib/analytics/yandex-metrika";

export function AnalyticsProvider() {
  useEffect(() => {
    configureAnalytics(new YandexMetrikaAdapter());
  }, []);

  return null;
}
