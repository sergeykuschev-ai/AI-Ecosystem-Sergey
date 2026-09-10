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

function formatDays(days: string[]): string {
  if (days.length === 0) return "";
  const labels = days.map((day) => dayLabels[day] ?? day);
  if (labels.length === 1) return labels[0];
  const dayIndex = (label: string) => Object.values(dayLabels).indexOf(label);
  let consecutive = true;
  for (let i = 1; i < labels.length; i++) {
    if (dayIndex(labels[i]) - dayIndex(labels[i - 1]) !== 1) {
      consecutive = false;
      break;
    }
  }
  if (consecutive) {
    return `${labels[0]}–${labels[labels.length - 1]}`;
  }
  return labels.join(", ");
}

export function StoreHours({ hours }: { hours: OpeningHoursEntry[] }) {
  if (!hours.length) return <p className="placeholder">[OPENING_HOURS_NOT_SET]</p>;
  return (
    <dl className="hours-list">
      {hours.map((entry) => (
        <div key={entry.days.join("-")}>
          <dt>{formatDays(entry.days)}</dt>
          <dd>{entry.opens && entry.closes ? `${entry.opens}–${entry.closes}` : "Не указано"}</dd>
        </div>
      ))}
    </dl>
  );
}
