import type { OpeningHoursEntry } from "@/types/store";

export function StoreHours({ hours }: { hours: OpeningHoursEntry[] }) {
  if (!hours.length) return <p className="placeholder">[OPENING_HOURS_NOT_SET]</p>;
  return (
    <dl className="hours-list">
      {hours.map((entry) => (
        <div key={entry.days.join("-")}>
          <dt>{entry.days.join(", ")}</dt>
          <dd>{entry.opens && entry.closes ? `${entry.opens}–${entry.closes}` : "Не указано"}</dd>
        </div>
      ))}
    </dl>
  );
}
