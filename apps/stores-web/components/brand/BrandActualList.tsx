import Image from "next/image";
import Link from "next/link";
import type { AnalyticsEventName } from "@/lib/analytics";
import { TrackedLink } from "@/components/analytics/TrackedLink";
import type { ActualItem, ActualItemType } from "@/types/actual-item";

const typeLabels: Record<ActualItemType, string> = {
  promotion: "Акция",
  announcement: "Объявление",
  vacancy: "Вакансия",
  bonus: "Бонусная программа",
  general: "Актуальное",
};

const typeEvents: Partial<Record<ActualItemType, AnalyticsEventName>> = {
  promotion: "promotion_open",
  vacancy: "vacancy_open",
  bonus: "bonus_open",
};

export function BrandActualList({ items, headingLevel = 3 }: { items: ActualItem[]; headingLevel?: 2 | 3 }) {
  const hasPortraitImage = items.some((item) => item.imageOrientation === "portrait");
  const HeadingTag = `h${headingLevel}` as const;

  return (
    <div className={`brand-actual-grid${hasPortraitImage ? " brand-actual-grid--mixed-media" : ""}`}>
      {items.map((item) => {
        const event = typeEvents[item.type] ?? null;

        return (
          <article className="brand-actual-card" key={item.id}>
            {item.image && (
              <div className={`brand-actual-card__visual brand-actual-card__visual--${item.imageOrientation ?? "landscape"}`}>
                <Image
                  src={item.image}
                  alt={item.imageAlt ?? item.title}
                  fill
                  sizes="(min-width: 64rem) 35rem, 100vw"
                />
              </div>
            )}
            <div className="brand-actual-card__content">
              <p className="brand-actual-card__type">{typeLabels[item.type]}</p>
              <HeadingTag className="brand-actual-card__title">{item.title}</HeadingTag>
              {item.shortText && <p className="brand-actual-card__text">{item.shortText}</p>}
              {item.buttonUrl &&
                (event ? (
                  <TrackedLink event={event} payload={{ item: item.id }} href={item.buttonUrl}>
                    {item.buttonText ?? "Подробнее"} <span aria-hidden="true">→</span>
                  </TrackedLink>
                ) : (
                  <Link href={item.buttonUrl}>
                    {item.buttonText ?? "Подробнее"} <span aria-hidden="true">→</span>
                  </Link>
                ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}
