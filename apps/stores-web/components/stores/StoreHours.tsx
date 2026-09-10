import type { OpeningHoursEntry } from "@/types/store";
import { getFormattedOpeningHours } from "./opening-hours";

export function StoreHours({ hours }: { hours: OpeningHoursEntry[] }) {
  if (!hours.length) return <p className="placeholder">[OPENING_HOURS_NOT_SET]</p>;
  return (
    <dl className="hours-list">
      {getFormattedOpeningHours(hours).map((entry) => (
        <div key={entry.key}>
          <dt>{entry.days}</dt>
          <dd>{entry.time ?? "Не указано"}</dd>
        </div>
      ))}
    </dl>
  );
}
