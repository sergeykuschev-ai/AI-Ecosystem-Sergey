import type { OpeningHoursEntry } from "@/types/store";

const dayLabels: Record<string, string> = {
  Monday: "Пн",
  Tuesday: "Вт",
  Wednesday: "Ср",
  Thursday: "Чт",
  Friday: "Пт",
  Saturday: "Сб",
  Sunday: "Вс",
};

export function formatDays(days: string[]): string {
  const key = days.join(",");
  if (key === "Monday,Tuesday,Wednesday,Thursday,Friday") return "Пн–Пт";
  if (key === "Saturday,Sunday") return "Сб–Вс";
  return days.map((day) => dayLabels[day] ?? day).join(", ");
}

export interface FormattedOpeningHours {
  key: string;
  days: string;
  time: string | null;
}

export function getFormattedOpeningHours(hours: OpeningHoursEntry[]): FormattedOpeningHours[] {
  return hours.map((entry) => ({
    key: entry.days.join("-"),
    days: formatDays(entry.days),
    time: entry.opens && entry.closes ? `${entry.opens}–${entry.closes}` : null,
  }));
}
